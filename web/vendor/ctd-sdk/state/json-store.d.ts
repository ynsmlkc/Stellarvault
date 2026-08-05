/**
 * Node-only {@link StateStore} backed by a JSON file. Kept OUT of the package
 * barrel so the browser bundle never pulls in `node:fs`. Import it directly:
 * `import { JsonFileStore } from "@ctd/sdk/dist/state/json-store.js"` (or from
 * source in scripts).
 */
import type { AccountState } from "./types.js";
import { type StateStore } from "./store.js";
export declare class JsonFileStore implements StateStore {
    #private;
    private path;
    constructor(path: string);
    load(address: string): Promise<AccountState | null>;
    save(state: AccountState): Promise<void>;
}
//# sourceMappingURL=json-store.d.ts.map