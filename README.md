# 🔐 Stellar Vault — Confidential Multi-Sig Treasury

> **The first multi-signature treasury on Stellar where each transaction can be transparent _or_ private.**
> Approve as a team. Reveal nothing. Built on Soroban with real zero-knowledge proofs.

[![Network](https://img.shields.io/badge/network-Stellar%20Testnet-7FB069)](https://stellar.expert/explorer/testnet/contract/CAUYRN2Q6TPONJLNU6Z6YQC564UNFSEYSYPVWZBLIVHEBYLBOHMLTYM7)
[![Contract](https://img.shields.io/badge/Soroban-Rust%20SDK%2023-C9A86A)](stellar-vault/)
[![ZK](https://img.shields.io/badge/ZK-Groth16%20%C2%B7%20circom-C9A86A)](circuits/)

---

## The problem

On Ethereum, **Gnosis Safe** made multi-sig (m-of-n) treasury management the standard for DAOs and teams. Stellar has **no equivalent**. Worse — every fund movement on a public ledger is fully transparent: who proposed, who approved, how much, and to whom is visible to everyone.

For payroll, OTC deals, grants, or treasury rebalancing, that transparency is a liability.

## The solution

A Soroban multi-sig wallet where **the initiator picks the privacy level per transaction**:

| | **Transparent mode** | **Private (ZK) mode** |
|---|---|---|
| Who proposed | ✅ Visible | ✅ Visible |
| **Who approved** | ✅ Visible (Alice, Bob…) | 🔒 **Hidden** — ZK proof: "a valid signer approved" |
| **Amount** | ✅ Public | 🔒 **Hidden** _(roadmap: confidential execution)_ |
| **Recipient** | ✅ Public | 🔒 **Hidden** _(roadmap: confidential execution)_ |
| Feel | A public bank statement | A frosted-glass vault receipt |

Same vault, same threshold — **you decide what the chain is allowed to see.**

---

## What's built (honest status)

| Layer | Status | Detail |
|---|---|---|
| **Soroban multi-sig vault** | ✅ **Live on testnet** | create vault, signer mgmt, threshold, propose, approve, execute, cancel — 7/7 contract tests pass |
| **Transparent flow** | ✅ **Fully working** | propose → approve → execute moves **real XLM** on testnet, wallet-signed |
| **ZK voter privacy** | ✅ **Real ZK** | own `voteApproval.circom` (Poseidon + Merkle membership + nullifier), real Groth16 proofs generated **in-browser**, `approve_zk` records the nullifier on-chain — identity hidden in the event, double-vote prevented |
| **dApp frontend** | ✅ **Working** | Next.js 14 + Freighter, live on-chain reads, wallet-signed writes, cinematic "Vault Gold" UI |
| **Per-vault balances + naming** | ✅ **Live** | each vault has its own name + segregated balance (`deposit` / `get_vault_balance`); production roadmap = Safe-style factory (one contract per vault) |
| **Confidential transfers (shielded pool)** | ✅ **Real ZK, deployed** | our own `confidentialTransfer.circom` + `shield-pool` contract: deposit → **unlinkable** confidential send; on-chain only commitments + nullifiers, the sender↔recipient link is severed |
| **On-chain Groth16 verify** | 🚧 **Roadmap** | proofs are real & browser-verified today; an on-chain verifier keyed to our circuits is the production hardening step (BN254 host fns are still draft on testnet — CAP-0074) |

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

| Layer | Tech |
|---|---|
| Smart contract | Rust + Soroban SDK 23 |
| ZK circuit | circom 2.2 + circomlib (Poseidon, Merkle membership) |
| Proving | snarkjs (Groth16, BN254) — runs in the browser |
| Frontend | Next.js 14 (App Router) + React 18 + TypeScript |
| Wallet | Freighter (`@stellar/freighter-api`) |
| SDK | `@stellar/stellar-sdk` 16 (Protocol 23) |

---

## Live testnet deployment

| Contract | ID |
|---|---|
| **Vault** | `CAUYRN2Q6TPONJLNU6Z6YQC564UNFSEYSYPVWZBLIVHEBYLBOHMLTYM7` |
| **Shield Pool** (our confidential layer) | `CDFENGB4EOJYROMSSQMI6PB6I7GHKU2QPHO7RPU7GVBHGMIZQU7DBAGA` |
| Token (XLM SAC) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| Nethermind Pool / Verifier (explored) | `CCQRXA6U…` / `CDRMXX3O…` |

🔭 [View the Vault on stellar.expert](https://stellar.expert/explorer/testnet/contract/CAUYRN2Q6TPONJLNU6Z6YQC564UNFSEYSYPVWZBLIVHEBYLBOHMLTYM7)

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
2. **Transparent transaction** — propose 10 XLM → approve → execute. Recipient balance visibly increases. *"Alice, Bob approved. 10 XLM → GXYZ…"*
3. **Private transaction** — toggle to Private, propose → **Approve (ZK)**: a real Groth16 proof is generated in-browser (witness → proof → submit), the nullifier lands on-chain. *"🔒 approved — voter identity hidden."*
4. **Compare** — same vault, same threshold, two privacy levels, side by side.

---

## Roadmap

- **Confidential execution** — wire `execute_confidential` → Nethermind Pool `transact()` to hide amount + recipient (UTXO commitments + encrypted outputs).
- **On-chain Groth16 verifier** — deploy a verifier keyed to `voteApproval`'s VK + store `signerRoot` in the vault to bind membership on-chain.
- **Relayer / meta-tx** — full approver anonymity (today the tx source still reveals the submitter; the event already hides it).
- DeFi integrations, mobile, production audit.

---

## Repository layout

```
stellar-vault/   Soroban multi-sig contract (Rust) + tests
circuits/        voteApproval.circom + Groth16 setup + prove/verify test
web/             Next.js 14 dApp (Vault Gold UI, Freighter, snarkjs prover)
deployments/     testnet addresses
docs/            architecture, ZK, Nethermind integration, hackathon plan
```

---

*Built for the Stellar Hacks ZK Hackathon. Privacy primitives adapted from Nethermind's `stellar-private-payments` (Apache-2.0).*
