# 🔐 Stellar Vault — Confidential Multi-Sig Treasury

**🌐 [Live app](https://stellarvault-olive.vercel.app) &nbsp;·&nbsp; ▶ [Watch the demo](https://youtu.be/eVrGjdqSn-4) &nbsp;·&nbsp; 📊 [Pitch deck](https://stellarvault-olive.vercel.app/pitch.html)**

> **The first _confidential_ multi-signature treasury on Stellar — each transaction can be transparent _or_ private.**
> Approve as a team. Reveal nothing. Built on Soroban with real zero-knowledge proofs.

[![CI](https://github.com/ynsmlkc/Stellarvault/actions/workflows/ci.yml/badge.svg)](https://github.com/ynsmlkc/Stellarvault/actions/workflows/ci.yml)
[![Network](https://img.shields.io/badge/network-Stellar%20Testnet-7FB069)](https://stellar.expert/explorer/testnet/contract/CA3VDWIXCP4THSE7HTYAGTYGY257USCN2WYC2JOI7C3IUVZKPV4JXTAW)
[![Contract](https://img.shields.io/badge/Soroban-Rust%20SDK%2027-C9A86A)](vault-instance/)
[![ZK](https://img.shields.io/badge/ZK-Groth16%20%C2%B7%20circom-C9A86A)](circuits/)

---

## The problem

Stellar already has multi-sig — **natively** (account-level signers + thresholds) and through products like **LOBSTR Vault**, **Solar**, and **StellarGuard**. But every one of them shares two limits:

1. **Fully transparent.** On a public ledger, every fund movement reveals who proposed, **who approved**, how much, and to whom. For payroll, OTC deals, grants, or treasury rebalancing, that's a liability — it leaks salaries, strategy, and counterparties.
2. **Native = not programmable.** Native multi-sig is a fixed protocol feature — signers, weights, thresholds, nothing more. You cannot add custom on-chain logic (spending limits, time-locks, modules, or zero-knowledge).

There is no **confidential** multi-sig on Stellar, and no programmable one. That's the gap.

## The solution

A Soroban **smart-contract** multi-sig where the initiator picks the privacy level **per transaction** — plus a confidential balance where amounts never touch the ledger:

|                    | **Transparent**          | **Private (ZK)**                                                                      |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------- |
| Who proposed       | ✅ Visible               | ✅ Visible                                                                            |
| **Who approved**   | ✅ Visible (Alice, Bob…) | 🔒 **Hidden** — a ZK proof: "a valid signer approved", chain records only a nullifier |
| Amount / Recipient | ✅ Public                | Visible to co-signers (they approve it), public on-chain                              |
| Feel               | A public bank statement  | An anonymously-signed payment                                                         |

**Voter privacy** (above) hides _who approved_. To hide **how much**, a vault can also hold a **confidential balance** on OpenZeppelin's confidential token — real XLM, wrapped, with amounts kept off-chain entirely.

Same vault, same threshold — **you decide what the chain is allowed to see.**

---

## Why a smart-contract vault — not native multi-sig

Stellar's native multi-sig (and the wallets built on it — LOBSTR Vault, Solar, StellarGuard) is a **fixed protocol primitive**: it counts signatures against a threshold, and that's all. It **cannot run custom logic**. Stellar Vault is a **Soroban smart contract**, which is exactly what makes the rest possible:

- **Zero-knowledge approvals** — verifying + recording a Groth16 nullifier on approval is logic a native account simply cannot execute.
- **Confidential balances** — holding and spending a commitment-based balance needs a contract that can be the account, not just an address.
- **A factory, one contract per vault** — each vault is its own deployed contract (own address, own native balance), Gnosis-Safe-style.
- **Guards** — a per-tx limit, a rolling spending cap, a time-lock and a recipient allowlist, all enforced *by the vault itself*. A native account has one lever: the threshold.
- **Batch (multi-call)** — up to 20 payments approved once and settled atomically. Native multi-sig has no notion of "these move together or not at all."

The transparent products prove the **demand** for multi-sig on Stellar. We add the two things native multi-sig structurally can't: **privacy** and **programmability**.

> LOBSTR Vault is "Stellar's signing app." Stellar Vault is "Stellar's **confidential, programmable** Safe."

---

## What's built (honest status)

| Layer                                           | Status                   | Detail                                                                                                                                                                                                                |
| ----------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Soroban multi-sig vault**                     | ✅ **Live on testnet**   | create vault, signer mgmt, threshold, propose, approve, execute, cancel — 7/7 contract tests pass                                                                                                                     |
| **Transparent flow**                            | ✅ **Fully working**     | propose → approve → execute moves **real XLM** on testnet, wallet-signed                                                                                                                                              |
| **ZK voter privacy**                            | ✅ **Real ZK**           | own `voteApproval.circom` (Poseidon + Merkle membership + nullifier), proofs generated **in-browser** and verified **on-chain**; signer keys come from a wallet signature, leaves are published shuffled, and `approve_zk_anon` needs no wallet to identify itself — see the limits below |
| **dApp frontend**                               | ✅ **Working**           | Next.js 14 + Freighter, live on-chain reads, wallet-signed writes, cinematic "Vault Gold" UI                                                                                                                          |
| **Safe-style factory — one contract per vault** | ✅ **Live**              | a factory deploys a fresh contract per vault (own address, own native balance, on-chain `owner→vaults` registry) + per-vault names — true Gnosis-Safe architecture                                                    |
| **Confidential balances**                       | ✅ **Live on testnet**   | a vault holds a second balance on OpenZeppelin's confidential token (Pedersen commitments, UltraHonk proofs) wrapping real XLM — **amounts never appear on-chain**. Every operation is an ordinary proposal, so the threshold and time-lock govern it. Sender and recipient stay public; the auditor channel is bound to a key nobody holds (see below) |
| **Governance by proposal**                      | ✅ **Live on testnet**   | threshold, signers, guards, allowlists, ownership and the contract's own code all change only by proposal at the vault's own threshold — no owner-only path to any rule, and no unilateral veto |
| **Safe-style guards**                           | ✅ **Live on testnet**   | policy enforced on every execution — per-transaction limit, rolling spending cap, time-lock, recipient allowlist — plus **batch (multi-call)** proposals, cancellation and typed contract errors             |
| **Arbitrary contract calls**                    | ✅ **Live on testnet**   | a proposal can call any allowlisted contract — swap on a DEX, supply to a lending market, move an asset the vault wasn't created with. Multi-asset falls out of it; the vault can never call itself |
| **On-chain Groth16 verify**                     | ✅ **Live on testnet**   | a verifier contract keyed to **our** circuit's vk checks every ZK approval, and the vault pins all four public inputs to itself, its published signer set and the specific proposal — so anonymity is now a guarantee, not a convention |

> **TL;DR** — a deployed, wallet-signed multi-sig dApp with a **fully working transparent flow**, **ZK voter privacy verified on-chain**, **Safe-style guards**, **arbitrary contract calls**, and **confidential balances** — all on testnet.

---

## Architecture

```
┌──────────────────────────── STELLAR VAULT dApp ────────────────────────────┐
│                                                                            │
│   Next.js 14 + Freighter          Stellar Testnet (Soroban, protocol 27)   │
│   ┌──────────────────┐            ┌──────────────────────────────────────┐ │
│   │  web/            │  create    │  vault-factory                       │ │
│   │  Vault Gold UI   │───────────▶│  one contract per vault + registry   │ │
│   │                  │            └──────────────┬───────────────────────┘ │
│   │  snarkjs prover  │                           │ deploys                 │
│   │  (voteApproval)  │            ┌──────────────▼───────────────────────┐ │
│   │                  │  reads /   │  vault-instance                      │ │
│   │  bb.js prover    │──writes───▶│  • propose / propose_batch           │ │
│   │  (confidential)  │  (signed)  │  • propose_call → any allowlisted    │ │
│   └──────────────────┘            │  • approve / approve_zk_anon         │ │
│                                   │  • execute, under the guards:        │ │
│                                   │    limit · cap · time-lock · allow   │ │
│                                   └────┬──────────────────────┬──────────┘ │
│                                        │ verifies             │ calls      │
│                          ┌─────────────▼────────┐  ┌──────────▼──────────┐ │
│                          │  groth16-verifier    │  │  confidential token │ │
│                          │  BN254, our vk       │  │  (OpenZeppelin)     │ │
│                          │  who approved: hidden│  │  amounts: hidden    │ │
│                          └──────────────────────┘  └─────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

## Tech stack

| Layer          | Tech                                                 |
| -------------- | ---------------------------------------------------- |
| Smart contract | Rust + Soroban SDK 27 (BN254 host functions)          |
| ZK circuit     | circom 2.2 + circomlib (Poseidon, Merkle membership) |
| Proving        | snarkjs (Groth16, BN254) — runs in the browser       |
| Frontend       | Next.js 14 (App Router) + React 18 + TypeScript      |
| Wallet         | Freighter (`@stellar/freighter-api`)                 |
| SDK            | `@stellar/stellar-sdk` 16 (Protocol 23)              |

---

## Live testnet deployment

**🌐 Live app: https://stellarvault-olive.vercel.app** &nbsp;·&nbsp; **📊 Pitch deck: https://stellarvault-olive.vercel.app/pitch.html**

| Contract                                               | ID                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| **Vault Factory** (deploys one contract per vault)     | `CA3VDWIXCP4THSE7HTYAGTYGY257USCN2WYC2JOI7C3IUVZKPV4JXTAW` |
| **Groth16 verifier** (keyed to our voteApproval circuit) | `CDAG3Y7JS52WCIOWO37FDXVTS5WQBSCRNPO42NRSKV53LYQQTPWH3GLB` |
| **Confidential token** (OpenZeppelin, wraps XLM)      | `CDTZAT6D3XYS43A5Z6KVXZIFCBIVLBNO4R75OF2WWLCMCWZDQNBI3W2K` |
| Token (XLM SAC)                                        | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| Nethermind Private-Payments Pool / Verifier (explored) | `CCQRXA6U…` / `CDRMXX3O…`                                  |

Each vault is its own contract, deployed by the factory — view a vault by its address on stellar.expert.
🔭 [View the Factory on stellar.expert](https://stellar.expert/explorer/testnet/contract/CA3VDWIXCP4THSE7HTYAGTYGY257USCN2WYC2JOI7C3IUVZKPV4JXTAW)

---

## Run it locally

### 1. Contract tests

```bash
# 70 unit tests across the live contract crates
cargo test --manifest-path vault-instance/Cargo.toml   # 60 pass (vault + guards + zk + calls + governance)
cargo test --manifest-path groth16-verifier/Cargo.toml  # 6 pass  (Groth16 over BN254)
cargo test --manifest-path vault-factory/Cargo.toml    # 4 pass  (init guard, registry, forget/remember)

# build a contract to wasm
cargo build --manifest-path vault-instance/Cargo.toml --target wasm32v1-none --release
```

### 2. ZK circuit + proof (already built; to rebuild)

```bash
cd circuits
circom voteApproval.circom --wasm --r1cs -l node_modules/circomlib/circuits -o build
# trusted setup + a real prove/verify roundtrip:
node test.mjs         # ✓ proof generated, verified, soundness + double-vote checks
```

### 3. Frontend unit tests

```bash
cd web && npm test        # 18 tests — amount parsing, formatting, error mapping, Fp2 proof ordering
```

Rendering is not covered: it needs a browser, a wallet and a live chain. The
suite targets the pure logic instead, which is where this project's UI bugs have
actually lived — an amount parser that read `1,5` as 15, a proof encoder whose
G2 byte order silently invalidated every proof.

### 3. Frontend

```bash
cd web
npm install
npm run dev           # http://localhost:3000
```

Connect **Freighter** (Testnet, friendbot-funded), then:
**Create Vault → New Transaction → Approve → Execute** (transparent moves real XLM; private generates a real ZK proof).

---

## Zero-knowledge: voter privacy

`circuits/voteApproval.circom` proves, **without revealing which signer**:

1. **Membership** — "I know a secret whose commitment is in this vault's signer Merkle tree" → I'm a valid signer.
2. **Binding** — the vote is tied to this exact `(vaultId, txHash)`.
3. **Nullifier** — `Poseidon(commitment, txHash)` is a unique, one-way tag → double-voting is detectable, identity is **not** recoverable.

Public inputs: `[vaultId, txId, signerRoot, nullifier]`. Everything else is private.
Proofs are generated **in the browser** with snarkjs (~0.3s), and `approve_zk` **verifies them on-chain** through [`groth16-verifier`](groth16-verifier/) before counting the approval. The `ZKApprovedEvent` emits **only the nullifier** — never the signer.

### Why verifying the proof was not enough

The nullifier is `Poseidon(commitment, txId)` and `txId` is a public input **the prover chooses**. A contract that verified the proof but left `txId` unbound would still be broken: one signer could pick arbitrary `txId` values, produce a valid proof for each, get a fresh nullifier every time, and approve a single proposal until the threshold was met, alone.

So the vault pins every public input to something it already knows:

| Public input | Checked against |
| ------------ | --------------- |
| `vaultId`    | this vault's domain id |
| `txId`       | the proposal being approved |
| `signerRoot` | the root the owner published |
| `nullifier`  | the nullifier being recorded |

### Paying someone who isn't in the system

A confidential transfer encrypts the amount to the recipient's key, so an
address that never registered cannot receive one — there is nothing to encrypt
to. Taken alone that would make the feature close to useless for a treasury:
you cannot ask every contractor, grantee and supplier to onboard before you can
pay them.

There is no way around it, and it is not a limitation of this app: an
unregistered address cannot receive value on the confidential side by any route.
`confidential_transfer` has no key to encrypt to, and even `deposit` — which
carries no proof — is refused with `Error(Contract, #3501)`. So "pay them now,
let them claim it later" is not available either.

Given that, an unregistered recipient gets paid by `withdraw` instead: ordinary XLM
leaves the hidden balance and lands in their account, and they need to know
nothing about any of this. That payment's amount is public, because it exits as
a normal SEP-41 transfer. The vault's remaining balance stays hidden.

The app picks between the two by checking the address as it is typed, and says
which one it is about to do and what that reveals. The honest summary is that
this hides your treasury's balance and its payments to other participants, and
reveals individual payments to outsiders — not that everything is hidden.

### The auditor channel, and why ours cannot be opened

The confidential token emits a ciphertext to a registered auditor key on every
transfer, and the design has no switch for it — amounts are confidential *and*
auditable, which is the point for regulated users.

What it does not require is that anyone hold the matching secret. An auditor key
derived by hashing a fixed string onto Grumpkin — rather than as `k·G` — is a
valid curve point for which no discrete log is known to anyone. Bound to that,
the channel stays structurally present and is openable by no one.

This deployment does exactly that: the key comes from
`"stellar-vault/no-auditor/v1"`, and the derivation is published in
[`spike/confidential-token/nothing-up-my-sleeve.ts`](spike/confidential-token/nothing-up-my-sleeve.ts)
so the claim is checkable rather than trusted. Verified on testnet — registry
accepts the key, accounts register against it, transfers settle normally.
Grumpkin's cofactor is 1, so there is no small-subgroup concern.

`NEXT_PUBLIC_CONFIDENTIAL_AUDITOR_INDEX` switches between this and a real
auditor keypair, because "confidential and auditable" is the better answer for
some users and the choice should be explicit rather than baked in.

Open question, asked upstream and not yet answered: whether they consider a
keyless auditor a sound configuration, or whether something downstream assumes a
real keypair exists.

### What the anonymity is, precisely

Three separate things had to be true, and each was a distinct fix:

1. **The commitment must be unguessable.** It is derived from a wallet signature over a fixed per-vault message (Ed25519 is deterministic, so a signer regenerates it on demand and stores nothing). Deriving it from the signer's *address* — as an earlier version did — made every input public, and an observer could compute `Poseidon(commitment, txId)` for each signer and match it against the published nullifier. With three signers that was three guesses.
2. **The published leaves must not be attributable.** A prover needs every leaf to build its Merkle path, so the list is necessarily public — but published in signer order it hands back the same mapping. The owner publishes them **shuffled**.
3. **No wallet may have to identify itself.** `approve_zk_anon` takes no signer address and calls no `require_auth`: the proof is the authorization. Verified on testnet by having a non-signer submit a valid approval, with the ledger recording only the submitter.

**What still leaks, plainly:**

- **The anonymity set is the signer count.** If 2 of 3 approved, an observer knows exactly that — each signer is 2/3 likely to be one of them. This is structural: proving the threshold was met is the point. It only becomes meaningful privacy with a larger signer set (the tree holds 16).
- **Whoever collects the commitments knows the mapping**, unless registration is itself relayed.
- **The submitter is still a public account.** `approve_zk_anon` makes relaying *possible*; until a relayer exists, a signer submitting their own proof is still named by the transaction.

### Governance is m-of-n too

Every rule the vault runs on — threshold, signer set, guards, both allowlists,
verifier config, ownership, and the contract's own code — changes only by
proposal, at the same threshold as a payment, under the same time-lock. There is
no owner-only entry point to any of it.

This was not true until v5. The owner could lower the threshold to 1 or replace
the code outright, so every guard on this page sat behind one key. Safe solves
it by having the multi-sig call itself; Soroban refuses to re-enter a contract
that is on the call stack, so the change travels as data the vault applies to
itself instead.

The owner's power to cancel any proposal went with it — a key that can veto the
proposal removing it is not constrained by that proposal. Cancelling belongs to
the proposer; signers who disagree simply withhold approval.

Verified live on a 2-of-3 testnet vault: `SetThreshold(1)` with one approval
fails with `Error(Contract, #10)` and the threshold does not move; with two, it
does.

---

## Demo flow (3 minutes)

1. **Create a vault** — connect Freighter, pick signers + threshold, sign on-chain.
2. **Transparent transaction** — propose 10 XLM → approve → execute. Recipient balance visibly increases. _"Alice, Bob approved. 10 XLM → GXYZ…"_
3. **Turn on verification** — in Guards, each signer derives their commitment from a wallet signature; the owner publishes the set (shuffled) and the root is pinned. The panel flips to **ENFORCED**.
4. **Private transaction** — toggle to Private, propose → **Approve (ZK)**: a real Groth16 proof is generated in-browser, verified **on-chain** by the verifier contract, and submitted through `approve_zk_anon` — no wallet identifies itself. _"🔒 approved — the ledger records only a nullifier."_
5. **Guards** — set a per-tx limit and a time-lock, then watch a proposal be refused before it is even signed, and an approved one sit locked until its ledger.
6. **Contract call** — allowlist a contract, propose a call, execute: the vault acts as itself on another contract.

---

## Roadmap

Because each vault is a programmable smart contract (not native multi-sig), it's the right foundation for Gnosis-Safe-style extensibility — things native multi-sig structurally can't add:

- **More Safe-style modules** — role-based access (proposer / approver / executor), session keys, social recovery, transaction simulation before signing. Spending limits, rolling caps, time-locks, a recipient allowlist, batched multi-call and **arbitrary contract calls** are **already live** (see the status table).
- **Off-chain approval collection** — today each approval is its own transaction; Safe collects signatures off-chain and submits one. A real cost and UX difference.
- **Relayer / meta-tx** — full approver anonymity (today the tx source still reveals the submitter; the on-chain event already hides it).
- **Recipient privacy** — confidential balances hide amounts but leave sender and recipient public. Severing that link is a separate problem; our earlier `shield-pool` did it at demo scale and was retired in favour of a maintained standard, so this is an open gap rather than a solved one.
- DeFi integrations, mobile, production audit.

---

## How it evolved — feedback & iteration

I tested the dApp continuously as a user and iterated based on what broke or felt wrong. Every one of these is a separate commit in this repo's history:

- **Biggest one:** while testing, I noticed every vault shared a single balance. That pushed me to re-architect the whole thing into a **Safe-style factory** — one separate contract per vault, with isolated balances and an on-chain registry. A major rewrite driven directly by testing.
- A co-signer on a second account **couldn't see the shared vault**, so I changed the factory to register each vault under **every signer**, not just the owner.
- Private transactions weren't moving funds and the "private hides everything" framing was misleading — so I made private execution **actually move funds** and reframed it honestly: private = **anonymous approvals**, with a separate layer for hiding amounts (at the time our own shielded pool; now OpenZeppelin's confidential token).
- Execute occasionally failed on the first try due to RPC lag → added **retries + longer polling**.
- The "Approve" button stayed after approving and errored on re-click → added a clear **"you approved · waiting"** state.
- On mobile it wasn't responsive → added a **responsive layout**.
- Removed confusing / dead UI (a demo vault, a non-functional wallet button, a duplicate CTA).

---

## Repository layout

```
vault-factory/     Soroban factory — deploys one vault contract per vault (+ owner→vaults registry)
vault-instance/    the vault itself — own address and balance, guards, proposals, contract calls
groth16-verifier/  on-chain Groth16 verifier keyed to voteApproval.circom (BN254)
circuits/          voteApproval.circom (voter privacy) + Groth16 setup + end-to-end tests
web/               Next.js 14 dApp (Vault Gold UI, Freighter, snarkjs + confidential-token client)
spike/             bounded experiments kept as evidence (BN254 availability, confidential tokens)
deployments/       testnet addresses and what each deployment changed
docs/              architecture, ZK, roadmap, hackathon record
```

---

_Built for the Stellar Hacks ZK Hackathon. Privacy primitives adapted from Nethermind's `stellar-private-payments` (Apache-2.0)._
