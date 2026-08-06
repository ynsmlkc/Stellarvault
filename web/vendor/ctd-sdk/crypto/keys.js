/**
 * Key derivation. Unlike the previous design, every key is **contract-bound**:
 * the viewing key folds in `addr_f` (the token contract's address-as-field), so
 * a key set generated for one deployment is meaningless against another.
 *
 *   sk  (random F_r scalar, the only secret)
 *    ├─ vk  = Poseidon2(VIEWING_KEY, sk, addr_f)
 *    ├─ Y   = sk · H        (spending public key)
 *    └─ PVK = vk · H        (public viewing key — others' ECDH target for you)
 */
import { H, scalarMul } from "./grumpkin.js";
import { vkFromSk } from "./poseidon2.js";
import { randomScalar, toHex32 } from "./field.js";
/** Derive the full key set for a given secret and contract `addr_f`. */
export function deriveKeys(sk, addrF) {
    const vk = vkFromSk(sk, addrF);
    const Y = scalarMul(sk, H);
    const PVK = scalarMul(vk, H);
    return { sk, vk, Y, PVK, addrF };
}
/** Generate a fresh key set bound to `addr_f`. */
export function generateKeys(addrF) {
    return deriveKeys(randomScalar(), addrF);
}
/** A key pair is fully determined by `(sk, addr_f)`. */
export function serializeKeys(keys) {
    return { sk: toHex32(keys.sk), addrF: toHex32(keys.addrF) };
}
export function deserializeKeys(data) {
    return deriveKeys(BigInt(data.sk), BigInt(data.addrF));
}
//# sourceMappingURL=keys.js.map