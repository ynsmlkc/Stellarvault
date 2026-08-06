/**
 * Disclosure-recipient (verifier-side) key and request handling
 * (SELECTIVE_DISCLOSURE.md §2.1). The recipient is any third party — a
 * compliance desk, tax authority, KYC provider — that wants one fact proven.
 * They hold a long-lived Grumpkin keypair `(r_R, P_R)` and mint a fresh nonce
 * `nu` per request; both are independent of the token contract and of any
 * Stellar account.
 */
import { H, scalarMul, ecdh, pointCoords, Grumpkin } from "../crypto/grumpkin.js";
import { randomScalar, toHex32, fromHex } from "../crypto/field.js";
import { DOMAIN } from "../crypto/constants.js";
import { decryptWithDomain } from "../crypto/poseidon2.js";
export function pointToJson(p) {
    const { x, y } = pointCoords(p);
    return { x: toHex32(x), y: toHex32(y) };
}
export function pointFromJson(p) {
    return Grumpkin.fromAffine({ x: fromHex(p.x), y: fromHex(p.y) });
}
/** Generate a fresh recipient keypair `(r_R, P_R = r_R · H)`. */
export function generateRecipientKeys() {
    const rR = randomScalar();
    return { rR, pR: pointToJson(scalarMul(rR, H)) };
}
/** Rebuild the public half from a persisted secret scalar. */
export function recipientKeysFromSecret(rR) {
    return { rR, pR: pointToJson(scalarMul(rR, H)) };
}
/**
 * Mint a disclosure request: `(P_R, nu)` with a fresh nonce. The recipient
 * keeps `nu` and accepts exactly one bundle against it (§13.2 replay
 * protection); the holder receives this object verbatim.
 */
export function newDisclosureRequest(keys) {
    return {
        pR: keys.pR,
        nu: toHex32(randomScalar()),
    };
}
/**
 * §5.3 step 6 — open the disclosure ciphertext:
 * `S_disc = r_R · R_disc`, `v_tx = v_tilde_disc - Poseidon2(δ_disc, S_disc.x, nu)`.
 * Only meaningful after the proof verified; callers must not surface the
 * value from a bundle that failed any §5.3 step.
 */
export function decryptDisclosure(rR, rDisc, vTildeDisc, nu) {
    const sDiscX = ecdh(rR, rDisc);
    return decryptWithDomain(vTildeDisc, DOMAIN.DISCLOSURE, sDiscX, nu);
}
//# sourceMappingURL=recipient.js.map