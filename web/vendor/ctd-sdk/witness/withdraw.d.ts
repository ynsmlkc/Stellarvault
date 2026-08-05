/**
 * Withdraw-circuit witness (design §7.5). Debits `amount` from the spendable
 * balance to the public SEP-41 side, re-blinds the remainder, and emits a
 * sender-auditor balance checkpoint.
 *
 * Public-input order (matches `storage.rs::withdraw`):
 *   C_spend, Y, addr_f, K_aud_s, a, C_spend', sigma, b_tilde, R_e, b_aud_s
 */
import type { KeyPair } from "../crypto/keys.js";
import { type Point } from "../crypto/grumpkin.js";
import { type NoirInputs } from "./common.js";
export interface WithdrawParams {
    /** Spender's contract-bound key set. */
    keys: KeyPair;
    /** Current spendable-balance plaintext value `v`. */
    v: bigint;
    /** Current spendable-balance blinding factor `r` (opening of C_spend). */
    r: bigint;
    /** Public withdrawal amount `a` (0 ≤ a ≤ v). */
    amount: bigint;
    /** Sender's auditor key `K_aud_s` (from the auditor registry). */
    kAudS: Point;
    /** Optional fixed salt (defaults to a fresh random scalar). */
    sigma?: bigint;
    /** Optional fixed ephemeral scalar `r_e ≠ 0` (defaults to random). */
    rE?: bigint;
}
export interface WithdrawWitness {
    inputs: NoirInputs;
    /** On-chain `WithdrawPayload`. `rE` is the POINT `R_e = r_e·H`. */
    payload: {
        cSpendNew: Point;
        bTilde: bigint;
        rE: Point;
        sigma: bigint;
        bAudS: bigint;
    };
    /** Post-op spendable opening, for the local state engine. */
    next: {
        v: bigint;
        r: bigint;
        cSpend: Point;
    };
}
export declare function buildWithdrawWitness(p: WithdrawParams): WithdrawWitness;
//# sourceMappingURL=withdraw.d.ts.map