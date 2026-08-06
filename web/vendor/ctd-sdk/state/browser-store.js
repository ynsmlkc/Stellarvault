/**
 * Browser {@link StateStore} backed by `localStorage`. Safe to bundle (guards
 * for the absence of `localStorage` so it no-ops under SSR).
 *
 * For a demo this is adequate; a production wallet would prefer IndexedDB and
 * encryption at rest, since the cached openings are spending secrets.
 */
import { bigintReplacer, reviveState } from "./store.js";
export class LocalStorageStore {
    prefix;
    constructor(prefix = "ctd:state:") {
        this.prefix = prefix;
    }
    #key(address) {
        return this.prefix + address;
    }
    async load(address) {
        if (typeof localStorage === "undefined")
            return null;
        const raw = localStorage.getItem(this.#key(address));
        return raw ? reviveState(JSON.parse(raw)) : null;
    }
    async save(state) {
        if (typeof localStorage === "undefined")
            return;
        localStorage.setItem(this.#key(state.address), JSON.stringify(state, bigintReplacer));
    }
}
//# sourceMappingURL=browser-store.js.map