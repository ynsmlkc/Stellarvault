/**
 * D-recipient disclosure-circuit witness (SELECTIVE_DISCLOSURE.md §6).
 *
 * The holder of the account a confidential transfer paid proves to a third
 * party (the "disclosure recipient", identified by Grumpkin key `P_R` and a
 * fresh request nonce `nu`) that the named on-chain event paid them exactly
 * `v_tx`. The amount is decrypted in-witness from the event ciphertext —
 * disclosing requires nothing beyond the wallet keys and the event itself.
 *
 * Public-input order (matches `disclose_recipient/src/main.nr`):
 *   addr_f, PVK_A, R_e, sigma, v_tilde, P_R, nu, R_disc, v_tilde_disc
 */
import type { KeyPair } from "../crypto/keys.js";
import { type Point } from "../crypto/grumpkin.js";
import { type NoirInputs } from "./common.js";
export interface DiscloseRecipientParams {
    /** Holder's contract-bound key set (the event's `to` account). */
    keys: KeyPair;
    /** Per-event fields from the on-chain `Transfer` being disclosed. */
    event: {
        rE: Point;
        sigma: bigint;
        vTilde: bigint;
    };
    /** Disclosure recipient's Grumpkin pubkey `P_R` (§2.1). */
    pR: Point;
    /** Recipient-supplied request nonce `nu` (§2.1). */
    nu: bigint;
    rDisc?: bigint;
}
export interface DiscloseRecipientWitness {
    inputs: NoirInputs;
    /** Plaintext amount the event decrypts to (what the proof discloses). */
    vTx: bigint;
    /** Disclosure ciphertext (§4) — travels in the bundle alongside the proof. */
    rDisc: Point;
    vTildeDisc: bigint;
}
export declare function buildDiscloseRecipientWitness(p: DiscloseRecipientParams): DiscloseRecipientWitness;
//# sourceMappingURL=disclose-recipient.d.ts.map