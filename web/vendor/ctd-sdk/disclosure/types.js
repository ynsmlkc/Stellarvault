/**
 * Wire types for the off-chain selective-disclosure protocol
 * (SELECTIVE_DISCLOSURE.md §5). Everything here is JSON: field elements are
 * 0x-prefixed 32-byte hex, points are `{ x, y }` hex pairs. These objects are
 * what the two parties copy/paste (or POST) between each other — they never
 * touch the chain.
 */
/** D-recipient (§6): "this on-chain payment paid me this amount". */
export const DISCLOSE_RECIPIENT_CIRCUIT_ID = "disclose_recipient";
/** D-sender (§7): "this on-chain payment was sent by me for this amount". */
export const DISCLOSE_SENDER_CIRCUIT_ID = "disclose_sender";
export const DISCLOSURE_CIRCUIT_IDS = [
    DISCLOSE_RECIPIENT_CIRCUIT_ID,
    DISCLOSE_SENDER_CIRCUIT_ID,
];
//# sourceMappingURL=types.js.map