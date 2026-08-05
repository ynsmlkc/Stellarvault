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
import { type Point } from "./grumpkin.js";
export interface KeyPair {
    /** Secret spending scalar (the root secret). */
    sk: bigint;
    /** Contract-bound viewing key `vk = Poseidon2(VIEWING_KEY, sk, addr_f)`. */
    vk: bigint;
    /** Spending public key `Y = sk · H`. */
    Y: Point;
    /** Public viewing key `PVK = vk · H`. */
    PVK: Point;
    /** The `addr_f` these keys are bound to. */
    addrF: bigint;
}
export interface SerializedKeyPair {
    sk: string;
    addrF: string;
}
/** Derive the full key set for a given secret and contract `addr_f`. */
export declare function deriveKeys(sk: bigint, addrF: bigint): KeyPair;
/** Generate a fresh key set bound to `addr_f`. */
export declare function generateKeys(addrF: bigint): KeyPair;
/** A key pair is fully determined by `(sk, addr_f)`. */
export declare function serializeKeys(keys: KeyPair): SerializedKeyPair;
export declare function deserializeKeys(data: SerializedKeyPair): KeyPair;
//# sourceMappingURL=keys.d.ts.map