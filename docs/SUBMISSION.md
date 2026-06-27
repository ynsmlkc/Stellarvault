# Submission Kit — Stellar Vault

Ready-to-paste copy for DoraHacks + a shot-by-shot demo video script.

---

## One-liner
The first confidential multi-sig treasury on Stellar — approve as a team, reveal nothing.

## Tagline options
- "Gnosis Safe for Stellar — but the votes can be private."
- "Multi-sig where you choose, per transaction, what the chain is allowed to see."

## Short description (≈100 words)
Stellar already has multi-sig — natively and via products like LOBSTR Vault and Solar — but all of it is fully **transparent** and **native** (not programmable). Stellar Vault is the first **confidential, programmable** multi-sig treasury: a Soroban smart contract (one per vault, Safe-style factory) where each transaction is transparent or private. In private mode a real in-browser Groth16 proof hides **who approved** — only a nullifier reaches the chain; a separate shielded pool hides the **amount + recipient** of a transfer. Privacy and programmability are exactly what native multi-sig structurally can't do. A polished Next.js + Freighter dApp drives it all on live testnet.

## What we built
- **Safe-style factory + per-vault contracts** (Rust, Soroban SDK 23) — each vault is its own deployed contract (own address, own native balance, on-chain `owner→vaults` registry). Live on testnet, 7/7 tests, real wallet-signed transfers.
- **Voter privacy** — our own `voteApproval.circom` (Poseidon + Merkle membership + nullifier); real Groth16 proofs in-browser; `approve_zk` records only the nullifier on-chain, hiding *who* approved.
- **Confidential transfers** — our own `confidentialTransfer.circom` + a deployed `shield-pool` contract: deposit → unlinkable confidential send; on-chain only commitments + nullifiers.
- Next.js 14 + Freighter dApp with a cinematic "Vault Gold" UI; live on-chain reads + signed writes.

## Tech
Rust + Soroban SDK 23 · circom 2.2 + circomlib · snarkjs Groth16 (BN254) · Next.js 14 + React + TypeScript · Freighter · @stellar/stellar-sdk 16 (Protocol 23).

## Differentiation (vs existing Stellar multi-sig)
Stellar's multi-sig today — native account-signers, **LOBSTR Vault**, **Solar**, **StellarGuard** — is all built on the **native** primitive: count signatures vs a threshold, fully transparent, no custom logic. Stellar's official **Private Payments** (Nethermind) brings confidential *payments*, but not a multi-sig treasury and not anonymous *approvals*. Stellar Vault is the only one that is **both** a Soroban smart-contract treasury **and** private:
- **Anonymous approvals** (voter privacy via ZK) — hiding *who* approved is something no existing Stellar multi-sig does, and native multi-sig structurally cannot.
- **Programmable** — a smart-contract vault is the foundation for Safe-style modules (spending limits, time-locks, roles, guards, batched tx) that native multi-sig can never add.
- A real **product** (dApp + UX), not a framework/library.

> Existing products prove the demand. We add the two things native multi-sig can't: **privacy + programmability.** LOBSTR Vault is Stellar's signing app; this is Stellar's **confidential, programmable** Safe.

## Roadmap
Safe-style modules & guards (spending limits, daily caps, roles, time-locks, simulate-before-sign, batched multi-call, session keys, social recovery) · on-chain Groth16 verifier (now unblocked by the X-Ray BN254/Poseidon upgrade) · relayer for full approver anonymity · confidential execution wired into the vault · DeFi, mobile, audit.

## Links
- Repo: https://github.com/ynsmlkc/Stellarvault
- Live Vault contract: https://stellar.expert/explorer/testnet/contract/CAUYRN2Q6TPONJLNU6Z6YQC564UNFSEYSYPVWZBLIVHEBYLBOHMLTYM7
- Demo video: <add URL>

---

## Demo video script (~3 min)

**[0:00–0:20] Hook — landing page**
> "On Ethereum, Gnosis Safe runs DAO treasuries. Stellar has nothing like it — and every transfer is fully public: who approved, how much, to whom. We built Stellar Vault: the first multi-sig where each transaction can be transparent… or private."

Show the landing hero, scroll to the "Same security. Different privacy." comparison cards.

**[0:20–0:45] Create a vault**
> "Connect Freighter. Create a vault — pick your signers and threshold. This is a real Soroban contract on testnet."

Connect wallet → Create Vault → sign → land on the live vault (show the LIVE · TESTNET badge, real balance).

**[0:45–1:30] Transparent transaction**
> "Classic mode first — a public transfer. Propose, approve, execute."

Propose (transparent) → Approve → Execute → show recipient balance increase + explorer link.
> "Everything is on-chain and auditable. Alice approved, 10 XLM went to this address. Just like Gnosis Safe."

**[1:30–2:30] Private transaction — the magic**
> "Now the same vault, same threshold — but private."

Toggle ModeToggle → Private. Propose. Click **Approve (ZK)**.
> "Watch the overlay — a zero-knowledge proof is being generated, in the browser, right now. Poseidon commitments, a Merkle membership proof, a nullifier."

Show the proof overlay stages, then the toast with the real nullifier.
> "On-chain, only the nullifier is recorded. The event proves a valid signer approved — but which signer? Hidden. Double-voting? Impossible. This is a real Groth16 proof, not a mock."

**[2:30–3:00] Close**
> "Same vault, two privacy levels, your choice per transaction. Next: confidential execution hides the amount and recipient too, via a UTXO pool. Stellar's first confidential multi-sig — built on Soroban, with real zero-knowledge."

Show the side-by-side transparent vs private cards one more time.

---

## Talking points for judges
- **We know the landscape:** Stellar has native multi-sig + LOBSTR Vault/Solar/StellarGuard (all transparent, native) and official Private Payments (confidential payments, not multi-sig). We're the only **confidential + programmable multi-sig treasury** — and *anonymous approvals* are done by no one else.
- **Real ZK, not theater:** two real circuits; proofs verify; tampered inputs fail; double-vote nullifier is stable. `cd circuits && node test.mjs` (and `test-ct.mjs`).
- **Real on-chain, real architecture:** Safe-style factory deploys one contract per vault (own address + native balance); execute moves actual XLM — verifiable on stellar.expert.
- **Why it's defensible:** privacy + programmability are exactly what native multi-sig structurally cannot add; a smart-contract vault is the only foundation that can.
- **Production path is mapped:** on-chain Groth16 verifier (X-Ray unblocked it) + relayer for full anonymity + Safe-style modules.
