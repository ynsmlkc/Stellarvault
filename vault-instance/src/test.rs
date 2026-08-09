#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Bytes, Env, String, U256, Vec,
};

use crate::{BatchItem, Error, Policy, VaultInstance, VaultInstanceClient, ZKApproval};

struct Setup<'a> {
    env: Env,
    vault: VaultInstanceClient<'a>,
    vault_addr: Address,
    token: TokenClient<'a>,
    token_admin: StellarAssetClient<'a>,
    owner: Address,
    signers: Vec<Address>,
}

impl Setup<'_> {
    fn signer(&self, i: u32) -> Address {
        self.signers.get(i).unwrap()
    }
    /// A permissive policy with one guard dialled in.
    fn set_policy(&self, p: Policy) {
        self.vault.set_policy(&p);
    }
}

fn open_policy() -> Policy {
    Policy {
        max_per_tx: 0,
        spending_cap: 0,
        cap_window_ledgers: 0,
        timelock_ledgers: 0,
        allowlist_only: false,
    }
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

/// Fund the vault and approve `tx` up to the threshold.
fn approve_to_threshold(s: &Setup, tx: u64, count: u32) {
    for i in 0..count {
        s.vault.approve(&tx, &s.signer(i));
    }
}

// ---------------------------------------------------------------- v1 behaviour

#[test]
fn test_create_and_query() {
    let s = setup(2);
    let c = s.vault.get_config();
    assert_eq!(c.name, String::from_str(&s.env, "Team Vault"));
    assert_eq!(c.threshold, 2);
    assert_eq!(c.signer_count, 3);
    assert!(s.vault.is_signer(&s.signer(1)));
    assert!(!s.vault.is_signer(&Address::generate(&s.env)));
    assert_eq!(s.vault.get_balance(), 0);
    assert_eq!(s.vault.version(), 4);
}

#[test]
fn test_transparent_execute_moves_own_funds() {
    let s = setup(2);
    // deposit = plain transfer to the vault's address (Safe-style)
    s.token_admin.mint(&s.vault_addr, &5_000_000);
    assert_eq!(s.vault.get_balance(), 5_000_000);

    let recipient = Address::generate(&s.env);
    let tx = s.vault.propose(&s.signer(0), &recipient, &1_000_000, &false);
    approve_to_threshold(&s, tx, 2);
    s.vault.execute(&tx, &s.signer(0));

    assert_eq!(s.token.balance(&recipient), 1_000_000);
    assert_eq!(s.vault.get_balance(), 4_000_000);
    assert!(s.vault.get_proposal(&tx).executed);
}

#[test]
fn test_private_execute_moves_funds_with_zk_approval() {
    let s = setup(1);
    s.token_admin.mint(&s.vault_addr, &3_000_000);

    let recipient = Address::generate(&s.env);
    let tx = s.vault.propose(&s.signer(0), &recipient, &1_000_000, &true);

    let zk = ZKApproval {
        proof: Bytes::from_array(&s.env, &[1u8; 8]),
        public_inputs: Vec::new(&s.env),
        nullifier: U256::from_u32(&s.env, 0xAB),
    };
    s.vault.approve_zk(&tx, &s.signer(0), &zk);
    s.vault.execute(&tx, &s.signer(0));

    // funds move (amount/recipient are public); only the approver identity was hidden by ZK
    assert!(s.vault.get_proposal(&tx).executed);
    assert_eq!(s.token.balance(&recipient), 1_000_000);
    assert_eq!(s.vault.get_balance(), 2_000_000);
}

#[test]
fn test_double_approve_rejected() {
    let s = setup(2);
    let tx = s.vault.propose(&s.signer(0), &Address::generate(&s.env), &10, &false);
    s.vault.approve(&tx, &s.signer(0));
    assert_eq!(
        s.vault.try_approve(&tx, &s.signer(0)),
        Err(Ok(Error::AlreadyApproved))
    );
}

#[test]
fn test_non_signer_approve_rejected() {
    let s = setup(2);
    let tx = s.vault.propose(&s.signer(0), &Address::generate(&s.env), &10, &false);
    assert_eq!(
        s.vault.try_approve(&tx, &Address::generate(&s.env)),
        Err(Ok(Error::NotSigner))
    );
}

#[test]
fn test_execute_below_threshold_rejected() {
    let s = setup(2);
    let tx = s.vault.propose(&s.signer(0), &Address::generate(&s.env), &10, &false);
    s.vault.approve(&tx, &s.signer(0));
    assert_eq!(
        s.vault.try_execute(&tx, &s.signer(0)),
        Err(Ok(Error::ThresholdNotMet))
    );
}

#[test]
fn test_zk_double_vote_rejected() {
    let s = setup(2);
    let tx = s.vault.propose(&s.signer(0), &Address::generate(&s.env), &10, &true);
    let mk = |n: u32| ZKApproval {
        proof: Bytes::from_array(&s.env, &[n as u8; 8]),
        public_inputs: Vec::new(&s.env),
        nullifier: U256::from_u32(&s.env, 0x99),
    };
    s.vault.approve_zk(&tx, &s.signer(0), &mk(1));
    assert_eq!(
        s.vault.try_approve_zk(&tx, &s.signer(1), &mk(2)), // same nullifier
        Err(Ok(Error::NullifierUsed))
    );
}

// ------------------------------------------------------------ proposal hygiene

#[test]
fn test_propose_by_non_signer_rejected() {
    let s = setup(2);
    let outsider = Address::generate(&s.env);
    assert_eq!(
        s.vault.try_propose(&outsider, &Address::generate(&s.env), &10, &false),
        Err(Ok(Error::NotSigner))
    );
}

#[test]
fn test_propose_non_positive_amount_rejected() {
    let s = setup(2);
    let target = Address::generate(&s.env);
    assert_eq!(
        s.vault.try_propose(&s.signer(0), &target, &0, &false),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        s.vault.try_propose(&s.signer(0), &target, &-5, &false),
        Err(Ok(Error::InvalidAmount))
    );
}

#[test]
fn test_insufficient_balance_rejected() {
    let s = setup(1);
    s.token_admin.mint(&s.vault_addr, &100);
    let tx = s.vault.propose(&s.signer(0), &Address::generate(&s.env), &500, &false);
    s.vault.approve(&tx, &s.signer(0));
    assert_eq!(
        s.vault.try_execute(&tx, &s.signer(0)),
        Err(Ok(Error::InsufficientBalance))
    );
}

// ------------------------------------------------------------------ cancelling

#[test]
fn test_cancel_marks_cancelled_not_executed() {
    let s = setup(2);
    let tx = s.vault.propose(&s.signer(1), &Address::generate(&s.env), &10, &false);
    s.vault.cancel(&tx, &s.signer(1));

    // v1 conflated the two; a cancelled proposal must not read back as executed
    assert!(s.vault.is_cancelled(&tx));
    assert!(!s.vault.get_proposal(&tx).executed);
    let st = s.vault.get_status(&tx);
    assert!(st.cancelled && !st.executed);

    assert_eq!(s.vault.try_approve(&tx, &s.signer(0)), Err(Ok(Error::AlreadyCancelled)));
    assert_eq!(s.vault.try_execute(&tx, &s.signer(0)), Err(Ok(Error::AlreadyCancelled)));
}

#[test]
fn test_owner_can_cancel_others_proposal_but_stranger_cannot() {
    let s = setup(2);
    let tx = s.vault.propose(&s.signer(1), &Address::generate(&s.env), &10, &false);
    assert_eq!(
        s.vault.try_cancel(&tx, &s.signer(2)),
        Err(Ok(Error::NotProposer))
    );
    s.vault.cancel(&tx, &s.owner);
    assert!(s.vault.is_cancelled(&tx));
}

// --------------------------------------------------------------- guard: limit

#[test]
fn test_max_per_tx_blocks_propose() {
    let s = setup(2);
    s.set_policy(Policy { max_per_tx: 1_000, ..open_policy() });
    assert_eq!(s.vault.get_policy().max_per_tx, 1_000);

    let target = Address::generate(&s.env);
    assert_eq!(
        s.vault.try_propose(&s.signer(0), &target, &1_001, &false),
        Err(Ok(Error::ExceedsMaxPerTx))
    );
    // exactly at the limit is allowed
    s.vault.propose(&s.signer(0), &target, &1_000, &false);
}

#[test]
fn test_policy_tightened_after_propose_blocks_execute() {
    let s = setup(1);
    s.token_admin.mint(&s.vault_addr, &10_000);
    let tx = s.vault.propose(&s.signer(0), &Address::generate(&s.env), &5_000, &false);
    s.vault.approve(&tx, &s.signer(0));

    // owner tightens the policy while the proposal was collecting approvals
    s.set_policy(Policy { max_per_tx: 1_000, ..open_policy() });

    assert_eq!(
        s.vault.try_execute(&tx, &s.signer(0)),
        Err(Ok(Error::ExceedsMaxPerTx))
    );
}

// ------------------------------------------------------------ guard: time-lock

#[test]
fn test_timelock_blocks_then_allows() {
    let s = setup(1);
    s.token_admin.mint(&s.vault_addr, &10_000);
    s.set_policy(Policy { timelock_ledgers: 10, ..open_policy() });

    s.env.ledger().set_sequence_number(100);
    let recipient = Address::generate(&s.env);
    let tx = s.vault.propose(&s.signer(0), &recipient, &1_000, &false);
    s.vault.approve(&tx, &s.signer(0));

    let st = s.vault.get_status(&tx);
    assert_eq!(st.unlock_ledger, 110);

    s.env.ledger().set_sequence_number(109);
    assert_eq!(
        s.vault.try_execute(&tx, &s.signer(0)),
        Err(Ok(Error::TimelockActive))
    );

    s.env.ledger().set_sequence_number(110);
    s.vault.execute(&tx, &s.signer(0));
    assert_eq!(s.token.balance(&recipient), 1_000);
}

// ----------------------------------------------------------- guard: spend cap

#[test]
fn test_spending_cap_within_and_across_windows() {
    let s = setup(1);
    s.token_admin.mint(&s.vault_addr, &100_000);
    s.set_policy(Policy { spending_cap: 1_500, cap_window_ledgers: 100, ..open_policy() });

    s.env.ledger().set_sequence_number(150); // window 1
    let recipient = Address::generate(&s.env);

    let spend = |amount: i128| {
        let tx = s.vault.propose(&s.signer(0), &recipient, &amount, &false);
        s.vault.approve(&tx, &s.signer(0));
        s.vault.try_execute(&tx, &s.signer(0))
    };

    assert!(spend(1_000).is_ok());
    assert_eq!(s.vault.spent_in_window(), 1_000);

    // 1000 + 600 > 1500 cap
    assert_eq!(spend(600), Err(Ok(Error::ExceedsSpendingCap)));
    assert_eq!(s.vault.spent_in_window(), 1_000, "a rejected spend must not be booked");

    // the remainder still fits
    assert!(spend(500).is_ok());
    assert_eq!(s.vault.spent_in_window(), 1_500);

    // next window resets the budget
    s.env.ledger().set_sequence_number(250); // window 2
    assert_eq!(s.vault.spent_in_window(), 0);
    assert!(spend(1_500).is_ok());
    assert_eq!(s.token.balance(&recipient), 3_000);
}

// ----------------------------------------------------------- guard: allowlist

#[test]
fn test_allowlist_only_restricts_recipients() {
    let s = setup(1);
    s.token_admin.mint(&s.vault_addr, &10_000);
    let good = Address::generate(&s.env);
    let bad = Address::generate(&s.env);

    s.vault.allow_recipient(&good);
    s.vault.allow_recipient(&good); // idempotent
    assert_eq!(s.vault.get_allowed().len(), 1);
    s.set_policy(Policy { allowlist_only: true, ..open_policy() });

    assert_eq!(
        s.vault.try_propose(&s.signer(0), &bad, &100, &false),
        Err(Ok(Error::RecipientNotAllowed))
    );

    let tx = s.vault.propose(&s.signer(0), &good, &100, &false);
    s.vault.approve(&tx, &s.signer(0));
    s.vault.execute(&tx, &s.signer(0));
    assert_eq!(s.token.balance(&good), 100);
}

#[test]
fn test_revoking_a_recipient_blocks_a_pending_proposal() {
    let s = setup(1);
    s.token_admin.mint(&s.vault_addr, &10_000);
    let target = Address::generate(&s.env);
    s.vault.allow_recipient(&target);
    s.set_policy(Policy { allowlist_only: true, ..open_policy() });

    let tx = s.vault.propose(&s.signer(0), &target, &100, &false);
    s.vault.approve(&tx, &s.signer(0));

    s.vault.revoke_recipient(&target);
    assert_eq!(
        s.vault.try_execute(&tx, &s.signer(0)),
        Err(Ok(Error::RecipientNotAllowed))
    );
}

// ---------------------------------------------------------------------- batch

#[test]
fn test_batch_executes_every_item_atomically() {
    let s = setup(2);
    s.token_admin.mint(&s.vault_addr, &10_000);

    let a = Address::generate(&s.env);
    let b = Address::generate(&s.env);
    let items = vec![
        &s.env,
        BatchItem { target: a.clone(), amount: 300 },
        BatchItem { target: b.clone(), amount: 700 },
    ];

    let tx = s.vault.propose_batch(&s.signer(0), &items, &false);
    let st = s.vault.get_status(&tx);
    assert!(st.is_batch);
    assert_eq!(st.amount, 1_000, "umbrella proposal carries the batch total");
    assert_eq!(s.vault.get_batch(&tx).len(), 2);

    approve_to_threshold(&s, tx, 2);
    s.vault.execute(&tx, &s.signer(0));

    assert_eq!(s.token.balance(&a), 300);
    assert_eq!(s.token.balance(&b), 700);
    assert_eq!(s.vault.get_balance(), 9_000);
}

#[test]
fn test_batch_total_cannot_bypass_max_per_tx() {
    let s = setup(1);
    s.set_policy(Policy { max_per_tx: 1_000, ..open_policy() });

    // each item is under the limit, the total is not
    let items = vec![
        &s.env,
        BatchItem { target: Address::generate(&s.env), amount: 600 },
        BatchItem { target: Address::generate(&s.env), amount: 600 },
    ];
    assert_eq!(
        s.vault.try_propose_batch(&s.signer(0), &items, &false),
        Err(Ok(Error::ExceedsMaxPerTx))
    );
}

#[test]
fn test_batch_respects_allowlist_and_rejects_empty() {
    let s = setup(1);
    let allowed = Address::generate(&s.env);
    s.vault.allow_recipient(&allowed);
    s.set_policy(Policy { allowlist_only: true, ..open_policy() });

    let mixed = vec![
        &s.env,
        BatchItem { target: allowed, amount: 10 },
        BatchItem { target: Address::generate(&s.env), amount: 10 },
    ];
    assert_eq!(
        s.vault.try_propose_batch(&s.signer(0), &mixed, &false),
        Err(Ok(Error::RecipientNotAllowed))
    );

    assert_eq!(
        s.vault.try_propose_batch(&s.signer(0), &Vec::new(&s.env), &false),
        Err(Ok(Error::EmptyBatch))
    );
}

// ------------------------------------------------------------ signer mgmt

#[test]
fn test_duplicate_and_unknown_signer_rejected() {
    let s = setup(2);
    assert_eq!(
        s.vault.try_add_signer(&s.signer(1)),
        Err(Ok(Error::DuplicateSigner))
    );
    assert_eq!(
        s.vault.try_remove_signer(&Address::generate(&s.env)),
        Err(Ok(Error::SignerNotFound))
    );
    // removing down to below the threshold is refused
    s.vault.remove_signer(&s.signer(2));
    assert_eq!(
        s.vault.try_remove_signer(&s.signer(1)),
        Err(Ok(Error::BadThreshold))
    );
}

// ----------------------------------------------------------- default policy

#[test]
fn test_unset_policy_is_fully_permissive() {
    let s = setup(1);
    s.token_admin.mint(&s.vault_addr, &10_000);
    let p = s.vault.get_policy();
    assert_eq!(p, open_policy());

    // a vault that never sets a policy behaves exactly like v1
    let recipient = Address::generate(&s.env);
    let tx = s.vault.propose(&s.signer(0), &recipient, &9_999, &false);
    s.vault.approve(&tx, &s.signer(0));
    s.vault.execute(&tx, &s.signer(0));
    assert_eq!(s.token.balance(&recipient), 9_999);
    assert_eq!(s.vault.spent_in_window(), 0, "no cap set => nothing is booked");
}

#[test]
fn test_negative_policy_rejected() {
    let s = setup(1);
    assert_eq!(
        s.vault.try_set_policy(&Policy { max_per_tx: -1, ..open_policy() }),
        Err(Ok(Error::InvalidPolicy))
    );
}

// ------------------------------------------------ on-chain proof enforcement

use soroban_sdk::{contract, contractimpl, symbol_short, BytesN, IntoVal, Symbol};

const ACCEPT: Symbol = symbol_short!("accept");

/// Stands in for `groth16-verifier`. The real cryptography is tested in that
/// crate against a real proof; what needs testing *here* is that the vault pins
/// every public input to itself and to the proposal, and that it acts on the
/// verifier's answer. A mock makes both answers reachable on demand.
#[contract]
pub struct MockVerifier;

#[contractimpl]
impl MockVerifier {
    pub fn __constructor(env: Env, accept: bool) {
        env.storage().instance().set(&ACCEPT, &accept);
    }
    pub fn verify(env: Env, _proof: crate::Groth16Proof, _public_inputs: Vec<U256>) -> bool {
        env.storage().instance().get(&ACCEPT).unwrap()
    }
}

const VAULT_ID: u32 = 7;
const SIGNER_ROOT: u32 = 0xB007;

/// Wire a vault to a mock verifier and return the helper that builds a ZK
/// approval whose public inputs match what the vault will demand.
fn with_verifier(s: &Setup, accept: bool) {
    let v = s.env.register(MockVerifier, (accept,));
    s.vault.set_zk_config(
        &v,
        &U256::from_u32(&s.env, VAULT_ID),
        &U256::from_u32(&s.env, SIGNER_ROOT),
    );
}

/// A well-formed approval: 256-byte proof, the four public inputs the vault
/// expects, nullifier matching the one proven.
fn zk_for(s: &Setup, tx_id: u64, nullifier: u32) -> ZKApproval {
    let limb = |v: u32| -> BytesN<32> {
        let mut b = [0u8; 32];
        b[28..].copy_from_slice(&v.to_be_bytes());
        BytesN::from_array(&s.env, &b)
    };
    let mut inputs = Vec::new(&s.env);
    inputs.push_back(limb(VAULT_ID));
    inputs.push_back(limb(tx_id as u32));
    inputs.push_back(limb(SIGNER_ROOT));
    inputs.push_back(limb(nullifier));
    ZKApproval {
        proof: Bytes::from_array(&s.env, &[7u8; 256]),
        public_inputs: inputs,
        nullifier: U256::from_u32(&s.env, nullifier),
    }
}

#[test]
fn test_zk_config_round_trips() {
    let s = setup(1);
    assert!(s.vault.get_zk_config().is_none(), "a fresh vault does not verify");
    with_verifier(&s, true);
    let cfg = s.vault.get_zk_config().unwrap();
    assert_eq!(cfg.vault_id, U256::from_u32(&s.env, VAULT_ID));
    assert_eq!(cfg.signer_root, U256::from_u32(&s.env, SIGNER_ROOT));
}

#[test]
fn test_verified_proof_is_accepted() {
    let s = setup(1);
    with_verifier(&s, true);
    let tx = s.vault.propose(&s.signer(0), &Address::generate(&s.env), &10, &true);
    s.vault.approve_zk(&tx, &s.signer(0), &zk_for(&s, tx, 1));
    assert_eq!(s.vault.get_proposal(&tx).approval_count, 1);
}

#[test]
fn test_rejected_proof_does_not_count() {
    let s = setup(1);
    with_verifier(&s, false); // verifier says no
    let tx = s.vault.propose(&s.signer(0), &Address::generate(&s.env), &10, &true);
    assert_eq!(
        s.vault.try_approve_zk(&tx, &s.signer(0), &zk_for(&s, tx, 1)),
        Err(Ok(Error::ProofRejected))
    );
    assert_eq!(s.vault.get_proposal(&tx).approval_count, 0);
}

/// The reason binding txId matters. The circuit derives the nullifier from
/// txId, and txId is a *public input the prover chooses*. Left unbound, one
/// signer could mint a fresh nullifier per proof — each individually valid,
/// each passing the double-vote check — and approve the same proposal until
/// the threshold was met, alone. Verifying the proof alone would not stop it.
#[test]
fn test_proof_for_another_proposal_cannot_be_replayed() {
    let s = setup(2);
    with_verifier(&s, true);
    let a = s.vault.propose(&s.signer(0), &Address::generate(&s.env), &10, &true);
    let b = s.vault.propose(&s.signer(0), &Address::generate(&s.env), &20, &true);

    // an approval proved against proposal `a`, aimed at proposal `b`
    assert_eq!(
        s.vault.try_approve_zk(&b, &s.signer(0), &zk_for(&s, a, 1)),
        Err(Ok(Error::PublicInputMismatch))
    );
    assert_eq!(s.vault.get_proposal(&b).approval_count, 0);
}

#[test]
fn test_proof_for_another_vault_is_rejected() {
    let s = setup(1);
    with_verifier(&s, true);
    let tx = s.vault.propose(&s.signer(0), &Address::generate(&s.env), &10, &true);

    let mut zk = zk_for(&s, tx, 1);
    let mut wrong = [0u8; 32];
    wrong[31] = 0xFF; // a different vault's domain id
    zk.public_inputs.set(0, BytesN::from_array(&s.env, &wrong));
    assert_eq!(
        s.vault.try_approve_zk(&tx, &s.signer(0), &zk),
        Err(Ok(Error::PublicInputMismatch))
    );
}

#[test]
fn test_proof_against_unpublished_signer_set_is_rejected() {
    let s = setup(1);
    with_verifier(&s, true);
    let tx = s.vault.propose(&s.signer(0), &Address::generate(&s.env), &10, &true);

    // a root the owner never committed to — i.e. a signer set of the prover's
    // own invention
    let mut zk = zk_for(&s, tx, 1);
    let mut root = [0u8; 32];
    root[31] = 0x42;
    zk.public_inputs.set(2, BytesN::from_array(&s.env, &root));
    assert_eq!(
        s.vault.try_approve_zk(&tx, &s.signer(0), &zk),
        Err(Ok(Error::PublicInputMismatch))
    );
}

#[test]
fn test_recorded_nullifier_must_match_the_proven_one() {
    let s = setup(1);
    with_verifier(&s, true);
    let tx = s.vault.propose(&s.signer(0), &Address::generate(&s.env), &10, &true);

    // proof says nullifier 1, the caller asks to record 2 — otherwise a signer
    // could burn someone else's tag, or keep their own unspent
    let mut zk = zk_for(&s, tx, 1);
    zk.nullifier = U256::from_u32(&s.env, 2);
    assert_eq!(
        s.vault.try_approve_zk(&tx, &s.signer(0), &zk),
        Err(Ok(Error::PublicInputMismatch))
    );
}

#[test]
fn test_malformed_proof_blob_is_rejected() {
    let s = setup(1);
    with_verifier(&s, true);
    let tx = s.vault.propose(&s.signer(0), &Address::generate(&s.env), &10, &true);

    let mut zk = zk_for(&s, tx, 1);
    zk.proof = Bytes::from_array(&s.env, &[7u8; 128]); // not a || b || c
    assert_eq!(
        s.vault.try_approve_zk(&tx, &s.signer(0), &zk),
        Err(Ok(Error::BadProofEncoding))
    );
}

#[test]
fn test_wrong_public_input_arity_is_rejected() {
    let s = setup(1);
    with_verifier(&s, true);
    let tx = s.vault.propose(&s.signer(0), &Address::generate(&s.env), &10, &true);

    let mut zk = zk_for(&s, tx, 1);
    zk.public_inputs.pop_back();
    assert_eq!(
        s.vault.try_approve_zk(&tx, &s.signer(0), &zk),
        Err(Ok(Error::PublicInputMismatch))
    );
}

/// Vaults deployed before this feature existed keep working — unverified, and
/// `get_zk_config` returns None so nothing pretends otherwise.
#[test]
fn test_unconfigured_vault_stays_in_unenforced_mode() {
    let s = setup(1);
    let tx = s.vault.propose(&s.signer(0), &Address::generate(&s.env), &10, &true);
    let zk = ZKApproval {
        proof: Bytes::from_array(&s.env, &[1u8; 8]),
        public_inputs: Vec::new(&s.env),
        nullifier: U256::from_u32(&s.env, 0xAB),
    };
    s.vault.approve_zk(&tx, &s.signer(0), &zk);
    assert_eq!(s.vault.get_proposal(&tx).approval_count, 1);
    assert!(s.vault.get_zk_config().is_none());
}

// ------------------------------------------------- arbitrary contract calls

/// A stand-in for whatever the vault might call — a DEX, a lending market,
/// another token. Records that it was invoked, and by whom.
#[contract]
pub struct Callee;

#[contractimpl]
impl Callee {
    pub fn bump(env: Env, by: u32) -> u32 {
        let k = symbol_short!("n");
        let n: u32 = env.storage().instance().get(&k).unwrap_or(0);
        env.storage().instance().set(&k, &(n + by));
        n + by
    }
    pub fn count(env: Env) -> u32 {
        env.storage().instance().get(&symbol_short!("n")).unwrap_or(0)
    }
}

fn callee(s: &Setup) -> Address {
    s.env.register(Callee, ())
}

#[test]
fn test_call_requires_an_allowlisted_target() {
    let s = setup(1);
    let c = callee(&s);
    // nothing is callable until the owner says so
    assert_eq!(
        s.vault.try_propose_call(&s.signer(0), &c, &symbol_short!("bump"), &vec![&s.env, 1u32.into_val(&s.env)], &Vec::new(&s.env), &false),
        Err(Ok(Error::ContractNotAllowed))
    );
    assert_eq!(s.vault.get_allowed_contracts().len(), 0);
}

#[test]
fn test_allowed_call_executes_as_the_vault() {
    let s = setup(1);
    let c = callee(&s);
    s.vault.allow_contract(&c);

    let tx = s.vault.propose_call(&s.signer(0), &c, &symbol_short!("bump"), &vec![&s.env, 5u32.into_val(&s.env)], &Vec::new(&s.env), &false);
    let spec = s.vault.get_call(&tx).unwrap();
    assert_eq!(spec.contract, c);

    s.vault.approve(&tx, &s.signer(0));
    s.vault.execute(&tx, &s.signer(0));

    assert_eq!(CalleeClient::new(&s.env, &c).count(), 5, "the call actually ran");
    assert!(s.vault.get_proposal(&tx).executed);
}

/// The reason the vault can never be its own call target. A proposal that could
/// call this contract's admin entry points would be able to lift every guard,
/// rewrite the signer set, or swap the code — one passing proposal becoming
/// total control. Refused at both ends.
#[test]
fn test_vault_can_never_call_itself() {
    let s = setup(1);
    assert_eq!(
        s.vault.try_allow_contract(&s.vault_addr),
        Err(Ok(Error::SelfCallForbidden))
    );
    assert_eq!(
        s.vault.try_propose_call(&s.signer(0), &s.vault_addr, &Symbol::new(&s.env, "set_policy"), &Vec::new(&s.env), &Vec::new(&s.env), &false),
        Err(Ok(Error::SelfCallForbidden))
    );
}

#[test]
fn test_revoking_a_target_blocks_a_pending_call() {
    let s = setup(1);
    let c = callee(&s);
    s.vault.allow_contract(&c);
    let tx = s.vault.propose_call(&s.signer(0), &c, &symbol_short!("bump"), &vec![&s.env, 1u32.into_val(&s.env)], &Vec::new(&s.env), &false);
    s.vault.approve(&tx, &s.signer(0));

    s.vault.revoke_contract(&c);
    assert_eq!(
        s.vault.try_execute(&tx, &s.signer(0)),
        Err(Ok(Error::ContractNotAllowed))
    );
    assert_eq!(CalleeClient::new(&s.env, &c).count(), 0, "nothing ran");
}

#[test]
fn test_call_still_needs_the_threshold_and_respects_the_timelock() {
    let s = setup(2);
    let c = callee(&s);
    s.vault.allow_contract(&c);
    s.set_policy(Policy { timelock_ledgers: 10, ..open_policy() });

    s.env.ledger().set_sequence_number(200);
    let tx = s.vault.propose_call(&s.signer(0), &c, &symbol_short!("bump"), &vec![&s.env, 1u32.into_val(&s.env)], &Vec::new(&s.env), &false);

    s.vault.approve(&tx, &s.signer(0));
    assert_eq!(s.vault.try_execute(&tx, &s.signer(0)), Err(Ok(Error::ThresholdNotMet)));

    s.vault.approve(&tx, &s.signer(1));
    assert_eq!(s.vault.try_execute(&tx, &s.signer(0)), Err(Ok(Error::TimelockActive)));

    s.env.ledger().set_sequence_number(210);
    s.vault.execute(&tx, &s.signer(0));
    assert_eq!(CalleeClient::new(&s.env, &c).count(), 1);
}

#[test]
fn test_call_proposal_can_be_cancelled_and_not_replayed() {
    let s = setup(1);
    let c = callee(&s);
    s.vault.allow_contract(&c);
    let tx = s.vault.propose_call(&s.signer(0), &c, &symbol_short!("bump"), &vec![&s.env, 1u32.into_val(&s.env)], &Vec::new(&s.env), &false);
    s.vault.cancel(&tx, &s.signer(0));
    assert_eq!(s.vault.try_execute(&tx, &s.signer(0)), Err(Ok(Error::AlreadyCancelled)));

    // and an executed call cannot run twice
    let tx2 = s.vault.propose_call(&s.signer(0), &c, &symbol_short!("bump"), &vec![&s.env, 2u32.into_val(&s.env)], &Vec::new(&s.env), &false);
    s.vault.approve(&tx2, &s.signer(0));
    s.vault.execute(&tx2, &s.signer(0));
    assert_eq!(s.vault.try_execute(&tx2, &s.signer(0)), Err(Ok(Error::AlreadyExecuted)));
    assert_eq!(CalleeClient::new(&s.env, &c).count(), 2);
}

/// Multi-asset falls out of this: a token the vault was not created with is
/// just another contract to call.
#[test]
fn test_call_moves_a_token_the_vault_was_not_created_with() {
    let s = setup(1);
    let admin = Address::generate(&s.env);
    let other = s.env.register_stellar_asset_contract_v2(admin.clone());
    let other_token = TokenClient::new(&s.env, &other.address());
    StellarAssetClient::new(&s.env, &other.address()).mint(&s.vault_addr, &1_000);

    s.vault.allow_contract(&other.address());
    let recipient = Address::generate(&s.env);
    let tx = s.vault.propose_call(
        &s.signer(0),
        &other.address(),
        &Symbol::new(&s.env, "transfer"),
        &vec![&s.env, s.vault_addr.into_val(&s.env), recipient.into_val(&s.env), 400i128.into_val(&s.env)],
        &Vec::new(&s.env),
        &false,
    );
    s.vault.approve(&tx, &s.signer(0));
    s.vault.execute(&tx, &s.signer(0));

    assert_eq!(other_token.balance(&recipient), 400);
    assert_eq!(other_token.balance(&s.vault_addr), 600);
}

// ------------------------------------------- anonymous (unauthenticated) approval

#[test]
fn test_anon_approval_needs_verification_enabled() {
    let s = setup(1);
    let tx = s.vault.propose(&s.signer(0), &Address::generate(&s.env), &10, &true);
    // no zk config: the proof would not be checked, so dropping the auth too
    // would let anyone approve
    assert_eq!(
        s.vault.try_approve_zk_anon(&tx, &zk_for(&s, tx, 1)),
        Err(Ok(Error::VerificationNotEnabled))
    );
}

/// The whole point: a wallet that is NOT a signer submits a valid proof, and it
/// counts. That is what lets a relayer — or any third party — carry an approval
/// without the ledger recording who produced it.
#[test]
fn test_anyone_can_submit_a_valid_proof() {
    let s = setup(1);
    with_verifier(&s, true);
    let tx = s.vault.propose(&s.signer(0), &Address::generate(&s.env), &10, &true);

    let stranger = Address::generate(&s.env);
    assert!(!s.vault.is_signer(&stranger));

    // no `signer` argument exists on this entry point at all
    s.vault.approve_zk_anon(&tx, &zk_for(&s, tx, 1));
    assert_eq!(s.vault.get_proposal(&tx).approval_count, 1);
}

#[test]
fn test_anon_approval_still_rejects_a_bad_proof() {
    let s = setup(1);
    with_verifier(&s, false); // verifier says no
    let tx = s.vault.propose(&s.signer(0), &Address::generate(&s.env), &10, &true);
    assert_eq!(
        s.vault.try_approve_zk_anon(&tx, &zk_for(&s, tx, 1)),
        Err(Ok(Error::ProofRejected))
    );
    assert_eq!(s.vault.get_proposal(&tx).approval_count, 0);
}

#[test]
fn test_anon_approval_cannot_be_replayed_or_double_counted() {
    let s = setup(2);
    with_verifier(&s, true);
    let a = s.vault.propose(&s.signer(0), &Address::generate(&s.env), &10, &true);
    let b = s.vault.propose(&s.signer(0), &Address::generate(&s.env), &20, &true);

    s.vault.approve_zk_anon(&a, &zk_for(&s, a, 1));
    // same nullifier again
    assert_eq!(
        s.vault.try_approve_zk_anon(&a, &zk_for(&s, a, 1)),
        Err(Ok(Error::NullifierUsed))
    );
    // proof aimed at another proposal
    assert_eq!(
        s.vault.try_approve_zk_anon(&b, &zk_for(&s, a, 2)),
        Err(Ok(Error::PublicInputMismatch))
    );
    assert_eq!(s.vault.get_proposal(&a).approval_count, 1);
    assert_eq!(s.vault.get_proposal(&b).approval_count, 0);
}

/// A callee that moves the caller's funds — the shape that broke in testing.
/// `deposit` on a confidential token does exactly this: it calls the underlying
/// asset's `transfer(from = vault, …)`, one level below the vault's own call.
#[contract]
pub struct Puller;

#[contractimpl]
impl Puller {
    pub fn pull(env: Env, token: Address, from: Address, amount: i128) {
        TokenClient::new(&env, &token).transfer(&from, &env.current_contract_address(), &amount);
    }
}

/// Without pre-authorisation the host refuses the nested transfer, however the
/// proposal was approved: a contract's own authority covers only what it invokes
/// directly.
#[test]
fn test_nested_call_needs_explicit_authorisation() {
    let s = setup(1);
    s.token_admin.mint(&s.vault_addr, &1_000);
    let puller = s.env.register(Puller, ());
    s.vault.allow_contract(&puller);

    let args = vec![
        &s.env,
        s.token.address.into_val(&s.env),
        s.vault_addr.into_val(&s.env),
        400i128.into_val(&s.env),
    ];

    // no auth list -> the sub-call is unauthorised
    let tx = s.vault.propose_call(&s.signer(0), &puller, &symbol_short!("pull"), &args, &Vec::new(&s.env), &false);
    s.vault.approve(&tx, &s.signer(0));
    assert!(s.vault.try_execute(&tx, &s.signer(0)).is_err(), "nested transfer must not go through unauthorised");
    assert_eq!(s.token.balance(&puller), 0);
}

#[test]
fn test_nested_call_succeeds_when_authorised() {
    let s = setup(1);
    s.token_admin.mint(&s.vault_addr, &1_000);
    let puller = s.env.register(Puller, ());
    s.vault.allow_contract(&puller);
    s.vault.allow_contract(&s.token.address); // the sub-call target, too

    let args = vec![
        &s.env,
        s.token.address.into_val(&s.env),
        s.vault_addr.into_val(&s.env),
        400i128.into_val(&s.env),
    ];
    let auth = vec![
        &s.env,
        crate::CallSpec {
            contract: s.token.address.clone(),
            function: Symbol::new(&s.env, "transfer"),
            args: vec![
                &s.env,
                s.vault_addr.into_val(&s.env),
                puller.into_val(&s.env),
                400i128.into_val(&s.env),
            ],
        },
    ];

    let tx = s.vault.propose_call(&s.signer(0), &puller, &symbol_short!("pull"), &args, &auth, &false);
    s.vault.approve(&tx, &s.signer(0));
    s.vault.execute(&tx, &s.signer(0));

    assert_eq!(s.token.balance(&puller), 400, "the callee pulled the funds");
    assert_eq!(s.vault.get_balance(), 600);
}

/// Authorising a sub-call is a larger permission than making one, so it cannot
/// be granted to a contract the owner never allowlisted.
#[test]
fn test_auth_target_must_be_allowlisted() {
    let s = setup(1);
    let puller = s.env.register(Puller, ());
    s.vault.allow_contract(&puller); // but NOT the token

    let auth = vec![
        &s.env,
        crate::CallSpec {
            contract: s.token.address.clone(),
            function: Symbol::new(&s.env, "transfer"),
            args: Vec::new(&s.env),
        },
    ];
    assert_eq!(
        s.vault.try_propose_call(&s.signer(0), &puller, &symbol_short!("pull"), &Vec::new(&s.env), &auth, &false),
        Err(Ok(Error::ContractNotAllowed))
    );
}

/* ================= re-entrancy ================= */

/// A callee that calls back into the vault while the vault's own `execute` is
/// still on the stack. An allowlisted contract is not a trusted one — it can be
/// upgraded, or be a router that got compromised — so what stops it matters.
#[contract]
pub struct Reenterer;

#[contractimpl]
impl Reenterer {
    pub fn go(env: Env, vault: Address, tx_id: u64) {
        let me = env.current_contract_address();
        let _: () = env.invoke_contract(
            &vault,
            &Symbol::new(&env, "execute"),
            vec![&env, tx_id.into_val(&env), me.into_val(&env)],
        );
    }

    /// Not `execute` — a plain read. Included because the interesting question
    /// is whether the vault is protected by its own ordering or by the host.
    pub fn peek(env: Env, vault: Address) {
        let _: i128 = env.invoke_contract(&vault, &Symbol::new(&env, "get_balance"), vec![&env]);
    }
}

/// The host refuses re-entry outright: a contract already on the call stack
/// cannot be called again, with `Error(Context, InvalidAction)`. So an
/// allowlisted callee cannot drive the vault a second time within one
/// execution, and the attempt takes the whole transaction down rather than
/// half-completing it.
///
/// This is a property of Soroban, not of our ordering — `execute` writes
/// `executed` before the call as well, but that is defence in depth. The test
/// is here so that if the guarantee ever weakens, something says so.
#[test]
fn test_callee_cannot_re_enter_the_vault() {
    let s = setup(1);
    let r = s.env.register(Reenterer, ());
    s.vault.allow_contract(&r);

    let args = vec![&s.env, s.vault_addr.into_val(&s.env), 0u64.into_val(&s.env)];
    let tx = s.vault.propose_call(&s.signer(0), &r, &symbol_short!("go"), &args, &Vec::new(&s.env), &false);
    s.vault.approve(&tx, &s.signer(0));

    assert!(s.vault.try_execute(&tx, &s.signer(0)).is_err(), "re-entry must not go through");
    assert!(!s.vault.get_proposal(&tx).executed, "and the failed execution rolls back whole");
}

/// Even a read-only call back is refused, which is what shows the protection is
/// the host's blanket rule rather than anything specific to `execute`.
#[test]
fn test_even_a_read_back_into_the_vault_is_refused() {
    let s = setup(1);
    let r = s.env.register(Reenterer, ());
    s.vault.allow_contract(&r);

    let args = vec![&s.env, s.vault_addr.into_val(&s.env)];
    let tx = s.vault.propose_call(&s.signer(0), &r, &symbol_short!("peek"), &args, &Vec::new(&s.env), &false);
    s.vault.approve(&tx, &s.signer(0));

    assert!(s.vault.try_execute(&tx, &s.signer(0)).is_err());
}

/* ================= ownership ================= */

#[test]
fn test_transfer_ownership_moves_the_role() {
    let s = setup(1);
    let next = Address::generate(&s.env);
    s.vault.transfer_ownership(&next);

    assert_eq!(s.vault.get_config().owner, next);
}

#[test]
fn test_transfer_ownership_rejects_the_current_owner() {
    let s = setup(1);
    assert_eq!(
        s.vault.try_transfer_ownership(&s.owner),
        Err(Ok(Error::SameOwner)),
        "handing the role to whoever already holds it is a no-op worth catching"
    );
}

/// The point of the role moving is that it actually moves: the new owner can
/// use it, and the vault still has exactly one.
#[test]
fn test_new_owner_can_administer() {
    let s = setup(1);
    let next = Address::generate(&s.env);
    s.vault.transfer_ownership(&next);

    let target = Address::generate(&s.env);
    s.vault.allow_recipient(&target);
    assert_eq!(s.vault.get_allowed().len(), 1);
    assert_eq!(s.vault.get_config().owner, next, "and it did not drift back");
}
