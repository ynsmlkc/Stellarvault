/**
 * Goldsky indexer client — the durable, full-history event source that
 * complements the RPC `getEvents` API (which only retains ~7 days).
 *
 * The indexer is a Cloudflare Worker (see `packages/indexer/`) backed by a
 * Goldsky "turbo" pipeline that mirrors Stellar events into Postgres. The
 * Worker is a thin pass-through: it returns the raw Goldsky-decoded `topic`
 * (JSON array of ScVal topics) and `value` (JSON ScVal map) for each row, and
 * ALL decoding into a {@link ConfidentialEvent} happens here in the SDK. That
 * keeps a single decoding path that the parity test (`test/indexer-parity.mjs`)
 * pins against the RPC XDR decoder in `events.ts` — the decoded `bigint`s and
 * `Point`s must be byte-identical or reconstructed balances silently diverge.
 *
 * ⚠️ Goldsky's exact JSON encoding of Soroban ScVals (hex vs base64 bytes, the
 * i128 shape, tagged vs plain topics) is documented loosely; the decoders below
 * are deliberately permissive and MUST be validated against a real ingested row
 * via `indexer-parity.mjs` before relying on the indexer in production.
 */
import { fromBytesBE, hexToBytes } from "../crypto/field.js";
import { pointFromBytes } from "../crypto/grumpkin.js";
import { KNOWN, buildConfidentialEvent, naturalEventId, } from "./events.js";
const DEFAULT_PAGE_LIMIT = 200;
export class IndexerClient {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    url(path, params) {
        const u = new URL(path.replace(/^\//, ""), this.cfg.baseUrl.replace(/\/?$/, "/"));
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                if (v !== undefined)
                    u.searchParams.set(k, String(v));
            }
        }
        return u.toString();
    }
    async health() {
        const resp = await fetch(this.url("health"));
        const body = (await resp.json());
        return { latestSyncedLedger: Number(body.latest_synced_ledger ?? 0) };
    }
    /**
     * Fetch and parse all token events in `[startLedger, endLedger]` (both
     * inclusive, both optional), following the Worker's id-based pagination to
     * the end. Returns the same shape as RPC {@link fetchEvents} so the hybrid
     * source can merge the two transparently. `cursor` is `undefined` because the
     * full requested range is consumed here.
     */
    async fetchEvents(opts) {
        const limit = opts.pageLimit ?? DEFAULT_PAGE_LIMIT;
        const out = [];
        let cursor;
        let latestLedger = 0;
        for (;;) {
            const resp = await fetch(this.url(`contracts/${opts.contractId}/events`, {
                startLedger: cursor ? undefined : opts.startLedger,
                endLedger: opts.endLedger,
                cursor,
                limit,
            }));
            if (!resp.ok) {
                throw new Error(`indexer events ${resp.status}: ${await safeText(resp)}`);
            }
            const page = (await resp.json());
            latestLedger = page.latestLedger ?? latestLedger;
            for (const row of page.events ?? []) {
                const ev = parseIndexerEvent(row);
                if (ev)
                    out.push(ev);
            }
            if (!page.cursor || (page.events ?? []).length === 0)
                break;
            if (page.cursor === cursor)
                break; // defensive: no forward progress
            cursor = page.cursor;
        }
        return { events: out, cursor: undefined, latestLedger };
    }
    /**
     * Resolve a single pinned event by reading only its ledger from the indexer.
     * Mirrors {@link resolveEventRef} on the RPC, but works for events older than
     * the RPC's ~7-day window. Returns `null` if no matching id/txHash is found.
     */
    async resolveEventRef(contractId, ref) {
        const resp = await fetch(this.url(`contracts/${contractId}/events`, {
            startLedger: ref.ledger,
            endLedger: ref.ledger,
            limit: 200,
        }));
        if (!resp.ok)
            return null;
        const page = (await resp.json());
        // Match on the normalized cursor (naturalEventId), so a ref pinned from the
        // RPC resolves here too — Goldsky's raw row id never equals an RPC ref id.
        const ev = (page.events ?? [])
            .map(parseIndexerEvent)
            .find((e) => e !== null && e.cursor === ref.id);
        if (!ev)
            return null;
        if (ev.txHash !== ref.txHash)
            return null;
        return ev;
    }
}
async function safeText(resp) {
    try {
        return (await resp.text()).slice(0, 200);
    }
    catch {
        return "";
    }
}
// --------------------------------------------------------------------------
// Goldsky-JSON → ConfidentialEvent decoding (parity with events.ts parseEvent)
// --------------------------------------------------------------------------
/**
 * Normalize a Goldsky row id to the source-independent {@link naturalEventId},
 * so an indexer event has the SAME `cursor` the RPC produces for it. Goldsky's
 * id is `<ledger>-<txHash>-op-<N>-event-<M>`; we take the `op`/`event` indices
 * from it and pair them with the row's `ledger`/`txHash`. If the id doesn't
 * match that shape we fall back to it verbatim (unique within the indexer, but
 * it won't cross-match an RPC event — warn so a Goldsky id-format change is
 * visible rather than silently breaking dedup/disclosure resolution).
 */
function indexerEventId(rowId, ledger, txHash) {
    const m = /op-(\d+)-event-(\d+)\s*$/i.exec(rowId);
    if (!m) {
        console.warn(`[ctd] indexer row id "${rowId}" lacks op-N-event-M; cross-source matching disabled for it`);
        return rowId;
    }
    return naturalEventId({ ledger, txHash, opIndex: Number(m[1]), eventIndex: Number(m[2]) });
}
/**
 * Decode one Goldsky event row into a {@link ConfidentialEvent}, or `null` for
 * unknown event types. Field elements and points are reconstructed through the
 * SAME `fromBytesBE`/`pointFromBytes` primitives the RPC path uses, so a
 * correct byte decode is byte-identical to the XDR path.
 */
