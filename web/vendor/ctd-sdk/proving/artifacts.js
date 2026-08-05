/**
 * Circuit-artifact loading.
 *
 * The compiled ACIR circuits live in `<sdk>/circuits/<name>.json` (committed,
 * produced by nargo 1.0.0-beta.9). In the browser the app imports these JSON
 * files through its bundler and constructs a {@link CircuitProver} directly. In
 * Node (deploy/e2e scripts, tests) use {@link loadCircuit} below.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const circuitsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "circuits");
/** Synchronously load a compiled circuit by name (Node only). */
export function loadCircuit(name) {
    const path = join(circuitsDir, `${name}.json`);
    return JSON.parse(readFileSync(path, "utf8"));
}
//# sourceMappingURL=artifacts.js.map