#![cfg(test)]

use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    vec, Address, Bytes, Env, String, U256, Vec,
};

use crate::{VaultInstance, VaultInstanceClient, ZKApproval};

struct Setup<'a> {
    env: Env,
    vault: VaultInstanceClient<'a>,
    vault_addr: Address,
    token: TokenClient<'a>,
    token_admin: StellarAssetClient<'a>,
    owner: Address,
    signers: Vec<Address>,
}

fn setup(threshold: u32) -> Setup<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin);
    let token_addr = sac.address();

    let owner = Address::generate(&env);
    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let signers = vec![&env, owner.clone(), s1, s2];

    let vault_addr = env.register(
        VaultInstance,
        (owner.clone(), String::from_str(&env, "Team Vault"), token_addr.clone(), signers.clone(), threshold),
    );
    let vault = VaultInstanceClient::new(&env, &vault_addr);

    Setup {
        env: env.clone(),
        vault,
        vault_addr,
        token: TokenClient::new(&env, &token_addr),
        token_admin: StellarAssetClient::new(&env, &token_addr),
        owner,
        signers,
    }
}

#[test]
fn test_create_and_query() {
    let s = setup(2);
    let c = s.vault.get_config();
    assert_eq!(c.name, String::from_str(&s.env, "Team Vault"));
    assert_eq!(c.threshold, 2);
    assert_eq!(c.signer_count, 3);
    assert!(s.vault.is_signer(&s.signers.get(1).unwrap()));
    assert!(!s.vault.is_signer(&Address::generate(&s.env)));
    assert_eq!(s.vault.get_balance(), 0);
}

#[test]
fn test_transparent_execute_moves_own_funds() {
    let s = setup(2);
    // deposit = plain transfer to the vault's address (Safe-style)
    s.token_admin.mint(&s.vault_addr, &5_000_000);
    assert_eq!(s.vault.get_balance(), 5_000_000);

    let recipient = Address::generate(&s.env);
    let tx = s.vault.propose(&s.signers.get(0).unwrap(), &recipient, &1_000_000, &false);
    s.vault.approve(&tx, &s.signers.get(0).unwrap());
    s.vault.approve(&tx, &s.signers.get(1).unwrap());
    s.vault.execute(&tx, &s.signers.get(0).unwrap());

    assert_eq!(s.token.balance(&recipient), 1_000_000);
    assert_eq!(s.vault.get_balance(), 4_000_000);
    assert!(s.vault.get_proposal(&tx).executed);
}

#[test]
fn test_private_execute_moves_funds_with_zk_approval() {
    let s = setup(1);
    s.token_admin.mint(&s.vault_addr, &3_000_000);

    let recipient = Address::generate(&s.env);
    let tx = s.vault.propose(&s.signers.get(0).unwrap(), &recipient, &1_000_000, &true);

    let zk = ZKApproval {
        proof: Bytes::from_array(&s.env, &[1u8; 8]),
        public_inputs: Vec::new(&s.env),
        nullifier: U256::from_u32(&s.env, 0xAB),
    };
    s.vault.approve_zk(&tx, &s.signers.get(0).unwrap(), &zk);
    s.vault.execute(&tx, &s.signers.get(0).unwrap());

    // funds move (amount/recipient are public); only the approver identity was hidden by ZK
    assert!(s.vault.get_proposal(&tx).executed);
    assert_eq!(s.token.balance(&recipient), 1_000_000);
    assert_eq!(s.vault.get_balance(), 2_000_000);
}

#[test]
#[should_panic]
fn test_double_approve_panics() {
    let s = setup(2);
    let tx = s.vault.propose(&s.signers.get(0).unwrap(), &Address::generate(&s.env), &10, &false);
    let signer = s.signers.get(0).unwrap();
    s.vault.approve(&tx, &signer);
    s.vault.approve(&tx, &signer);
}

#[test]
#[should_panic]
fn test_non_signer_approve_panics() {
    let s = setup(2);
    let tx = s.vault.propose(&s.signers.get(0).unwrap(), &Address::generate(&s.env), &10, &false);
    s.vault.approve(&tx, &Address::generate(&s.env));
}

#[test]
#[should_panic]
fn test_execute_below_threshold_panics() {
    let s = setup(2);
    let tx = s.vault.propose(&s.signers.get(0).unwrap(), &Address::generate(&s.env), &10, &false);
    s.vault.approve(&tx, &s.signers.get(0).unwrap());
    s.vault.execute(&tx, &s.signers.get(0).unwrap());
}

#[test]
#[should_panic]
fn test_zk_double_vote_panics() {
    let s = setup(2);
    let tx = s.vault.propose(&s.signers.get(0).unwrap(), &Address::generate(&s.env), &10, &true);
    let mk = |n: u32| ZKApproval {
        proof: Bytes::from_array(&s.env, &[n as u8; 8]),
        public_inputs: Vec::new(&s.env),
        nullifier: U256::from_u32(&s.env, 0x99),
    };
    s.vault.approve_zk(&tx, &s.signers.get(0).unwrap(), &mk(1));
    s.vault.approve_zk(&tx, &s.signers.get(1).unwrap(), &mk(2)); // same nullifier -> panic
}
