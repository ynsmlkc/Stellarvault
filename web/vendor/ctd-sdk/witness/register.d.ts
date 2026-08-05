/**
 * Register-circuit witness (design §7.2). Proves knowledge of `sk` such that
 * `Y = sk·H` and `PVK = vk·H` with `vk = Poseidon2(VIEWING_KEY, sk, addr_f)`.
 *
 * Public inputs (contract PI order): Y, PVK, addr_f.
 */
import type { KeyPair } from "../crypto/keys.js";
import type { Point } from "../crypto/grumpkin.js";
import { type NoirInputs } from "./common.js";
export interface RegisterWitness {
    inputs: NoirInputs;
    /** On-chain `RegisterPayload` { y, pvk }. */
    payload: {
        y: Point;
        pvk: Point;
    };
}
export declare function buildRegisterWitness(keys: KeyPair): RegisterWitness;
//# sourceMappingURL=register.d.ts.map