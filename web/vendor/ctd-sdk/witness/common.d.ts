/**
 * Helpers for assembling Noir circuit inputs. A "witness" here is the full set
 * of `main()` arguments (private + public) keyed by the EXACT parameter names
 * from each circuit's `main.nr`. The same object feeds both `noir_js` (witness
 * solving / parity tests) and `bb.js` (proof generation).
 */
import { type Point } from "../crypto/grumpkin.js";
/** A map of circuit parameter name → 0x-prefixed 32-byte field hex. */
export type NoirInputs = Record<string, string>;
/** A single field-valued input. */
export declare function fieldIn(x: bigint): string;
/**
 * A Grumpkin point expands into two field inputs `${prefix}_x` / `${prefix}_y`,
 * matching every circuit's affine-coordinate parameter naming (e.g. prefix
 * `"c_spend"` → `c_spend_x`, `c_spend_y`).
 */
export declare function pointIn(prefix: string, p: Point): NoirInputs;
//# sourceMappingURL=common.d.ts.map