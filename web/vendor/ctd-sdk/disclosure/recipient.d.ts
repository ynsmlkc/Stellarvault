/**
 * Disclosure-recipient (verifier-side) key and request handling
 * (SELECTIVE_DISCLOSURE.md §2.1). The recipient is any third party — a
 * compliance desk, tax authority, KYC provider — that wants one fact proven.
 * They hold a long-lived Grumpkin keypair `(r_R, P_R)` and mint a fresh nonce
 * `nu` per request; both are independent of the token contract and of any
 * Stellar account.
 */
import { type Point } from "../crypto/grumpkin.js";
import type { DisclosureRequest, JsonPoint, RecipientKeys } from "./types.js";
export declare function pointToJson(p: Point): JsonPoint;
export declare function pointFromJson(p: JsonPoint): Point;
/** Generate a fresh recipient keypair `(r_R, P_R = r_R · H)`. */
export declare function generateRecipientKeys(): RecipientKeys;
/** Rebuild the public half from a persisted secret scalar. */
export declare function recipientKeysFromSecret(rR: bigint): RecipientKeys;
/**
 * Mint a disclosure request: `(P_R, nu)` with a fresh nonce. The recipient
 * keeps `nu` and accepts exactly one bundle against it (§13.2 replay
 * protection); the holder receives this object verbatim.
 */
export declare function newDisclosureRequest(keys: RecipientKeys): DisclosureRequest;
/**
 * §5.3 step 6 — open the disclosure ciphertext:
 * `S_disc = r_R · R_disc`, `v_tx = v_tilde_disc - Poseidon2(δ_disc, S_disc.x, nu)`.
 * Only meaningful after the proof verified; callers must not surface the
 * value from a bundle that failed any §5.3 step.
 */
export declare function decryptDisclosure(rR: bigint, rDisc: Point, vTildeDisc: bigint, nu: bigint): bigint;
//# sourceMappingURL=recipient.d.ts.map