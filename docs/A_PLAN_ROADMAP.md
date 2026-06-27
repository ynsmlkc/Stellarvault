# A-Plan Roadmap — Safe-style Factory (one contract per vault)

> Goal: make each vault its OWN Soroban contract (own address, own native balance),
> deployed by a factory — exactly like Gnosis Safe. Per-vault balance becomes free,
> and depositing = a plain transfer to the vault's address.
>
> Safety net: the working **B version is committed (`54745b1`) and pushed**. Every
> phase below has a checkpoint; if any phase fails or gets too costly, we
> `git reset --hard 54745b1` (or pull) and submit B. **Zero risk to the demo.**

---

## ⚡ Recommended order: run the A2.0 spike FIRST
The whole A approach hinges on one unknown — does Soroban's cross-contract
deploy-with-constructor work the way we need? **Do the A2.0 deployer-API spike
before A1.** If it works (15 min), build A1→A5 with confidence. If it doesn't,
we've lost 15 minutes instead of building A1 against a dead end. Everything
else is well-understood (it's the B logic, re-sliced per instance).

---

## Phase A1 — `vault-instance` contract (single vault) 🔵 contract
A new crate: one vault per deployed instance, no `vault_id`.
- `__constructor(owner, name, token, signers, threshold)`
- Holds its own funds natively → balance = `token.balance(self)`; `execute` transfers from `self` (no accounting needed)
- `propose / approve / approve_zk / execute / cancel`
- `add_signer / remove_signer / set_threshold` (owner)
- `get_config / get_proposal / is_signer / get_balance`
- **`execute` behavior (avoid the old panic):**
  - transparent → `token.transfer(self, target, amount)` from the instance's own balance (insufficient → SAC transfer panics, which is fine/expected).
  - private → just mark `executed = true`, **no transfer, NO pool dependency** (voter privacy only; confidential _transfers_ are the separate shield pool). This removes the `get_pool_address` panic we hit in B — the instance has no pool concept at all.
- **✅ Checkpoint:** `cargo test` green (deploy an instance directly, run propose→approve→execute, balance isolated; private execute marks executed without panicking).

## Phase A2 — `vault-factory` contract 🔵 contract · ⚠️ HIGHEST risk (deployer API + auth)

### A2.0 — deployer-API spike FIRST (de-risk before building the factory)
Tiny test: a minimal factory that deploys a trivial contract via
`env.deployer().with_current_contract(salt).deploy_v2(wasm_hash, args)` on testnet.
Confirm the exact SDK-23 API, return type, and that constructor args reach the instance.
**Only build the real factory once this works.**

### A2.1 — the factory
- `init(admin, instance_wasm_hash, token)` — stores the uploaded `vault-instance` WASM hash + token.
- `create_vault(owner, name, signers, threshold) -> Address`:
  - **`owner.require_auth()` lives HERE (in the factory)** — NOT in the instance constructor.
  - deploys a new `vault-instance` with a **unique salt** (incrementing counter, or `hash(owner,nonce)`) so each gets a distinct address.
  - passes `(owner, name, token, signers, threshold)` as constructor args.
  - returns the new address; emits `VaultCreated(owner, address)`.
- **Instance `__constructor` is auth-free** (only callable once at deploy, by the factory) — this sidesteps cross-contract constructor-auth pitfalls.
- **Optional (nice-to-have):** factory keeps an on-chain `owner -> Vec<Address>` registry so the dashboard can list a user's vaults from chain (survives browser-clear) instead of localStorage only.
- **✅ Checkpoint:** node test — `factory.create_vault(...)` returns an address; that address answers `get_config` with the right name/signers/threshold; salt collisions don't happen on a 2nd create.

## Phase A3 — deploy + on-chain e2e 🟢 deploy
- Upload `vault-instance` WASM → get hash; deploy factory (hash + token); init.
- Node e2e on testnet: create via factory → fund the instance (plain transfer to its address) → propose → approve → execute → confirm funds move and balances are **isolated per instance**.
- **✅ Checkpoint:** two instances, independent balances, real transfer works.

## Phase A4 — frontend refactor 🟠 BIGGEST effort/risk
`vaultId` (number) → `vaultAddress` (string) throughout.
- **Mechanical core:** `contract.ts`'s `simulate()` and `invoke()` helpers are currently hardcoded to `CONFIG.vaultId`. Parameterize them by **contract address** — that single change ripples through every read/write. Do this first.
- **Env layout:** add `NEXT_PUBLIC_FACTORY_ID` (the factory, for `create_vault`) + `NEXT_PUBLIC_DEMO_VAULT` (a seeded instance address). Token id stays. The old `NEXT_PUBLIC_VAULT_CONTRACT_ID` is retired (or repurposed as the factory). Each user vault address lives in localStorage (or the on-chain registry).
- `contract.ts`: `createVault` calls the **factory** → returns the new instance address (from `returnValue`); `getVault(addr)`, `getProposals(addr)`, `propose/approve/approve_zk/execute(addr,...)`, `getBalance(addr) = token.balance(addr)`, `deposit = token.transfer(from, addr, amount)`.
- `page.tsx`: `vaultAddress` state; localStorage stores addresses; dashboard lists vaults by address; create flow.
- **ZK approve adaptation (don't miss):** `voteApproval.circom` uses a numeric `vaultId` as a public input + inside the commitment/nullifier. Instances have no numeric id → derive a field element from the instance **address** (e.g. `Poseidon(addressBytes)`) and feed that as the circuit's `vaultId`. The contract's `approve_zk` only stores the U256 nullifier, so this is purely a prover-side change in `lib/prover.ts` + `doApproveZk`.
- **Demo vault:** there's no "vault #0" by id anymore. Seed ONE demo instance via the factory, put its **address** in `.env` (`NEXT_PUBLIC_DEMO_VAULT`), and the landing/dashboard demo card reads that.
- Shield pool screen is a separate contract → **unaffected** by this refactor.
- **✅ Checkpoint:** browser e2e — create named vault → its own balance → deposit (plain transfer) → propose → approve → approve_zk → execute.

## Phase A5 — finalize OR revert 🏁 decision gate
- **If all green:** update README/addresses (factory + instance model), commit → A becomes main.
- **If A4 too thorny:** keep A1–A3 as "factory architecture, proven at contract level," revert frontend to B (`git checkout 54745b1 -- web`), document A as the production design. Still a win.
- **Revert gotcha:** `.env.local` is gitignored, so `git checkout` won't restore it. If we revert the frontend, also reset `NEXT_PUBLIC_VAULT_CONTRACT_ID` back to the **B vault** `CAUYRN2Q…` (and remove any factory/instance env vars) so B points at the right contract.

---

## Decision gates / known risks
1. **A2 — Soroban deployer API** (`deploy_v2` / `with_address` + WASM hash upload). First real unknown; verify with a tiny test before building the full factory.
2. **A4 — frontend churn.** `page.tsx` is large; id→address touches many spots. Biggest time sink and bug surface.
3. Each checkpoint is a safe stop. We never leave the repo in a broken state on `main` (work in new crates; frontend swapped only after A1–A3 pass).

## Estimate
~2–3h focused. A1 ~45m · A2 ~45m (incl. API spike — **may overrun if the deployer API fights back**) · A3 ~20m · A4 ~60–90m · A5 ~15m.

## Minor notes (not blockers)
- **Cost:** deploy-per-vault costs more than a storage record (instance creation + WASM rent). Negligible on testnet; worth a sentence in the README's trade-offs.
- The `voteApproval` / `confidentialTransfer` circuits + the `shield-pool` contract are **untouched** by A — only the vault-instance/factory + the frontend's vault layer change.
- Keep `stellar-vault` (the B crate) in the repo even after A wins — it documents the B approach and the migration story.
