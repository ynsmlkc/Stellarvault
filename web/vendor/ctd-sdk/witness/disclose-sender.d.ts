/**
 * D-sender disclosure-circuit witness (SELECTIVE_DISCLOSURE.md §7).
 *
 * The ORIGINATOR of a confidential transfer proves to a third party that they
 * paid exactly `v_tx` to the on-chain `to` recorded in the event. The event
 * ciphertext is keyed to the recipient's `PVK_B`, so the sender's necessary
 * witness is the ephemeral scalar `r_e` from transfer time — recomputed as
 * `Poseidon2(EPHEMERAL_KEY, vk, sigma)` from the event's public `sigma`
 * (§15.2; see `deriveEphemeralRE`), so no per-transfer state is needed.
 *
 * Public-input order (matches `disclose_sender/src/main.nr`):
 *   addr_f, PVK_A, R_e, sigma, v_tilde, PVK_B, P_R, nu, R_disc, v_tilde_disc
 */
import type { KeyPair } from "../crypto/keys.js";
import { type Point } from "../crypto/grumpkin.js";
import { type NoirInputs } from "./common.js";
export interface DiscloseSenderParams {
    /** Originator's contract-bound key set (the event's `from` account). */
    keys: KeyPair;
    /** The transfer's ephemeral SCALAR, re-derived via `deriveEphemeralRE` (§15.2). */
    rEScalar: bigint;
    /** Per-event fields from the on-chain `Transfer` being disclosed. */
    event: {
        rE: Point;
        sigma: bigint;
        vTilde: bigint;
    };
    /** Transfer recipient's stored viewing key (from the account at `E.to`). */
    pvkB: Point;
    /** Disclosure recipient's Grumpkin pubkey `P_R` (§2.1). */
    pR: Point;
    /** Recipient-supplied request nonce `nu` (§2.1). */
    nu: bigint;
    rDisc?: bigint;
}
export interface DiscloseSenderWitness {
    inputs: NoirInputs;
    /** Plaintext amount the event decrypts to (what the proof discloses). */
    vTx: bigint;
    /** Disclosure ciphertext (§4) — travels in the bundle alongside the proof. */
    rDisc: Point;
    vTildeDisc: bigint;
}
export declare function buildDiscloseSenderWitness(p: DiscloseSenderParams): DiscloseSenderWitness;
//# sourceMappingURL=disclose-sender.d.ts.map