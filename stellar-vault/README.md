# stellar-vault — ⚠️ archived (earlier design)

This crate is the **original single-contract design** (the "B" approach): one
contract that held every vault behind a single shared balance.

It has been **superseded** by the current architecture:

| Concern           | This crate (archived)        | Current design                              |
| ----------------- | ---------------------------- | ------------------------------------------- |
| Vaults            | all in one contract          | one deployed contract **per vault**         |
| Balances          | one shared balance           | isolated native balance per vault           |
| Discovery         | —                            | on-chain `owner→vaults` registry            |
| Contracts         | `stellar-vault/`             | `vault-factory/` + `vault-instance/`        |

**The live dApp uses `vault-factory` + `vault-instance`, not this crate.**

It is kept in the repository only to document the migration — the shared-balance
bug found during testing is exactly what drove the re-architecture into a
Gnosis-Safe-style factory. See the root README, section
_"How it evolved — feedback & iteration"_.

Its tests still pass (`cargo test --manifest-path stellar-vault/Cargo.toml`) so
the migration story stays reproducible.
