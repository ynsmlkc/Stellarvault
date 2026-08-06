/**
 * Register-circuit witness (design §7.2). Proves knowledge of `sk` such that
 * `Y = sk·H` and `PVK = vk·H` with `vk = Poseidon2(VIEWING_KEY, sk, addr_f)`.
 *
 * Public inputs (contract PI order): Y, PVK, addr_f.
 */
import { fieldIn, pointIn } from "./common.js";
export function buildRegisterWitness(keys) {
    const inputs = {
        sk: fieldIn(keys.sk),
        ...pointIn("y", keys.Y),
        ...pointIn("pvk", keys.PVK),
        addr_f: fieldIn(keys.addrF),
    };
    return { inputs, payload: { y: keys.Y, pvk: keys.PVK } };
}
//# sourceMappingURL=register.js.map