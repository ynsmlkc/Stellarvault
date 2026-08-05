/**
 * Browser {@link StateStore} backed by `localStorage`. Safe to bundle (guards
 * for the absence of `localStorage` so it no-ops under SSR).
 *
 * For a demo this is adequate; a production wallet would prefer IndexedDB and
 * encryption at rest, since the cached openings are spending secrets.
 */
import type { AccountState } from "./types.js";
import { type StateStore } from "./store.js";
export declare class LocalStorageStore implements StateStore {
    #private;
    private prefix;
    constructor(prefix?: string);
    load(address: string): Promise<AccountState | null>;
    save(state: AccountState): Promise<void>;
}
//# sourceMappingURL=browser-store.d.ts.map