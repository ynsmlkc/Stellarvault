# BN254 probe — testnet spike (2026-08-02)

Answers one question before any verifier work starts: are the BN254 host
functions (CAP-0074 Final @ p25, CAP-0080 Implemented @ p26) actually usable
on the live network?

Probe contract: `CB5WPITT3EZ6PFIDVWEVUMBGJLV725XAXHCQSIANH77TD4BBM3HDSZHW`
Testnet protocol version at time of running: **27**

| check | result |
| ------------------------------------- | ------ |
| `g1_mul` — 2·G                        | matches an independent local computation exactly |
| `g1_msm` — 3·G + 4·G                  | equals 7·G; both results verified on-curve (y² = x³ + 3) |
| `pairing_check` — e(P,Q)·e(-P,Q) == 1 | **true** |
| negative control — e(P,Q)·e(P,Q) == 1 | **false** |

The last two are the point: that identity is the shape of a Groth16
verification equation, and the negative control rules out "the host returns
true for everything".

Conclusion: an on-chain Groth16 verifier for our existing **BN254** circuits is
implementation work, not research. No curve migration is needed.

Two findings that shaped this:

- `soroban-sdk` 23.5.3 (what the contracts pinned) predates these host
  functions entirely — only BLS12-381 is exposed there. The blocker was our SDK
  pin, never the protocol. Bumping `vault-instance` to 27.0 required **zero**
  code changes; all 24 tests pass.
- `poseidon_permutation` takes the MDS matrix and round constants as arguments
  rather than hardcoding a parameter set, so matching circomlib would mean
  shipping its exact parameters. Irrelevant for verification — Poseidon runs
  inside the circuit, not on-chain — but it matters if we ever want to
  recompute the signer Merkle root on-chain.
