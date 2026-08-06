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
import { type ConfidentialEvent, type EventRef, type FetchEventsResult } from "./events.js";
export interface IndexerConfig {
    /** Base URL of the indexer Worker, e.g. `https://confidential-token-indexer.example.workers.dev`. */
    baseUrl: string;
}
export interface IndexerHealth {
    /** Highest ledger the pipeline has synced; 0 if it has none yet. */
    latestSyncedLedger: number;
}
/** One raw event row as returned by the indexer Worker (Goldsky pass-through). */
interface IndexerRow {
    id: string;
    ledger: number;
    txHash: string | null;
    /** JSON array of ScVal topics, or its JSON-string form. */
    topic: unknown;
    /** JSON ScVal map of the event data, or its JSON-string form. */
    value: unknown;
}
export declare class IndexerClient {
    readonly cfg: IndexerConfig;
    constructor(cfg: IndexerConfig);
    private url;
    health(): Promise<IndexerHealth>;
    /**
     * Fetch and parse all token events in `[startLedger, endLedger]` (both
     * inclusive, both optional), following the Worker's id-based pagination to
     * the end. Returns the same shape as RPC {@link fetchEvents} so the hybrid
     * source can merge the two transparently. `cursor` is `undefined` because the
     * full requested range is consumed here.
     */
    fetchEvents(opts: {
        contractId: string;
        startLedger?: number;
        endLedger?: number;
        pageLimit?: number;
    }): Promise<FetchEventsResult>;
    /**
     * Resolve a single pinned event by reading only its ledger from the indexer.
     * Mirrors {@link resolveEventRef} on the RPC, but works for events older than
     * the RPC's ~7-day window. Returns `null` if no matching id/txHash is found.
     */
    resolveEventRef(contractId: string, ref: EventRef): Promise<ConfidentialEvent | null>;
}
/**
 * Decode one Goldsky event row into a {@link ConfidentialEvent}, or `null` for
 * unknown event types. Field elements and points are reconstructed through the
 * SAME `fromBytesBE`/`pointFromBytes` primitives the RPC path uses, so a
 * correct byte decode is byte-identical to the XDR path.
 */
export declare function parseIndexerEvent(row: IndexerRow): ConfidentialEvent | null;
export {};
//# sourceMappingURL=indexer.d.ts.map