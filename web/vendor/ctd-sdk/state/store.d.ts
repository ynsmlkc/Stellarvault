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
import type { AccountState } from "./types.js";
export interface StateStore {
    load(address: string): Promise<AccountState | null>;
    save(state: AccountState): Promise<void>;
}
/** JSON replacer: serialize bigints as `0x…` strings. */
export declare function bigintReplacer(_key: string, value: unknown): unknown;
/** Rebuild an {@link AccountState} from its JSON form (bigints as `0x…`). */
export declare function reviveState(raw: Record<string, unknown>): AccountState;
export declare function cloneState(s: AccountState): AccountState;
/** Ephemeral in-memory store (tests, single-run scripts). */
export declare class MemoryStore implements StateStore {
    #private;
    load(address: string): Promise<AccountState | null>;
    save(state: AccountState): Promise<void>;
}
//# sourceMappingURL=store.d.ts.map