#![cfg(test)]

use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    vec, Address, Bytes, Env, U256, Vec,
};

use crate::types::ZKApproval;
use crate::vault::{VaultContract, VaultContractClient};

/// Test ortamı: kayıtlı vault contract + 3 signer (threshold 2).
struct Setup<'a> {
    env: Env,
    client: VaultContractClient<'a>,
    owner: Address,
    signers: Vec<Address>,
    vault_id: u64,
}

fn setup() -> Setup<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(VaultContract, ());
    let client = VaultContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let signers = vec![&env, owner.clone(), s1, s2];

    let vault_id = client.create_vault(&owner, &signers, &2);

    Setup { env, client, owner, signers, vault_id }
}

#[test]
fn test_create_vault_and_query() {
    let s = setup();
    let config = s.client.get_vault(&s.vault_id);

    assert_eq!(config.threshold, 2);
    assert_eq!(config.signer_count, 3);
    assert_eq!(config.owner, s.owner);

    // Kayıtlı signer'lar tanınıyor, yabancı adres tanınmıyor.
    assert!(s.client.is_signer(&s.vault_id, &s.signers.get(1).unwrap()));
    let stranger = Address::generate(&s.env);
    assert!(!s.client.is_signer(&s.vault_id, &stranger));
}

#[test]
fn test_propose_and_approve_counts() {
    let s = setup();
    let target = Address::generate(&s.env);

    let tx_id = s.client.propose_transaction(
        &s.vault_id,
        &s.signers.get(0).unwrap(),
        &target,
        &1_000_000,
        &false, // transparent
    );

    s.client.approve(&s.vault_id, &tx_id, &s.signers.get(0).unwrap());
    s.client.approve(&s.vault_id, &tx_id, &s.signers.get(1).unwrap());

    let proposal = s.client.get_proposal_fn(&s.vault_id, &tx_id);
    assert_eq!(proposal.approval_count, 2);
    assert!(!proposal.executed);
    assert!(!proposal.private_mode);
}

#[test]
#[should_panic]
fn test_double_approve_panics() {
    let s = setup();
    let target = Address::generate(&s.env);
    let tx_id = s.client.propose_transaction(
        &s.vault_id, &s.signers.get(0).unwrap(), &target, &10, &false,
    );

    let signer = s.signers.get(0).unwrap();
    s.client.approve(&s.vault_id, &tx_id, &signer);
    // Aynı signer ikinci kez onaylayamaz.
    s.client.approve(&s.vault_id, &tx_id, &signer);
}

#[test]
#[should_panic]
fn test_non_signer_approve_panics() {
    let s = setup();
    let target = Address::generate(&s.env);
    let tx_id = s.client.propose_transaction(
        &s.vault_id, &s.signers.get(0).unwrap(), &target, &10, &false,
    );

    let stranger = Address::generate(&s.env);
    s.client.approve(&s.vault_id, &tx_id, &stranger);
}

#[test]
fn test_transparent_execute_transfers_tokens() {
    let s = setup();

    // SAC token kur, vault'a fon yükle.
    let admin = Address::generate(&s.env);
    let sac = s.env.register_stellar_asset_contract_v2(admin.clone());
    let token_addr = sac.address();
    let token = TokenClient::new(&s.env, &token_addr);
    let token_admin = StellarAssetClient::new(&s.env, &token_addr);

    let vault_addr = s.client.address.clone();
    token_admin.mint(&vault_addr, &5_000_000);

    // Transparent transferler için token adresini ayarla (pool'dan ayrı).
    s.client.set_token(&s.owner, &token_addr);

    let recipient = Address::generate(&s.env);
    let amount: i128 = 1_000_000;

    let tx_id = s.client.propose_transaction(
        &s.vault_id, &s.signers.get(0).unwrap(), &recipient, &amount, &false,
    );
    s.client.approve(&s.vault_id, &tx_id, &s.signers.get(0).unwrap());
    s.client.approve(&s.vault_id, &tx_id, &s.signers.get(1).unwrap());

    assert_eq!(token.balance(&recipient), 0);
    s.client.execute(&s.vault_id, &tx_id, &s.signers.get(0).unwrap());

    assert_eq!(token.balance(&recipient), amount);
    assert_eq!(token.balance(&vault_addr), 4_000_000);

    let proposal = s.client.get_proposal_fn(&s.vault_id, &tx_id);
    assert!(proposal.executed);
}

#[test]
#[should_panic]
fn test_execute_below_threshold_panics() {
    let s = setup();
    let target = Address::generate(&s.env);
    let tx_id = s.client.propose_transaction(
        &s.vault_id, &s.signers.get(0).unwrap(), &target, &10, &false,
    );
    // Sadece 1 onay var, threshold 2 — execute panic atmalı.
    s.client.approve(&s.vault_id, &tx_id, &s.signers.get(0).unwrap());
    s.client.execute(&s.vault_id, &tx_id, &s.signers.get(0).unwrap());
}

#[test]
#[should_panic]
fn test_zk_double_vote_same_nullifier_panics() {
    let s = setup();
    let target = Address::generate(&s.env);

    let tx_id = s.client.propose_transaction(
        &s.vault_id, &s.signers.get(0).unwrap(), &target, &10, &true, // private
    );

    let nullifier = U256::from_u32(&s.env, 0xABCDEF12);
    let approval = ZKApproval {
        tx_id,
        proof: Bytes::from_array(&s.env, &[1u8; 8]),
        public_inputs: Vec::new(&s.env),
        nullifier: nullifier.clone(),
    };

    // İlk ZK onay geçer.
    s.client.approve_zk(&s.vault_id, &tx_id, &s.signers.get(0).unwrap(), &approval);

    // Farklı signer ama aynı nullifier — double-vote, panic atmalı.
    let approval2 = ZKApproval {
        tx_id,
        proof: Bytes::from_array(&s.env, &[2u8; 8]),
        public_inputs: Vec::new(&s.env),
        nullifier,
    };
    s.client.approve_zk(&s.vault_id, &tx_id, &s.signers.get(1).unwrap(), &approval2);
}
