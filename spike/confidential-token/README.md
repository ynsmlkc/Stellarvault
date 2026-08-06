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

## Our own deployment (testnet)

The first run borrowed the upstream demo's contracts, which meant **their**
auditor key could decrypt our amounts. So we deployed our own stack, and the
vault flow was re-verified against it end to end.

| | |
| ---------- | ---------------------------------------------------------- |
| token      | `CDTZAT6D3XYS43A5Z6KVXZIFCBIVLBNO4R75OF2WWLCMCWZDQNBI3W2K` |
| verifier   | `CCB4WJQHSKSY2KF6BYZ6IUISTERRBGLHM5WU4E6CLWW2E4QOSMDVKRNZ` |
| auditor    | `CDJAFGSWQSYV32IMG5B7LYOULDJDCZM3AOSNSFV76YKDSEYZ34L5VGOW` |
| underlying | native XLM SAC — real XLM, not a new asset                 |
| allowlist  | `CC5VE5LHHA6TXXWLT4MYTO7NRC2WJGF4UDNGDCBR3FS3RVNJ6ZZETFMH` |
| blocklist  | `CCTN7HN4FRGL763VG7OPC5XIXAKWRLH5O7JPLRM2Y45AQGI23M6A7QMD` |
| factory    | `CBXH5SYQ73KMM5F5FNWQGFK3TYXJL6LFYLYSOCWSHTH2P34WZ3QS4DQV` |

Deployed by the `admin` CLI identity, which also holds the auditor secret. It is
**not** in `deployment.testnet.json` here — regenerate the stack with
`pnpm deploy:contracts` to get your own.

Worth being clear about what this is: a confidential token is a **wrapper**, not
a new asset. `underlying_asset` is the native XLM SAC, so deposits are real XLM
going in and withdrawals are real XLM coming out. Only the container changes.

All six circuit verification keys (register, withdraw, transfer,
spender_transfer, set_spender, revoke_spender) are registered in our verifier,
and `addr_f` parity against the circuits was checked at deploy time.

Re-verified against this stack, vault `CAETYEOTYEAGZZLIE6GLTLUKK3LZPJCCC6E2BKZ4JWUTEMMUVCTOHQRD`:
register -> deposit 1000 -> merge -> confidential_transfer 400 -> spendable 600.

### Can the auditor channel be neutered? Mechanically, yes

`nothing-up-my-sleeve.ts` registers an auditor key derived by hashing a fixed
string onto the curve rather than by computing k·G, so no `k` exists that anyone
knows. Registered as auditor 1 on our own registry, two accounts bound to it, a
transfer of 400 executed and settled — the circuits raise no objection.

    nothing-up-my-sleeve auditor key
      x = 5842be7fb45a89dc5f85c700…
      on curve: ok, discrete log: unknown to anyone
    registry accepted it: true
    transfer accepted on-chain, spendable 1000 -> 600

Grumpkin has cofactor 1, so every valid point is in the prime-order group and
there is no small-subgroup concern. The ciphertexts are still emitted; they are
simply openable by nobody.

What this establishes is that it **works**, not that it is **sound** — whether
the designers consider a keyless auditor an acceptable configuration, or whether
something downstream assumes a real keypair, is exactly the question to put to
them. Anyone verifying the claim would need the derivation string published, so
that the key is checkably nothing-up-my-sleeve rather than merely asserted.

### The auditor, now that we control it

The design always has one: every transfer emits a ciphertext to the registered
auditor key, so amounts are confidential *and* auditable. That is the point for
regulated users, and a cost for anyone wanting privacy with no back door.

Holding the key ourselves answers the "who is the auditor" question, but does not
remove the channel. Whether it can be neutered — by registering a point whose
discrete log nobody knows — is untested, and the circuits may well reject it.
Our own `shield-pool` has no such channel at all, which remains a real
difference between the two options rather than a detail.

## The sub-call authorisation, verified both ways

`deposit(from = vault)` makes the token call the underlying SAC's
`transfer(from = vault, …)` — one level below the vault's own call. A contract's
authority covers only what it invokes directly, so the host refuses that
transfer however the proposal was approved:

    Error(Auth, InvalidAction)
    "encountered unauthorized call for a contract earlier in the call stack,
     make sure that you have called `authorize_as_current_contract()`"

Naming the sub-call in the proposal fixes it. Both directions are observed on
testnet, vault `CBKAED23M23M6CFZ6UJ74WMT4DWRSXBLECCO7DQIFPNZD23GV2KJFVXU`:

| | |
| --------------------------- | ------------------------------------------- |
| deposit without the auth list | `Error(Auth, InvalidAction)`               |
| deposit with it              | proposal executed, 1000 moved in            |
| then merge, then transfer 400 | spendable 1000 -> 600                      |

`authorize_as_current_contract` appears nowhere in the upstream demo, and there
is no contract-owned-account example — reasonable, since the demo is built
around user wallets. It is worth asking upstream whether this is the intended
pattern for a contract holding a confidential balance, or whether
`set_spender` / `confidential_transfer_from` is meant to cover it.

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
