/**
 * Circuit-artifact loading.
 *
 * The compiled ACIR circuits live in `<sdk>/circuits/<name>.json` (committed,
 * produced by nargo 1.0.0-beta.9). In the browser the app imports these JSON
 * files through its bundler and constructs a {@link CircuitProver} directly. In
 * Node (deploy/e2e scripts, tests) use {@link loadCircuit} below.
 */
import type { CompiledCircuit } from "@noir-lang/noir_js";
export type CircuitName = "register" | "withdraw" | "transfer";
/** Synchronously load a compiled circuit by name (Node only). */
export declare function loadCircuit(name: CircuitName): CompiledCircuit;
//# sourceMappingURL=artifacts.d.ts.map