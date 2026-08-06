/**
 * Withdraw-circuit witness (design §7.5). Debits `amount` from the spendable
 * balance to the public SEP-41 side, re-blinds the remainder, and emits a
 * sender-auditor balance checkpoint.
 *
 * Public-input order (matches `storage.rs::withdraw`):
 *   C_spend, Y, addr_f, K_aud_s, a, C_spend', sigma, b_tilde, R_e, b_aud_s
 */
import { H, commit, scalarMul, ecdh } from "../crypto/grumpkin.js";
import { randomScalar } from "../crypto/field.js";
import { deriveSpendR, encryptBalance, encryptAuditorSenderBalance, } from "../crypto/poseidon2.js";
import { fieldIn, pointIn } from "./common.js";
export function buildWithdrawWitness(p) {
    const { keys, v, r, amount, kAudS } = p;
    if (amount < 0n)
        throw new Error("withdraw amount must be non-negative");
    const vNew = v - amount;
    if (vNew < 0n)
        throw new Error("withdraw amount exceeds spendable balance");
    const sigma = p.sigma ?? randomScalar();
    const rE = p.rE ?? randomScalar(); // randomScalar() is always nonzero (T8/W8)
    const cSpend = commit(v, r);
    const rNew = deriveSpendR(keys.vk, sigma);
    const cSpendNew = commit(vNew, rNew);
    const bTilde = encryptBalance(vNew, keys.vk, sigma);
    const rePoint = scalarMul(rE, H);
    const sAsX = ecdh(rE, kAudS);
    const bAudS = encryptAuditorSenderBalance(vNew, sAsX, sigma);
    const inputs = {
        sk: fieldIn(keys.sk),
        v: fieldIn(v),
        r: fieldIn(r),
        r_e: fieldIn(rE),
        ...pointIn("c_spend", cSpend),
        ...pointIn("y", keys.Y),
        addr_f: fieldIn(keys.addrF),
        ...pointIn("k_aud_s", kAudS),
        a: fieldIn(amount),
        ...pointIn("c_spend_new", cSpendNew),
        sigma: fieldIn(sigma),
        b_tilde: fieldIn(bTilde),
        ...pointIn("r_e", rePoint),
        b_tilde_aud_s: fieldIn(bAudS),
    };
    return {
        inputs,
        payload: { cSpendNew, bTilde, rE: rePoint, sigma, bAudS },
        next: { v: vNew, r: rNew, cSpend: cSpendNew },
    };
}
//# sourceMappingURL=withdraw.js.map