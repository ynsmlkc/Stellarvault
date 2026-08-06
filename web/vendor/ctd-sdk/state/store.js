/**
 * Pluggable persistence for reconstructed account state. Local persistence is
 * load-bearing for correctness, not just performance: once an event ages out of
 * the RPC's ~7-day window, the cached openings are the ONLY way to keep the
 * balance spendable.
 *
 * This module is environment-neutral (no Node built-ins) so it is safe to
 * bundle for the browser. {@link MemoryStore} works everywhere;
 * {@link LocalStorageStore} (browser-store.ts) persists in `localStorage`; the
 * Node-only {@link JsonFileStore} lives in json-store.ts.
 */
/** JSON replacer: serialize bigints as `0x…` strings. */
export function bigintReplacer(_key, value) {
    return typeof value === "bigint" ? `0x${value.toString(16)}` : value;
}
/** Rebuild an {@link AccountState} from its JSON form (bigints as `0x…`). */
export function reviveState(raw) {
    const op = (o) => ({
        v: BigInt(o.v),
        r: BigInt(o.r),
    });
    return {
        address: raw.address,
        spendable: op(raw.spendable),
        receiving: op(raw.receiving),
        registered: raw.registered,
        cursor: raw.cursor,
        syncedLedger: raw.syncedLedger,
    };
}
export function cloneState(s) {
    return {
        address: s.address,
        spendable: { ...s.spendable },
        receiving: { ...s.receiving },
        registered: s.registered,
        cursor: s.cursor,
        syncedLedger: s.syncedLedger,
    };
}
/** Ephemeral in-memory store (tests, single-run scripts). */
export class MemoryStore {
    #byAddress = new Map();
    async load(address) {
        const s = this.#byAddress.get(address);
        return s ? cloneState(s) : null;
    }
    async save(state) {
        this.#byAddress.set(state.address, cloneState(state));
    }
}
//# sourceMappingURL=store.js.map