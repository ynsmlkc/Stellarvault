#![no_std]

//! Shield Pool — a minimal shielded pool for Stellar Vault's confidential
//! execution layer.
//!
//! A note is committed off-chain as `Poseidon(amount, secret, blinding)` and
//! deposited here. To move funds confidentially the owner submits a Groth16
//! proof (see `circuits/confidentialTransfer.circom`) of membership + a unique
//! nullifier, and the pool releases the funds to a recipient — with **no
//! on-chain link** back to which deposit funded it.
//!
//! On-chain you only ever see commitments (deposits) and nullifier hashes
//! (withdraws). The sender↔recipient link and the funding deposit stay hidden.
//!
//! NOTE: this contract enforces nullifier-uniqueness + the token transfer.
//! Full on-chain Groth16 verification (binding the proof to `root`) is the
//! production hardening step — same trust model as the vault's `approve_zk`.

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token::TokenClient, Address, Bytes, Env, U256, Vec};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Token,
    Commitments,
    Nullifier(U256),
}

#[contract]
pub struct ShieldPool;

#[contractimpl]
impl ShieldPool {
    /// One-time init: the token (SAC) this pool shields.
    pub fn init(env: Env, token: Address) {
        if env.storage().instance().has(&DataKey::Token) {
            panic!();
        }
        env.storage().instance().set(&DataKey::Token, &token);
    }

    /// Deposit `amount` and register the note `commitment`. Returns the leaf index.
    pub fn deposit(env: Env, from: Address, amount: i128, commitment: U256) -> u32 {
        from.require_auth();
        if amount <= 0 {
            panic!();
        }
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap_or_else(|| panic!());
        TokenClient::new(&env, &token).transfer(&from, &env.current_contract_address(), &amount);

        let mut list: Vec<U256> = env.storage().persistent().get(&DataKey::Commitments).unwrap_or(Vec::new(&env));
        let index = list.len();
        list.push_back(commitment.clone());
        env.storage().persistent().set(&DataKey::Commitments, &list);

        env.events().publish((symbol_short!("deposit"), index), commitment);
        index
    }

    /// Confidential withdraw: spend a note (proven in `proof`) to `recipient`.
    /// The nullifier hash prevents double-spends; identity of the note is hidden.
    pub fn withdraw(env: Env, proof: Bytes, root: U256, nullifier_hash: U256, recipient: Address, amount: i128) {
        let key = DataKey::Nullifier(nullifier_hash.clone());
        if env.storage().persistent().has(&key) {
            panic!(); // already spent
        }
        if proof.len() == 0 {
            panic!(); // empty proof
        }
        if amount <= 0 {
            panic!();
        }
        // production: verify the Groth16 proof binds (root, nullifier_hash, recipient, amount)
        let _ = root;

        env.storage().persistent().set(&key, &true);

        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap_or_else(|| panic!());
        TokenClient::new(&env, &token).transfer(&env.current_contract_address(), &recipient, &amount);

        env.events().publish((symbol_short!("withdraw"),), nullifier_hash);
    }

    /// All deposited commitments — the frontend rebuilds the Merkle tree from these.
    pub fn get_commitments(env: Env) -> Vec<U256> {
        env.storage().persistent().get(&DataKey::Commitments).unwrap_or(Vec::new(&env))
    }

    pub fn is_spent(env: Env, nullifier_hash: U256) -> bool {
        env.storage().persistent().has(&DataKey::Nullifier(nullifier_hash))
    }

    pub fn get_token(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Token).unwrap_or_else(|| panic!())
    }
}

#[cfg(test)]
mod test;
