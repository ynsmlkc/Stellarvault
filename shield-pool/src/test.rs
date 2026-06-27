#![cfg(test)]

use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Bytes, Env, U256,
};

use crate::{ShieldPool, ShieldPoolClient};

struct Setup<'a> {
    env: Env,
    pool: ShieldPoolClient<'a>,
    token: TokenClient<'a>,
    token_admin: StellarAssetClient<'a>,
    pool_addr: Address,
}

fn setup() -> Setup<'static> {
    let env = Env::default();
    env.mock_all_auths();
    let pool_addr = env.register(ShieldPool, ());
    let pool = ShieldPoolClient::new(&env, &pool_addr);

    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin);
    let token = TokenClient::new(&env, &sac.address());
    let token_admin = StellarAssetClient::new(&env, &sac.address());

    pool.init(&sac.address());
    Setup { env, pool, token, token_admin, pool_addr }
}

#[test]
fn test_deposit_then_withdraw() {
    let s = setup();
    let alice = Address::generate(&s.env);
    let recipient = Address::generate(&s.env);
    s.token_admin.mint(&alice, &1_000_000_000);

    let commitment = U256::from_u32(&s.env, 0xC0FFEE);
    let idx = s.pool.deposit(&alice, &100_000_000, &commitment);
    assert_eq!(idx, 0);
    assert_eq!(s.token.balance(&s.pool_addr), 100_000_000);
    assert_eq!(s.pool.get_commitments().len(), 1);

    let nullifier = U256::from_u32(&s.env, 0xABCD01);
    let proof = Bytes::from_array(&s.env, &[1u8; 8]);
    let root = U256::from_u32(&s.env, 42);

    assert_eq!(s.token.balance(&recipient), 0);
    s.pool.withdraw(&proof, &root, &nullifier, &recipient, &100_000_000);

    assert_eq!(s.token.balance(&recipient), 100_000_000);
    assert_eq!(s.token.balance(&s.pool_addr), 0);
    assert!(s.pool.is_spent(&nullifier));
}

#[test]
#[should_panic]
fn test_double_spend_panics() {
    let s = setup();
    let alice = Address::generate(&s.env);
    let recipient = Address::generate(&s.env);
    s.token_admin.mint(&alice, &1_000_000_000);
    s.pool.deposit(&alice, &200_000_000, &U256::from_u32(&s.env, 1));

    let nullifier = U256::from_u32(&s.env, 7);
    let proof = Bytes::from_array(&s.env, &[2u8; 8]);
    let root = U256::from_u32(&s.env, 1);
    s.pool.withdraw(&proof, &root, &nullifier, &recipient, &50_000_000);
    // same nullifier again -> panic
    s.pool.withdraw(&proof, &root, &nullifier, &recipient, &50_000_000);
}

#[test]
#[should_panic]
fn test_empty_proof_panics() {
    let s = setup();
    let recipient = Address::generate(&s.env);
    s.pool.withdraw(&Bytes::new(&s.env), &U256::from_u32(&s.env, 1), &U256::from_u32(&s.env, 9), &recipient, &1);
}
