/**
 * Node-only {@link StateStore} backed by a JSON file. Kept OUT of the package
 * barrel so the browser bundle never pulls in `node:fs`. Import it directly:
 * `import { JsonFileStore } from "@ctd/sdk/dist/state/json-store.js"` (or from
 * source in scripts).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { bigintReplacer, reviveState } from "./store.js";
export class JsonFileStore {
    path;
    constructor(path) {
        this.path = path;
    }
    #readAll() {
        if (!existsSync(this.path))
            return {};
        return JSON.parse(readFileSync(this.path, "utf8"));
    }
    async load(address) {
        const raw = this.#readAll()[address];
        return raw ? reviveState(raw) : null;
    }
    async save(state) {
        const all = this.#readAll();
        all[state.address] = state;
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(this.path, JSON.stringify(all, bigintReplacer, 2));
    }
}
//# sourceMappingURL=json-store.js.map