export function parseIndexerEvent(row) {
    const topics = asArray(normalizeJson(row.topic));
    if (topics.length === 0)
        return null;
    const name = scvString(topics[0]);
    if (!name || !KNOWN.has(name))
        return null;
    const ledger = Number(row.ledger);
    const txHash = row.txHash ?? "";
    const base = { ledger, txHash, cursor: indexerEventId(row.id, ledger, txHash) };
    const addr = (i) => {
        const a = scvString(topics[i]);
        if (!a)
            throw new Error(`indexer event "${name}" missing address topic ${i}`);
        return a;
    };
    // Shared shape definition (events.ts) — only the addr/data adapters differ.
    return buildConfidentialEvent(name, base, addr, dataMap(row.value));
}
/** Goldsky-JSON-backed {@link EventDataAccessor} (parity with events.ts dataMap). */
function dataMap(value) {
    const byName = parseScValMap(normalizeJson(value));
    const get = (name) => {
        if (!(name in byName))
            throw new Error(`indexer event data missing field "${name}"`);
        return byName[name];
    };
    return {
        // fromBytesBE ignores leading zeros, so field elements need no padding.
        field: (name) => fromBytesBE(scvBytes(get(name))),
        // pointFromBytes requires exactly 64 bytes (be(x)||be(y)). Left-pad in case
        // an encoder minimizes the fixed-width BytesN<64> by stripping leading zeros.
        point: (name) => pointFromBytes(padTo(scvBytes(get(name)), 64)),
        i128: (name) => scvI128(get(name)),
        u32: (name) => scvU32(get(name)),
    };
}
function normalizeJson(value) {
    if (typeof value === "string") {
        try {
            return JSON.parse(value);
        }
        catch {
            return value;
        }
    }
    return value;
}
function asRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    return value;
}
function asArray(value) {
    if (Array.isArray(value))
        return value;
    const rec = asRecord(value);
    if (rec && Array.isArray(rec.items))
        return rec.items;
    return [];
}
/**
 * Flatten a Soroban ScVal map (`{ map: [{ key:{symbol}, val }, …] }`) to a
 * plain object keyed by the symbol field names. Also accepts an already-plain
 * object (some encoders emit `{ field: val }` directly).
 */
function parseScValMap(value) {
    const rec = asRecord(value);
    if (!rec)
        return {};
    const entries = asArray(rec.map);
    if (entries.length === 0) {
        // Already-plain `{ field: val }` form — return as-is.
        return rec;
    }
    const out = {};
    for (const entry of entries) {
        const e = asRecord(entry);
        if (!e)
            continue;
        const key = scvString(e.key);
        if (key)
            out[key] = e.val;
    }
    return out;
}
/** Extract a string from an ScVal that is a symbol/address/string (or plain string). */
function scvString(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "string")
        return value;
    if (typeof value === "number" || typeof value === "bigint")
        return String(value);
    const rec = asRecord(value);
    if (!rec)
        return null;
    for (const key of ["symbol", "address", "string", "sym", "str", "value"]) {
        const v = rec[key];
        if (typeof v === "string")
            return v;
    }
    return null;
}
/** Extract the raw bytes of a `Bytes`/`BytesN` ScVal as a Uint8Array. */
function scvBytes(value) {
    let s = null;
    if (typeof value === "string") {
        s = value;
    }
    else {
        const rec = asRecord(value);
        if (rec) {
            for (const key of ["bytes", "hex", "b64", "bytesN", "value"]) {
                const v = rec[key];
                if (typeof v === "string") {
                    s = v;
                    break;
                }
            }
        }
    }
    if (s === null)
        throw new Error("expected a bytes ScVal");
    return decodeBytesString(s);
}
/** Left-pad (or return as-is) a byte array to exactly `len` bytes, big-endian. */
function padTo(bytes, len) {
    if (bytes.length === len)
        return bytes;
    if (bytes.length > len)
        throw new Error(`expected <= ${len} bytes, got ${bytes.length}`);
    const out = new Uint8Array(len);
    out.set(bytes, len - bytes.length);
    return out;
}
/** Decode a bytes string: prefer hex (Goldsky's Stellar form), fall back to base64. */
function decodeBytesString(s) {
    const hex = s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s;
    if (hex.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(hex)) {
        return hexToBytes(hex);
    }
    // base64 fallback
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
/** Extract an i128 ScVal as a bigint (decimal string, {hi,lo}, or native). */
function scvI128(value) {
    if (typeof value === "bigint")
        return value;
    if (typeof value === "number")
        return BigInt(value);
    if (typeof value === "string")
        return BigInt(value);
    const rec = asRecord(value);
    if (rec) {
        for (const key of ["i128", "i64", "u64", "value"]) {
            const v = rec[key];
            if (typeof v === "string" || typeof v === "number")
                return BigInt(v);
        }
        if ("hi" in rec && "lo" in rec) {
            const hi = BigInt(rec.hi);
            const lo = BigInt(rec.lo);
            return (hi << 64n) | (lo & ((1n << 64n) - 1n));
        }
    }
    throw new Error("expected an i128 ScVal");
}
/** Extract a u32 ScVal as a number. */
function scvU32(value) {
    if (typeof value === "number")
        return value;
    if (typeof value === "string")
        return Number(value);
    const rec = asRecord(value);
    if (rec) {
        for (const key of ["u32", "u64", "value"]) {
            const v = rec[key];
            if (typeof v === "number")
                return v;
            if (typeof v === "string")
                return Number(v);
        }
    }
    throw new Error("expected a u32 ScVal");
}
//# sourceMappingURL=indexer.js.map