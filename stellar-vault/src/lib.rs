#![no_std]

//! ⚠️ ARCHIVED — earlier single-contract design (the "B" approach).
//!
//! This is the original design where one contract held every vault behind a
//! shared balance. It is **superseded** by the `vault-factory` + `vault-instance`
//! pair (one deployed contract per vault, isolated balances, on-chain registry).
//! It is kept only for the migration story; the live dApp does not use it.
//! See the repo README, section "How it evolved — feedback & iteration".

mod types;
mod vault;

#[cfg(test)]
mod test;

pub use vault::VaultContract;
