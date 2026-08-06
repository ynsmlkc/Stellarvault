/**
 * Disclosure-receiver verification — the mandatory §5.3 protocol from
 * SELECTIVE_DISCLOSURE.md, for the D-recipient (§6) and D-sender (§7)
 * circuits.
 *
 * The trust-boundary rule (§5.2) is load-bearing here: the ONLY bundle values
 * that enter the public-input vector are `(R_disc, v_tilde_disc)`. Everything
 * else — the event fields, the disclosing accounts' PVKs, `addr_f` — is
 * resolved independently from the chain, and `(P_R, nu)` come from the
 * verifier's OWN request record, never from the prover. Which account each
 * PVK is read from is dictated by the variant and the event payload (§5.3
 * step 2): `E.to` for D-recipient; `E.from` (originator) plus `E.to`
 * (transfer recipient) for D-sender. A verifier that took any of these from
 * the bundle would prove nothing (§5.4).
 */
import type { ChainClient } from "../chain/client.js";
import { type TransferEvent } from "../chain/events.js";
import type { IndexerClient } from "../chain/indexer.js";
import type { CircuitProver } from "../proving/prover.js";
import { type DisclosureBundle, type DisclosureRequest, type RecipientKeys } from "./types.js";
/** Which §5.3 step a rejection happened at (§15.3: typed errors). */
export type VerifyStage = "vk-pinning" | "resolve-event" | "resolve-account" | "verify-proof" | "decrypt";
export declare class DisclosureVerifyError extends Error {
    readonly stage: VerifyStage;
    constructor(stage: VerifyStage, message: string);
}
export interface VerifiedDisclosure {
    /** The disclosed amount — trustworthy as the chain itself (§1.1). */
    amount: bigint;
    /** The resolved on-chain event the proof is pinned to. */
    event: TransferEvent;
    /** What was proven: the disclosing party received or sent the payment. */
    role: "recipient" | "sender";
    /** The account the proof binds to (`E.to` for recipient, `E.from` for sender). */
    disclosingAccount: string;
    /** Human-readable trace of each verifier step, for display. */
    steps: string[];
}
export declare function verifyDisclosure(params: {
    client: ChainClient;
    bundle: DisclosureBundle;
    /** The verifier's own request this bundle answers — NOT taken from the bundle. */
    request: DisclosureRequest;
    /** The verifier's keypair (request.pR must be its public half). */
    keys: RecipientKeys;
    /** Prover/verifier over the shared artifact for the BUNDLE's circuit_id. */
    prover: CircuitProver;
    /**
     * Pinned verification key from `@ctd/disclosure` (the vk.json matching the
     * bundle's circuit_id). When given, the VK derived from the loaded circuit
     * bytecode must match byte-for-byte — this is the §5.5 "circuit_id →
     * audited circuit" agreement made checkable.
     */
    pinnedVk?: Uint8Array;
    /**
     * Optional Goldsky indexer. When given, `ref_E` is resolved via the indexer
     * first (so disclosures of transfers older than the RPC's ~7-day window still
     * verify), falling back to the RPC.
     */
    indexer?: IndexerClient;
}): Promise<VerifiedDisclosure>;
//# sourceMappingURL=verify.d.ts.map