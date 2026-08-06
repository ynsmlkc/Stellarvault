/**
 * Holder-side disclosure proving (SELECTIVE_DISCLOSURE.md §12 steps 2–4):
 * take a recipient's request `(P_R, nu)` and a `Transfer` event, produce the
 * proof bundle to hand back. One entry point per role:
 *
 *   - proveRecipientDisclosure — the event paid me (D-recipient, §6)
 *   - proveSenderDisclosure    — I sent the event (D-sender, §7; r_e is
 *                                re-derived from vk + the event's sigma, §15.2)
 *
 * Pure orchestration over the witness builders + prover; the heavy lifting
 * (ECDH decrypt, U-block) is in witness/disclose-{recipient,sender}.ts.
 */
import type { KeyPair } from "../crypto/keys.js";
import type { Point } from "../crypto/grumpkin.js";
import type { TransferEvent } from "../chain/events.js";
import type { CircuitProver } from "../proving/prover.js";
import { type DisclosureBundle, type DisclosureRequest } from "./types.js";
export declare function proveRecipientDisclosure(params: {
    /** Holder's key set — must be the event's `to` account. */
    keys: KeyPair;
    /** The inbound transfer event being disclosed. */
    event: TransferEvent;
    /** The recipient's request, received out-of-band. */
    request: DisclosureRequest;
    /** Prover over the shared `@ctd/disclosure` disclose_recipient artifact. */
    prover: CircuitProver;
}): Promise<DisclosureBundle>;
export declare function proveSenderDisclosure(params: {
    /** Originator's key set — must be the event's `from` account. */
    keys: KeyPair;
    /** The transfer's ephemeral scalar, re-derived via `deriveEphemeralRE` (§15.2). */
    rEScalar: bigint;
    /** The outbound transfer event being disclosed. */
    event: TransferEvent;
    /** Transfer recipient's stored viewing key (read from the account at `E.to`). */
    pvkB: Point;
    /** The recipient's request, received out-of-band. */
    request: DisclosureRequest;
    /** Prover over the shared `@ctd/disclosure` disclose_sender artifact. */
    prover: CircuitProver;
}): Promise<DisclosureBundle>;
//# sourceMappingURL=prove.d.ts.map