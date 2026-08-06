#![cfg(test)]

//! Factory unit tests.
//!
//! These cover the factory's own state machine — the one-time `init` guard and
//! the default reads (`vault_count`, `get_vaults`) — without deploying a real
//! vault-instance. The full `create_vault` deploy path needs the instance WASM
//! and is exercised end-to-end on live testnet + through the dApp.

use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

use crate::{VaultFactory, VaultFactoryClient};

fn setup() -> (Env, VaultFactoryClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let wasm_hash = BytesN::from_array(&env, &[0u8; 32]);

    let factory_addr = env.register(VaultFactory, ());
    let factory = VaultFactoryClient::new(&env, &factory_addr);
    factory.init(&admin, &wasm_hash, &token);

    (env, factory)
}

#[test]
fn test_init_sets_defaults() {
    let (env, factory) = setup();
    // fresh factory: no vaults created yet
    assert_eq!(factory.vault_count(), 0);
    // an owner with no vaults gets an empty list, not a panic
    let unknown = Address::generate(&env);
    assert_eq!(factory.get_vaults(&unknown).len(), 0);
}

#[test]
#[should_panic]
fn test_double_init_panics() {
    let (env, factory) = setup();
    // init is one-time — a second call must panic (the `has(&ADMIN)` guard)
    let admin2 = Address::generate(&env);
    let token2 = Address::generate(&env);
    let wasm2 = BytesN::from_array(&env, &[1u8; 32]);
    factory.init(&admin2, &wasm2, &token2);
}

#[test]
fn test_forget_and_remember_a_vault() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let id = env.register(VaultFactory, ());
    let c = VaultFactoryClient::new(&env, &id);
    c.init(&admin, &BytesN::from_array(&env, &[0u8; 32]), &Address::generate(&env));

    let owner = Address::generate(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    c.remember_vault(&owner, &a);
    c.remember_vault(&owner, &b);
    c.remember_vault(&owner, &b); // idempotent
    assert_eq!(c.get_vaults(&owner).len(), 2);

    // forgetting removes it from the listing only — nothing about the vault
    // itself changes, which is the whole point of not calling it "delete"
    c.forget_vault(&owner, &a);
    let left = c.get_vaults(&owner);
    assert_eq!(left.len(), 1);
    assert_eq!(left.get(0).unwrap(), b);

    c.remember_vault(&owner, &a);
    assert_eq!(c.get_vaults(&owner).len(), 2, "forgetting is reversible");
}

#[test]
fn test_forgetting_an_unknown_vault_is_harmless() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let id = env.register(VaultFactory, ());
    let c = VaultFactoryClient::new(&env, &id);
    c.init(&admin, &BytesN::from_array(&env, &[0u8; 32]), &Address::generate(&env));

    let owner = Address::generate(&env);
    c.forget_vault(&owner, &Address::generate(&env));
    assert_eq!(c.get_vaults(&owner).len(), 0);
}
