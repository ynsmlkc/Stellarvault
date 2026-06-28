# 🔐 Stellar Vault — Confidential Multi-Sig Treasury

**▶ [Watch the demo](https://youtu.be/eVrGjdqSn-4)**

> **The first _confidential_ multi-signature treasury on Stellar — each transaction can be transparent _or_ private.**
> Approve as a team. Reveal nothing. Built on Soroban with real zero-knowledge proofs.

[![Network](https://img.shields.io/badge/network-Stellar%20Testnet-7FB069)](https://stellar.expert/explorer/testnet/contract/CBL2WDAFURF5UR2FRKIXLJA4CF2DJ5BXWCFD6S5EIHWCLHOXBS3U753J)
[![Contract](https://img.shields.io/badge/Soroban-Rust%20SDK%2023-C9A86A)](stellar-vault/)
[![ZK](https://img.shields.io/badge/ZK-Groth16%20%C2%B7%20circom-C9A86A)](circuits/)

---

## The problem

Stellar already has multi-sig — **natively** (account-level signers + thresholds) and through products like **LOBSTR Vault**, **Solar**, and **StellarGuard**. But every one of them shares two limits:

1. **Fully transparent.** On a public ledger, every fund movement reveals who proposed, **who approved**, how much, and to whom. For payroll, OTC deals, grants, or treasury rebalancing, that's a liability — it leaks salaries, strategy, and counterparties.
2. **Native = not programmable.** Native multi-sig is a fixed protocol feature — signers, weights, thresholds, nothing more. You cannot add custom on-chain logic (spending limits, time-locks, modules, or zero-knowledge).

There is no **confidential** multi-sig on Stellar, and no programmable one. That's the gap.

## The solution

A Soroban **smart-contract** multi-sig where the initiator picks the privacy level **per transaction** — plus a shielded pool for fully confidential transfers:

|                    | **Transparent**          | **Private (ZK)**                                                                      |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------- |
| Who proposed       | ✅ Visible               | ✅ Visible                                                                            |
| **Who approved**   | ✅ Visible (Alice, Bob…) | 🔒 **Hidden** — a ZK proof: "a valid signer approved", chain records only a nullifier |
| Amount / Recipient | ✅ Public                | Visible to co-signers (they approve it), public on-chain                              |
| Feel               | A public bank statement  | An anonymously-signed payment                                                         |

**Voter privacy** (above) hides _who approved_. For a transfer where the **amount + recipient** are hidden from everyone — and the deposit↔recipient link is severed — there's a separate **shielded pool** (our own `confidentialTransfer` circuit).

Same vault, same threshold — **you decide what the chain is allowed to see.**

---

## Why a smart-contract vault — not native multi-sig

Stellar's native multi-sig (and the wallets built on it — LOBSTR Vault, Solar, StellarGuard) is a **fixed protocol primitive**: it counts signatures against a threshold, and that's all. It **cannot run custom logic**. Stellar Vault is a **Soroban smart contract**, which is exactly what makes the rest possible:

- **Zero-knowledge approvals** — verifying + recording a Groth16 nullifier on approval is logic a native account simply cannot execute.
- **Confidential execution** — moving funds through a shielded pool needs a programmable contract.
- **A factory, one contract per vault** — each vault is its own deployed contract (own address, own native balance), Gnosis-Safe-style.

The transparent products prove the **demand** for multi-sig on Stellar. We add the two things native multi-sig structurally can't: **privacy** and **programmability**.

> LOBSTR Vault is "Stellar's signing app." Stellar Vault is "Stellar's **confidential, programmable** Safe."

---

## What's built (honest status)

| Layer                                           | Status                   | Detail                                                                                                                                                                                                                |
| ----------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Soroban multi-sig vault**                     | ✅ **Live on testnet**   | create vault, signer mgmt, threshold, propose, approve, execute, cancel — 7/7 contract tests pass                                                                                                                     |
| **Transparent flow**                            | ✅ **Fully working**     | propose → approve → execute moves **real XLM** on testnet, wallet-signed                                                                                                                                              |
| **ZK voter privacy**                            | ✅ **Real ZK**           | own `voteApproval.circom` (Poseidon + Merkle membership + nullifier), real Groth16 proofs generated **in-browser**, `approve_zk` records the nullifier on-chain — identity hidden in the event, double-vote prevented |
| **dApp frontend**                               | ✅ **Working**           | Next.js 14 + Freighter, live on-chain reads, wallet-signed writes, cinematic "Vault Gold" UI                                                                                                                          |
| **Safe-style factory — one contract per vault** | ✅ **Live**              | a factory deploys a fresh contract per vault (own address, own native balance, on-chain `owner→vaults` registry) + per-vault names — true Gnosis-Safe architecture                                                    |
| **Confidential transfers (shielded pool)**      | ✅ **Real ZK, deployed** | our own `confidentialTransfer.circom` + `shield-pool` contract: deposit → **unlinkable** confidential send; on-chain only commitments + nullifiers, the sender↔recipient link is severed                              |
| **On-chain Groth16 verify**                     | 🚧 **Roadmap**           | proofs are real & browser-verified today; an on-chain verifier keyed to our circuits is the production hardening step — now unblocked by the Jan-2026 "X-Ray" upgrade (BN254 + Poseidon host functions on Soroban)    |

> **TL;DR** — a deployed, wallet-signed multi-sig dApp with a **fully working transparent flow**, **real ZK voter privacy**, and a **real shielded pool for confidential transfers** — all on testnet.

---

## Architecture

```
┌──────────────────────────── STELLAR VAULT dApp ────────────────────────────┐
│                                                                            │
│   Next.js 14 + Freighter            Stellar Testnet (Soroban)              │
│   ┌────────────────┐    reads/      ┌───────────────────────────────────┐  │
│   │  web/          │───writes──────▶│  Vault Contract (stellar-vault/)  │  │
│   │  Vault Gold UI │   (signed)     │  • dual-mode propose               │  │
│   │  snarkjs prover│                │  • approve  / approve_zk           │  │
│   └───────┬────────┘                │  • execute  / execute_confidential │  │
│           │ generates                └─────────────┬─────────────────────┘  │
│           ▼                                         │ (roadmap)              │
│   voteApproval.circom                               ▼                        │
│   real Groth16 proof              ┌───────────────────────────────────┐    │
│   (anonymous signer approval)     │  Nethermind Pool + Groth16 Verifier│    │
│                                   │  (confidential execution layer)    │    │
│                                   └───────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────────┘
```

## Tech stack

| Layer          | Tech                                                 |
| -------------- | ---------------------------------------------------- |
| Smart contract | Rust + Soroban SDK 23                                |
| ZK circuit     | circom 2.2 + circomlib (Poseidon, Merkle membership) |
| Proving        | snarkjs (Groth16, BN254) — runs in the browser       |
| Frontend       | Next.js 14 (App Router) + React 18 + TypeScript      |
| Wallet         | Freighter (`@stellar/freighter-api`)                 |
| SDK            | `@stellar/stellar-sdk` 16 (Protocol 23)              |

---

## Live testnet deployment

| Contract                                               | ID                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| **Vault Factory** (deploys one contract per vault)     | `CBL2WDAFURF5UR2FRKIXLJA4CF2DJ5BXWCFD6S5EIHWCLHOXBS3U753J` |
| **Shield Pool** (our confidential layer)               | `CDFENGB4EOJYROMSSQMI6PB6I7GHKU2QPHO7RPU7GVBHGMIZQU7DBAGA` |
| Token (XLM SAC)                                        | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| Nethermind Private-Payments Pool / Verifier (explored) | `CCQRXA6U…` / `CDRMXX3O…`                                  |

Each vault is its own contract, deployed by the factory — view a vault by its address on stellar.expert.
🔭 [View the Factory on stellar.expert](https://stellar.expert/explorer/testnet/contract/CBL2WDAFURF5UR2FRKIXLJA4CF2DJ5BXWCFD6S5EIHWCLHOXBS3U753J)

---

## Run it locally

### 1. Contract tests

```bash
cd stellar-vault
cargo test            # 7/7 pass
cargo build --target wasm32v1-none --release
```

### 2. ZK circuit + proof (already built; to rebuild)

```bash
cd circuits
circom voteApproval.circom --wasm --r1cs -l node_modules/circomlib/circuits -o build
# trusted setup + a real prove/verify roundtrip:
node test.mjs         # ✓ proof generated, verified, soundness + double-vote checks
```

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

Public inputs: `[vaultId, txHash, signerRoot, nullifier]`. Everything else is private.
Proofs are generated **in the browser** with snarkjs (~0.3s) and the nullifier is submitted on-chain via `approve_zk`, where the `ZKApprovalEvent` emits **only the nullifier** — never the signer.

---

## Demo flow (3 minutes)

1. **Create a vault** — connect Freighter, pick signers + threshold, sign on-chain.
2. **Transparent transaction** — propose 10 XLM → approve → execute. Recipient balance visibly increases. _"Alice, Bob approved. 10 XLM → GXYZ…"_
3. **Private transaction** — toggle to Private, propose → **Approve (ZK)**: a real Groth16 proof is generated in-browser (witness → proof → submit), the nullifier lands on-chain. _"🔒 approved — voter identity hidden."_
4. **Compare** — same vault, same threshold, two privacy levels, side by side.

---

## Roadmap

Because each vault is a programmable smart contract (not native multi-sig), it's the right foundation for Gnosis-Safe-style extensibility — things native multi-sig structurally can't add:

- **Safe-style modules & guards** — spending limits, daily caps, role-based access, time-locks, transaction simulation before signing, batched multi-call transactions, session keys, social recovery.
- **On-chain Groth16 verifier** — deploy a verifier keyed to our circuits' VK + bind the signer Merkle root in the vault (now unblocked by the X-Ray BN254/Poseidon host functions).
- **Relayer / meta-tx** — full approver anonymity (today the tx source still reveals the submitter; the on-chain event already hides it).
- **Confidential execution inside the vault** — wire the shielded pool directly into a private `execute` so amount + recipient are hidden by default.
- DeFi integrations, mobile, production audit.

---

## Repository layout

```
vault-factory/   Soroban factory — deploys one vault contract per vault (+ owner→vaults registry)
vault-instance/  Soroban single-vault contract (own address + native balance, approve / approve_zk / execute)
shield-pool/     Soroban shielded pool for confidential transfers
circuits/        voteApproval.circom (voter privacy) + confidentialTransfer.circom + Groth16 setup + tests
web/             Next.js 14 dApp (Vault Gold UI, Freighter, snarkjs prover)
deployments/     testnet addresses
docs/            architecture, ZK, A-plan roadmap, hackathon plan, submission kit
stellar-vault/   earlier single-contract design (the "B" approach) — kept for the migration story
```

---

_Built for the Stellar Hacks ZK Hackathon. Privacy primitives adapted from Nethermind's `stellar-private-payments` (Apache-2.0)._
