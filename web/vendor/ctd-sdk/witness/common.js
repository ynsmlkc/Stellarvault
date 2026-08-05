/**
 * Helpers for assembling Noir circuit inputs. A "witness" here is the full set
 * of `main()` arguments (private + public) keyed by the EXACT parameter names
 * from each circuit's `main.nr`. The same object feeds both `noir_js` (witness
 * solving / parity tests) and `bb.js` (proof generation).
 */
import { pointCoords } from "../crypto/grumpkin.js";
import { toHex32 } from "../crypto/field.js";
/** A single field-valued input. */
export function fieldIn(x) {
    return toHex32(x);
}
/**
 * A Grumpkin point expands into two field inputs `${prefix}_x` / `${prefix}_y`,
 * matching every circuit's affine-coordinate parameter naming (e.g. prefix
 * `"c_spend"` → `c_spend_x`, `c_spend_y`).
 */
export function pointIn(prefix, p) {
    const { x, y } = pointCoords(p);
    return { [`${prefix}_x`]: toHex32(x), [`${prefix}_y`]: toHex32(y) };
}
//# sourceMappingURL=common.js.map