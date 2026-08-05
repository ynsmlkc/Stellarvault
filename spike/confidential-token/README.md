# Spike — Stellar Vault × Confidential Tokens

Answers one question before any code is deleted: **can the vault hold and spend a
confidential balance using OpenZeppelin's confidential token, instead of our own
`shield-pool`?**

Yes. Verified on testnet, and **no vault contract changes were needed** — it
rides entirely on `propose_call`, the arbitrary-call feature added on 2026-08-02.

## Result

Vault `CD35NYRRXMTU37O6YFS2BMTYUF2EQV7RSKQJIAFZ3ZZO2C7WE7H2HJSF` (VERSION 4):

```
[allowlist] letting the vault call the confidential token …
[register]  proposal #0 executed → register()      the VAULT is now a confidential account
[deposit]   deposited 1000                          public XLM → the vault's receiving balance
[merge]     proposal #1 executed → merge()
            vault spendable = 1000
[confidential_transfer]
            proposal #2 executed → confidential_transfer()
            vault spendable = 600 (was 1000)
```

A confidential payment is just a proposal. The threshold governs it exactly like
a transfer or any other call — time-lock applies, cancellation applies, the call
allowlist applies.

## The trust model, which is the part worth arguing about

Balances are Pedersen commitments; spending needs a Grumpkin key to build the
proof. A contract cannot hold a secret, so **someone** holds the vault's Grumpkin
key — in this spike it is derived from the owner's Stellar signature over a fixed
message, the same shape as the vault's ZK signer key.

That key cannot move funds on its own. `confidential_transfer(from = vault, …)`
requires the **vault** to authorise, and the vault only authorises what its
signers approved. So the Grumpkin key is a *proving and viewing* key: whoever
holds it can see the vault's confidential balance and construct proposals, but
cannot execute one alone.

What that costs: every potential proposer needs the key, so the confidential
balance is visible to that group. For a treasury whose signers are already
trusted with the balance, that is not obviously a loss — but it is a real
difference from the public path, and it should be stated rather than glossed.

## What this does and does not replace

| | Hides | Replaced by Confidential Tokens? |
| ------------------- | ------------------------------ | -------------------------------- |
| `shield-pool` (ours) | amount + sender↔recipient link | **Yes** — theirs is maintained, has an auditor channel, and is heading for a standard. Ours is a 16-note demo tree. |
| `voteApproval` (ours) | **which signer approved** | **No.** Confidential Tokens leave sender and recipient addresses public by design; they hide amounts. Nothing here touches approver anonymity. |

So "swap the ZK for Confidential Tokens" is only coherent for the *shield-pool*
half. Removing `voteApproval` would remove a capability the confidential token
does not provide.

One thing ours does that theirs does not: sever the sender↔recipient link.
Confidential Tokens publish both addresses. If unlinkability matters more than
amount privacy, they are not a superset.

## Maturity

From the upstream README, unchanged as of this spike:

> **Not production ready.** The UltraHonk verifier backend and the circuits are
> unaudited. Testnet only; do not use with real value.

It is a developer preview built on OpenZeppelin's `stellar-contracts`
`feat/confidential-verifier-ultrahonk` branch — a feature branch, not `main`.
Adopting it trades a small, self-contained, audited-by-nobody circuit of ours for
a larger, better-designed, audited-by-nobody stack of theirs, plus a dependency
on a moving branch.

## Deployed contracts used (testnet)

| | |
| --------- | ---------------------------------------------------------- |
| token     | `CBF64DEOVQAXJFBSNGFEUT2AH4H7K5JBY3ZYJ5GVEINMNSDISWRG5N3F` |
| verifier  | `CDCET36PIS44DWJM5UQSSI4ZHGRDSBIIQW4G4ALPYK3Y6FEQGY5ZWFXL` |
| auditor   | `CA4II62E35TQKPGHCPBD6EBAS732GSGS6H37UUWKEDHR4YTBVMPHVY4L` |
| underlying | native XLM SAC                                            |

## Reproducing

The spike needs the upstream demo repo for its SDK and circuit artifacts:

```bash
git clone https://github.com/brozorec/stellar-confidential-token-demo
cd stellar-confidential-token-demo && pnpm install && pnpm build:sdk
cp <this-dir>/deployment.testnet.json deployments/testnet.json
cp <this-dir>/vault-ct-spike.ts scripts/
OWNER_SECRET=… VAULT=C… pnpm --filter @ctd/sdk exec tsx ../../scripts/vault-ct-spike.ts
```

`pnpm e2e` in that repo runs their own flow first — worth doing as a gate, since
if their proving stack does not run locally, ours cannot either.

## What a real integration would still need

The contract side is done (nothing to do). The remaining work is all client-side:

- **Key management** — deriving, and re-deriving, the vault's Grumpkin key, and
  deciding who holds it.
- **Balance reconstruction** — confidential balances are rebuilt from events by
  their `StateEngine`. That needs wiring into the dashboard, and it depends on
  RPC event retention (~7 days) or their optional indexer for older history.
- **Proof generation in the browser** — bb.js/UltraHonk, considerably heavier
  than our snarkjs Groth16 bundle.
- **UI** — register / deposit / merge / transfer / withdraw as vault proposals,
  plus surfacing a balance nobody else can read.
