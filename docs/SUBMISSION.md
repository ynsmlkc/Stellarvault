# Submission Kit — Stellar Vault

Ready-to-paste copy for DoraHacks + a shot-by-shot demo video script.

---

## One-liner
The first confidential multi-sig treasury on Stellar — approve as a team, reveal nothing.

## Tagline options
- "Gnosis Safe for Stellar — but the votes can be private."
- "Multi-sig where you choose, per transaction, what the chain is allowed to see."

## Short description (≈100 words)
Stellar has no Gnosis Safe, and every fund movement on a public ledger is fully transparent — who proposed, who approved, how much, to whom. Stellar Vault is a Soroban multi-signature treasury where the initiator picks the privacy level **per transaction**. Transparent mode works like a public bank statement. Private mode uses a real zero-knowledge proof (Groth16, generated in the browser) so that "a valid signer approved" is provable while the signer's identity stays hidden, with a nullifier preventing double-votes. A polished Next.js + Freighter dApp drives it all against a live testnet contract.

## What we built
- Soroban multi-sig vault (Rust, SDK 23) — live on testnet, 7/7 tests, real wallet-signed transparent transfers.
- `voteApproval.circom` — our own ZK circuit (Poseidon + Merkle membership + nullifier); real Groth16 proofs in-browser; `approve_zk` records the nullifier on-chain, hiding voter identity in the event.
- Next.js 14 + Freighter dApp with a cinematic "Vault Gold" UI; live on-chain reads + signed writes.
- Confidential execution (amount + recipient hiding via Nethermind Pool) is the documented next layer — Verifier/Pool/ASPs already deployed.

## Tech
Rust + Soroban SDK 23 · circom 2.2 + circomlib · snarkjs Groth16 (BN254) · Next.js 14 + React + TypeScript · Freighter · @stellar/stellar-sdk 16 (Protocol 23).

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
- **Real ZK, not theater:** circuit compiles to 1,491 constraints; proofs verify; tampered inputs fail; double-vote nullifier is stable. `cd circuits && node test.mjs`.
- **Real on-chain:** transparent execute moves actual XLM (verifiable on stellar.expert).
- **Honest scope:** voter privacy ships today; confidential execution is the next layer with infra already deployed.
- **Production path is mapped:** on-chain verifier + signerRoot binding + relayer for full anonymity.
