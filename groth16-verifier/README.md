# groth16-verifier

On-chain Groth16 verification for `circuits/voteApproval.circom`, on BN254.

Until now the ZK approvals were **real but not enforced**: proofs were generated
and verified in the browser, while `approve_zk` only checked that the proof was
non-empty and that the nullifier had not been seen. Anyone willing to bypass the
UI could have sent 256 arbitrary bytes. This contract closes that gap.

## Status

| | |
| ----------------------- | ---------------------------------------------------------- |
| Testnet                 | `CDAG3Y7JS52WCIOWO37FDXVTS5WQBSCRNPO42NRSKV53LYQQTPWH3GLB` |
| Real proof              | verifies → `true` (on-chain, testnet protocol 27)           |
| Tampered nullifier      | rejected → `false`                                          |
| Unit tests              | 6 pass                                                      |
| Wasm size               | 4,986 bytes                                                 |

Not yet wired into `vault-instance.approve_zk` — that is the next step, together
with binding `signerRoot` into the vault so membership is enforced on-chain and
not merely asserted by the prover.

## How it works

Groth16 verification is the pairing equation

```
e(A, B) == e(alpha, beta) * e(vk_x, gamma) * e(C, delta)
```

with `vk_x = IC[0] + sum(public_i * IC[i])`. Moving everything to one side makes
it a single multi-pairing against the identity:

```
e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
```

So the whole check is one `g1_msm` to fold the public inputs, then one
`pairing_check` — both BN254 host functions (CAP-0074 / CAP-0080).

## Design notes

- **The verification key is compiled in** (`src/vk.rs`, generated). There is no
  admin path to swap it, so this contract can only ever attest to the one
  circuit it was built for.
- **No funds, no state, no auth.** Cryptography only. `vault-instance` decides
  what a `true` means. Keeping them apart means the vault can be upgraded
  without touching audited crypto, and vice versa.
- **`-A` is computed here**, not accepted from the caller, so a caller cannot
  substitute a different point.
- **Malformed points trap rather than return `false`.** A bad encoding is a
  caller bug, not a failed proof, and the two should not look the same.

## Byte layout

The single most likely way to build a verifier that rejects every valid proof is
to get this wrong — snarkjs orders `Fp2` coordinates real-part-first, the host
wants imaginary-part-first.

```
G1 = be32(x) || be32(y)                                   (64 bytes)
G2 = be32(x_c1) || be32(x_c0) || be32(y_c1) || be32(y_c0) (128 bytes)
Fr = be32(scalar)                                         (32 bytes)
```

## Regenerating the key and fixtures

```bash
cd circuits && node dump-groth16.mjs   # writes build/groth16_fixture.json
```

That script refuses to emit anything unless snarkjs verifies the proof it just
generated — so if the contract test fails, the contract disagrees with the
reference verifier, rather than the fixture being bad.

Then regenerate `src/vk.rs` from the fixture (see the header of that file).

## Test

```bash
cargo test    # 6 tests: valid proof, three tampered variants, arity, n_public
```
