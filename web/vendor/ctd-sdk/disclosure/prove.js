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
import { fromHex, toHex32, bytesToHex } from "../crypto/field.js";
import { eventRef } from "../chain/events.js";
import { buildDiscloseRecipientWitness } from "../witness/disclose-recipient.js";
import { buildDiscloseSenderWitness } from "../witness/disclose-sender.js";
import { DISCLOSE_RECIPIENT_CIRCUIT_ID, DISCLOSE_SENDER_CIRCUIT_ID, } from "./types.js";
import { pointFromJson, pointToJson } from "./recipient.js";
export async function proveRecipientDisclosure(params) {
    const { keys, event, request, prover } = params;
    const w = buildDiscloseRecipientWitness({
        keys,
        event: { rE: event.rE, sigma: event.sigma, vTilde: event.vTilde },
        pR: pointFromJson(request.pR),
        nu: fromHex(request.nu),
    });
    const { proof } = await prover.prove(w.inputs);
    return bundle(DISCLOSE_RECIPIENT_CIRCUIT_ID, event, proof, w);
}
export async function proveSenderDisclosure(params) {
    const { keys, rEScalar, event, pvkB, request, prover } = params;
    const w = buildDiscloseSenderWitness({
        keys,
        rEScalar,
        event: { rE: event.rE, sigma: event.sigma, vTilde: event.vTilde },
        pvkB,
        pR: pointFromJson(request.pR),
        nu: fromHex(request.nu),
    });
    const { proof } = await prover.prove(w.inputs);
    return bundle(DISCLOSE_SENDER_CIRCUIT_ID, event, proof, w);
}
function bundle(circuitId, event, proof, w) {
    return {
        circuitId,
        refE: eventRef(event),
        proof: "0x" + bytesToHex(proof),
        rDisc: pointToJson(w.rDisc),
        vTildeDisc: toHex32(w.vTildeDisc),
    };
}
//# sourceMappingURL=prove.js.map