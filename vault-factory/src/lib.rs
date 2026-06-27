#![no_std]

//! Vault Factory — deploys a fresh `vault-instance` per vault (Safe-style).
//!
//! `create_vault` deploys a new contract instance (its own address, its own
//! native balance) and returns its address. Also keeps an on-chain registry of
//! each owner's vaults so the dashboard can list them from chain.

use soroban_sdk::{
    contract, contractevent, contractimpl, symbol_short, Address, BytesN, Env, IntoVal, String,
    Symbol, Val, Vec,
};

const ADMIN: Symbol = symbol_short!("admin");
const WASM: Symbol = symbol_short!("wasm");
const TOKEN: Symbol = symbol_short!("token");
const COUNTER: Symbol = symbol_short!("counter");

#[contractevent]
#[derive(Clone)]
pub struct VaultCreated {
    #[topic] pub owner: Address,
    pub vault: Address,
}

#[contract]
pub struct VaultFactory;

#[contractimpl]
impl VaultFactory {
    /// One-time init: the uploaded vault-instance WASM hash + the token vaults shield.
    pub fn init(env: Env, admin: Address, instance_wasm_hash: BytesN<32>, token: Address) {
        if env.storage().instance().has(&ADMIN) {
            panic!();
        }
        let s = env.storage().instance();
        s.set(&ADMIN, &admin);
        s.set(&WASM, &instance_wasm_hash);
        s.set(&TOKEN, &token);
        s.set(&COUNTER, &0u64);
    }

    /// Deploy a new vault. `owner` authorizes; returns the new vault's address.
    pub fn create_vault(env: Env, owner: Address, name: String, signers: Vec<Address>, threshold: u32) -> Address {
        owner.require_auth();

        let token: Address = env.storage().instance().get(&TOKEN).unwrap();
        let wasm_hash: BytesN<32> = env.storage().instance().get(&WASM).unwrap();
        let counter: u64 = env.storage().instance().get(&COUNTER).unwrap_or(0);

        // unique salt from the counter
        let mut salt_bytes = [0u8; 32];
        let cb = counter.to_be_bytes();
        let mut i = 0;
        while i < 8 {
            salt_bytes[24 + i] = cb[i];
            i += 1;
        }
        let salt = BytesN::from_array(&env, &salt_bytes);

        let args: Vec<Val> = (owner.clone(), name, token, signers.clone(), threshold).into_val(&env);
        let vault = env.deployer().with_current_contract(salt).deploy_v2(wasm_hash, args);

        env.storage().instance().set(&COUNTER, &(counter + 1));

        // registry: register the vault under EVERY signer so any of them can
        // find and co-sign it (the owner is one of the signers).
        for s in signers.iter() {
            let mut list: Vec<Address> = env.storage().persistent().get(&s).unwrap_or(Vec::new(&env));
            list.push_back(vault.clone());
            env.storage().persistent().set(&s, &list);
        }

        VaultCreated { owner, vault: vault.clone() }.publish(&env);
        vault
    }

    /// Admin: point the factory at a new vault-instance WASM (future upgrades).
    pub fn set_wasm(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&ADMIN).unwrap();
        admin.require_auth();
        env.storage().instance().set(&WASM, &new_wasm_hash);
    }

    /// All vaults created by `owner` (for the dashboard list, survives browser clear).
    pub fn get_vaults(env: Env, owner: Address) -> Vec<Address> {
        env.storage().persistent().get(&owner).unwrap_or(Vec::new(&env))
    }

    pub fn vault_count(env: Env) -> u64 {
        env.storage().instance().get(&COUNTER).unwrap_or(0)
    }
}
