/**
 * Local confidential-state types. The protocol keeps only Pedersen commitments
 * on-chain; the *openings* (`v`, `r`) live only in events and must be cached
 * locally to remain spendable. See `engine.ts` for the reconstruction rules and
 * the retention caveat.
 */
export function freshState(address) {
    return {
        address,
        spendable: { v: 0n, r: 0n },
        receiving: { v: 0n, r: 0n },
        registered: false,
        syncedLedger: 0,
    };
}
//# sourceMappingURL=types.js.map