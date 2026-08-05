/**
 * Transfer-circuit witness (design §7.6). Moves `amount` from the sender's
 * spendable balance into the recipient's receiving balance, and emits dual
 * auditor channels (recipient + sender).
 *
 * Public-input order (matches `storage.rs::confidential_transfer`):
 *   C_spend_A, Y_A, PVK_B, addr_f, K_aud_r, K_aud_s, C_spend', C_tx, R_e,
 *   v_tilde, b_tilde, sigma, v_aud_r, r_aud_r, v_aud_s, b_aud_s
 */
import type { KeyPair } from "../crypto/keys.js";
import { type Point } from "../crypto/grumpkin.js";
import { type NoirInputs } from "./common.js";
export interface TransferParams {
    /** Sender's contract-bound key set. */
    keys: KeyPair;
    /** Sender's current spendable plaintext / blinding. */
    v: bigint;
    r: bigint;
    /** Confidential transfer amount `v_tx` (0 ≤ v_tx ≤ v). */
    amount: bigint;
    /** Recipient's public viewing key `PVK_B` (from their account). */
    pvkB: Point;
    /** Recipient's auditor key `K_aud_r`. */
    kAudR: Point;
    /** Sender's auditor key `K_aud_s`. */
    kAudS: Point;
    sigma?: bigint;
    rE?: bigint;
}
export interface TransferWitness {
    inputs: NoirInputs;
    /** On-chain `TransferPayload`. `rE` is the POINT `R_e = r_e·H`. */
    payload: {
        cSpendNew: Point;
        cTx: Point;
        rE: Point;
        vTilde: bigint;
        bTilde: bigint;
        sigma: bigint;
        vAudR: bigint;
        rAudR: bigint;
        vAudS: bigint;
        bAudS: bigint;
    };
    /** Post-op sender spendable opening, for the local state engine. */
    next: {
        v: bigint;
        r: bigint;
        cSpend: Point;
    };
    /**
     * Plaintext the recipient would recover from the emitted event (amount and
     * the C_tx blinding it folds into their receiving balance). Exposed for the
     * e2e flow / tests; on-chain the recipient derives these from the event.
     */
    recipientView: {
        vTx: bigint;
        rTx: bigint;
        cTx: Point;
    };
    /**
     * The ephemeral SCALAR `r_e` for this transfer — the witness that lets the
     * sender later prove what the event ciphertext contains (D-sender,
     * SELECTIVE_DISCLOSURE.md §15.2). Derived as
     * `Poseidon2(EPHEMERAL_KEY, vk, sigma)`, so the sender can recompute it
     * from `vk` + the event's public `sigma` at any time — nothing to retain.
     */
    rEScalar: bigint;
}
export declare function buildTransferWitness(p: TransferParams): TransferWitness;
//# sourceMappingURL=transfer.d.ts.map