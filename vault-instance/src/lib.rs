#![no_std]

//! Vault Instance — ONE multi-sig vault per deployed contract (Safe-style).
//!
//! Each instance has its own address and holds its OWN funds natively
//! (`token.balance(self)`), so per-vault balance is free and depositing is just
//! a plain transfer to this contract's address. Deployed by `vault-factory`.
//!
//! # Guards (Safe-style policy)
//!
//! An owner-configurable [`Policy`] is enforced on every execution:
//! per-transaction limit, rolling spending cap, time-lock and a recipient
//! allowlist. A vault with no policy set behaves exactly as before (all guards
//! disabled), so upgrading an existing vault never changes its behaviour until
//! the owner opts in.
//!
//! # Compatibility
//!
//! `Proposal` and `VaultInfo` are deliberately unchanged from v1: an upgraded
//! vault must still be able to read proposals written by the old code, and
//! adding a field to a stored struct would break that. New state (cancellation,
//! policy, batches) lives under its own keys.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    symbol_short, token::TokenClient, Address, Bytes, BytesN, Env, String, Symbol, U256, Vec,
};

const OWNER: Symbol = symbol_short!("owner");
const NAME: Symbol = symbol_short!("name");
const TOKEN: Symbol = symbol_short!("token");
const THRESH: Symbol = symbol_short!("thresh");
const SIGNERS: Symbol = symbol_short!("signers");
const NEXTTX: Symbol = symbol_short!("nexttx");
const POLICY: Symbol = symbol_short!("policy");
const ALLOWED: Symbol = symbol_short!("allowed");

/// Contract code version — lets the dashboard tell a guard-capable vault (2)
/// from a pre-guards one (1, which has no `version` entry point at all).
const VERSION: u32 = 2;

/// ~5s per ledger => one day. Used when `Policy.cap_window_ledgers` is 0.
const DEFAULT_CAP_WINDOW: u32 = 17_280;

const MAX_ALLOWED: u32 = 50;
const MAX_BATCH: u32 = 20;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    // --- construction ---
    NoSigners = 1,
    BadThreshold = 2,
    // --- authorization ---
    NotSigner = 3,
    NotProposer = 4,
    // --- proposal lifecycle ---
    ProposalNotFound = 5,
    AlreadyExecuted = 6,
    AlreadyCancelled = 7,
    AlreadyApproved = 8,
    InvalidAmount = 9,
    ThresholdNotMet = 10,
    InsufficientBalance = 11,
    // --- zk ---
    NullifierUsed = 12,
    EmptyProof = 13,
    // --- guards ---
    ExceedsMaxPerTx = 14,
    ExceedsSpendingCap = 15,
    TimelockActive = 16,
    RecipientNotAllowed = 17,
    AllowlistFull = 18,
    InvalidPolicy = 19,
    // --- signer management ---
    DuplicateSigner = 20,
    SignerNotFound = 21,
    // --- batch ---
    EmptyBatch = 22,
    BatchTooLarge = 23,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Proposal(u64),
    Approval(u64, Address),
    Nullifier(U256),
    /// Set when a proposal is cancelled. Kept out of `Proposal` for v1 compat.
    Cancelled(u64),
    /// Items of a batch (multi-call) proposal.
    Batch(u64),
    /// Amount executed within a rolling cap window, keyed by window index.
    Spent(u32),
}

/// Owner-configurable spending guards. All-zero / false = unrestricted, which
/// is the default for a vault that has never called `set_policy`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Policy {
    /// Max total amount of a single execution. 0 = unlimited.
    pub max_per_tx: i128,
    /// Max total executed within one rolling window. 0 = unlimited.
    pub spending_cap: i128,
    /// Length of the cap window in ledgers. 0 = one day (17280).
    pub cap_window_ledgers: u32,
    /// Ledgers that must pass between propose and execute. 0 = no delay.
    pub timelock_ledgers: u32,
    /// When true, funds may only go to allowlisted recipients.
    pub allowlist_only: bool,
}

/// Everything the UI needs to render a proposal's guard state in one read.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalStatus {
    pub cancelled: bool,
    pub executed: bool,
    pub approval_count: u32,
    pub threshold: u32,
    /// Ledger at which the time-lock expires (== created_at when no time-lock).
    pub unlock_ledger: u32,
    pub current_ledger: u32,
    pub is_batch: bool,
    /// Total amount the proposal moves.
    pub amount: i128,
}

/// One transfer inside a batch (multi-call) proposal.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchItem {
    pub target: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct VaultInfo {
    pub owner: Address,
    pub name: String,
    pub threshold: u32,
    pub signer_count: u32,
    pub signers: Vec<Address>,
}

#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    pub id: u64,
    pub target: Address,
    pub amount: i128,
    pub proposer: Address,
    pub private_mode: bool,
    pub approval_count: u32,
    pub executed: bool,
    pub created_at: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct ZKApproval {
    pub proof: Bytes,
    pub public_inputs: Vec<BytesN<32>>,
    pub nullifier: U256,
}

#[contractevent]
#[derive(Clone)]
pub struct ProposedEvent {
    #[topic] pub tx_id: u64,
    pub proposer: Address,
    pub target: Address,
    pub amount: i128,
    pub private_mode: bool,
}

#[contractevent]
#[derive(Clone)]
pub struct ApprovedEvent {
    #[topic] pub tx_id: u64,
    pub signer: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct ZKApprovedEvent {
    #[topic] pub tx_id: u64,
    pub nullifier: U256,
}

#[contractevent]
#[derive(Clone)]
pub struct ExecutedEvent {
    #[topic] pub tx_id: u64,
    pub executed_by: Address,
    pub private_mode: bool,
}

#[contractevent]
#[derive(Clone)]
pub struct CancelledEvent {
    #[topic] pub tx_id: u64,
    pub cancelled_by: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct PolicyUpdatedEvent {
    #[topic] pub by: Address,
    pub policy: Policy,
}

#[contractevent]
#[derive(Clone)]
pub struct AllowlistChangedEvent {
    #[topic] pub target: Address,
    pub allowed: bool,
}

#[contract]
pub struct VaultInstance;

#[contractimpl]
impl VaultInstance {
    /// Constructor — runs once at deploy, with args supplied by the factory.
    pub fn __constructor(
        env: Env,
        owner: Address,
        name: String,
        token: Address,
        signers: Vec<Address>,
        threshold: u32,
    ) {
        let signer_count = signers.len() as u32;
        if signer_count == 0 {
            panic_with_error!(&env, Error::NoSigners);
        }
        if threshold == 0 || threshold > signer_count {
            panic_with_error!(&env, Error::BadThreshold);
        }
        let s = env.storage().instance();
        s.set(&OWNER, &owner);
        s.set(&NAME, &name);
        s.set(&TOKEN, &token);
        s.set(&SIGNERS, &signers);
        s.set(&THRESH, &threshold);
        s.set(&NEXTTX, &0u64);
    }

    // ---------------- transactions ----------------

    /// Propose a single transfer. Guards that can be judged up-front (amount,
    /// per-tx limit, allowlist) fail here so a doomed proposal is never created.
    pub fn propose(
        env: Env,
        proposer: Address,
        target: Address,
        amount: i128,
        private_mode: bool,
    ) -> Result<u64, Error> {
        proposer.require_auth();
        Self::require_signer(&env, &proposer)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let policy = Self::policy_of(&env);
        Self::check_limit(&policy, amount)?;
        Self::check_recipient(&env, &policy, &target)?;

        Ok(Self::store_proposal(&env, proposer, target, amount, private_mode))
    }

    /// Propose a batch (multi-call) — N transfers approved and executed as one
    /// atomic unit. This is what native multi-sig structurally cannot do.
    pub fn propose_batch(
        env: Env,
        proposer: Address,
        items: Vec<BatchItem>,
        private_mode: bool,
    ) -> Result<u64, Error> {
        proposer.require_auth();
        Self::require_signer(&env, &proposer)?;

        let count = items.len() as u32;
        if count == 0 {
            return Err(Error::EmptyBatch);
        }
        if count > MAX_BATCH {
            return Err(Error::BatchTooLarge);
        }

        let policy = Self::policy_of(&env);
        let mut total: i128 = 0;
        for item in items.iter() {
            if item.amount <= 0 {
                return Err(Error::InvalidAmount);
            }
            Self::check_recipient(&env, &policy, &item.target)?;
            total = item.amount.checked_add(total).ok_or(Error::InvalidAmount)?;
        }
        // the per-tx limit applies to the batch total, otherwise splitting a
        // payment into items would trivially bypass it
        Self::check_limit(&policy, total)?;

        // `target` on the umbrella proposal is the vault itself — the real
        // recipients live in DataKey::Batch. `amount` is the total, so every
        // guard and balance check keeps working unchanged.
        let tx_id = Self::store_proposal(
            &env,
            proposer,
            env.current_contract_address(),
            total,
            private_mode,
        );
        env.storage().persistent().set(&DataKey::Batch(tx_id), &items);
        Ok(tx_id)
    }

    /// Transparent approval — identity visible.
    pub fn approve(env: Env, tx_id: u64, signer: Address) -> Result<(), Error> {
        signer.require_auth();
        Self::require_signer(&env, &signer)?;
        let mut p = Self::proposal(&env, tx_id)?;
        Self::require_open(&env, tx_id, &p)?;
        if env.storage().persistent().has(&DataKey::Approval(tx_id, signer.clone())) {
            return Err(Error::AlreadyApproved);
        }
        env.storage().persistent().set(&DataKey::Approval(tx_id, signer.clone()), &true);
        p.approval_count += 1;
        env.storage().persistent().set(&DataKey::Proposal(tx_id), &p);

        ApprovedEvent { tx_id, signer }.publish(&env);
        Ok(())
    }

    /// ZK approval — identity hidden (only the nullifier is recorded).
    pub fn approve_zk(env: Env, tx_id: u64, signer: Address, zk: ZKApproval) -> Result<(), Error> {
        signer.require_auth();
        Self::require_signer(&env, &signer)?;
        let mut p = Self::proposal(&env, tx_id)?;
        Self::require_open(&env, tx_id, &p)?;
        let nk = DataKey::Nullifier(zk.nullifier.clone());
        if env.storage().persistent().has(&nk) {
            return Err(Error::NullifierUsed); // double-vote
        }
        if zk.proof.len() == 0 {
            return Err(Error::EmptyProof);
        }
        env.storage().persistent().set(&nk, &true);
        p.approval_count += 1;
        env.storage().persistent().set(&DataKey::Proposal(tx_id), &p);

        ZKApprovedEvent { tx_id, nullifier: zk.nullifier }.publish(&env);
        Ok(())
    }

    /// Execute once threshold is reached — moves funds from this vault's own
    /// balance. Both modes transfer; in private mode the difference is only that
    /// approvals were ZK proofs (the chain never learns WHO approved).
    ///
    /// Every guard is re-checked here, not just at propose time: the owner may
    /// have tightened the policy while the proposal was collecting approvals.
    pub fn execute(env: Env, tx_id: u64, executor: Address) -> Result<(), Error> {
        executor.require_auth();
        let mut p = Self::proposal(&env, tx_id)?;
        Self::require_open(&env, tx_id, &p)?;

        let threshold: u32 = env.storage().instance().get(&THRESH).unwrap();
        if p.approval_count < threshold {
            return Err(Error::ThresholdNotMet);
        }

        let policy = Self::policy_of(&env);

        // time-lock: a proposal cannot execute before its cooling-off period
        if policy.timelock_ledgers > 0 {
            let unlock = p.created_at.saturating_add(policy.timelock_ledgers);
            if env.ledger().sequence() < unlock {
                return Err(Error::TimelockActive);
            }
        }

        Self::check_limit(&policy, p.amount)?;

        let token: Address = env.storage().instance().get(&TOKEN).unwrap();
        let client = TokenClient::new(&env, &token);
        let vault = env.current_contract_address();
        if client.balance(&vault) < p.amount {
            return Err(Error::InsufficientBalance);
        }

        let batch: Option<Vec<BatchItem>> =
            env.storage().persistent().get(&DataKey::Batch(tx_id));

        // recipients are re-validated before anything moves, so a partially
        // allowed batch reverts as a whole rather than paying out the prefix
        match &batch {
            Some(items) => {
                for item in items.iter() {
                    Self::check_recipient(&env, &policy, &item.target)?;
                }
            }
            None => Self::check_recipient(&env, &policy, &p.target)?,
        }

        // rolling spending cap — booked before transferring
        Self::charge_window(&env, &policy, p.amount)?;

        match batch {
            Some(items) => {
                for item in items.iter() {
                    client.transfer(&vault, &item.target, &item.amount);
                }
            }
            None => client.transfer(&vault, &p.target, &p.amount),
        }

        p.executed = true;
        env.storage().persistent().set(&DataKey::Proposal(tx_id), &p);

        ExecutedEvent { tx_id, executed_by: executor, private_mode: p.private_mode }.publish(&env);
        Ok(())
    }

    /// Cancel a pending proposal. The proposer or the owner may cancel.
    pub fn cancel(env: Env, tx_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        let p = Self::proposal(&env, tx_id)?;
        let owner: Address = env.storage().instance().get(&OWNER).unwrap();
        if p.proposer != caller && owner != caller {
            return Err(Error::NotProposer);
        }
        Self::require_open(&env, tx_id, &p)?;

        // recorded separately so `Proposal` stays byte-compatible with v1 — and
        // so a cancelled proposal is no longer indistinguishable from an
        // executed one, which is what v1 did.
        env.storage().persistent().set(&DataKey::Cancelled(tx_id), &true);

        CancelledEvent { tx_id, cancelled_by: caller }.publish(&env);
        Ok(())
    }

    // ---------------- guards (owner) ----------------

    /// Install or replace the spending policy. Zero fields disable that guard.
    pub fn set_policy(env: Env, policy: Policy) -> Result<(), Error> {
        let owner = Self::require_owner(&env);
        if policy.max_per_tx < 0 || policy.spending_cap < 0 {
            return Err(Error::InvalidPolicy);
        }
        env.storage().instance().set(&POLICY, &policy);
        PolicyUpdatedEvent { by: owner, policy }.publish(&env);
        Ok(())
    }

    pub fn allow_recipient(env: Env, target: Address) -> Result<(), Error> {
        Self::require_owner(&env);
        let mut list = Self::allowlist(&env);
        for a in list.iter() {
            if a == target {
                return Ok(()); // already allowed — idempotent
            }
        }
        if list.len() as u32 >= MAX_ALLOWED {
            return Err(Error::AllowlistFull);
        }
        list.push_back(target.clone());
        env.storage().instance().set(&ALLOWED, &list);
        AllowlistChangedEvent { target, allowed: true }.publish(&env);
        Ok(())
    }

    pub fn revoke_recipient(env: Env, target: Address) {
        Self::require_owner(&env);
        let list = Self::allowlist(&env);
        let mut next = Vec::new(&env);
        for a in list.iter() {
            if a != target {
                next.push_back(a);
            }
        }
        env.storage().instance().set(&ALLOWED, &next);
        AllowlistChangedEvent { target, allowed: false }.publish(&env);
    }

    // ---------------- admin (owner) ----------------

    pub fn add_signer(env: Env, new_signer: Address) -> Result<(), Error> {
        Self::require_owner(&env);
        let mut signers: Vec<Address> = env.storage().instance().get(&SIGNERS).unwrap();
        for s in signers.iter() {
            if s == new_signer {
                return Err(Error::DuplicateSigner);
            }
        }
        signers.push_back(new_signer);
        env.storage().instance().set(&SIGNERS, &signers);
        Ok(())
    }

    pub fn remove_signer(env: Env, signer: Address) -> Result<(), Error> {
        Self::require_owner(&env);
        let signers: Vec<Address> = env.storage().instance().get(&SIGNERS).unwrap();
        let mut next = Vec::new(&env);
        let mut found = false;
        for s in signers.iter() {
            if s == signer {
                found = true;
            } else {
                next.push_back(s);
            }
        }
        if !found {
            return Err(Error::SignerNotFound);
        }
        let threshold: u32 = env.storage().instance().get(&THRESH).unwrap();
        if threshold > next.len() as u32 {
            return Err(Error::BadThreshold);
        }
        env.storage().instance().set(&SIGNERS, &next);
        Ok(())
    }

    pub fn set_threshold(env: Env, new_threshold: u32) -> Result<(), Error> {
        Self::require_owner(&env);
        let signers: Vec<Address> = env.storage().instance().get(&SIGNERS).unwrap();
        if new_threshold == 0 || new_threshold > signers.len() as u32 {
            return Err(Error::BadThreshold);
        }
        env.storage().instance().set(&THRESH, &new_threshold);
        Ok(())
    }

    /// Owner-gated code upgrade. Without this an already-deployed vault would be
    /// frozen on the WASM it was born with — `factory.set_wasm` only affects
    /// vaults created after it.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        Self::require_owner(&env);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    // ---------------- queries ----------------

    pub fn get_config(env: Env) -> VaultInfo {
        let s = env.storage().instance();
        let signers: Vec<Address> = s.get(&SIGNERS).unwrap();
        VaultInfo {
            owner: s.get(&OWNER).unwrap(),
            name: s.get(&NAME).unwrap(),
            threshold: s.get(&THRESH).unwrap(),
            signer_count: signers.len() as u32,
            signers,
        }
    }

    pub fn get_proposal(env: Env, tx_id: u64) -> Result<Proposal, Error> {
        Self::proposal(&env, tx_id)
    }

    /// One read with everything the UI needs to decide whether "Execute" is
    /// clickable and, if not, why.
    pub fn get_status(env: Env, tx_id: u64) -> Result<ProposalStatus, Error> {
        let p = Self::proposal(&env, tx_id)?;
        let policy = Self::policy_of(&env);
        Ok(ProposalStatus {
            cancelled: Self::is_cancelled(env.clone(), tx_id),
            executed: p.executed,
            approval_count: p.approval_count,
            threshold: env.storage().instance().get(&THRESH).unwrap(),
            unlock_ledger: p.created_at.saturating_add(policy.timelock_ledgers),
            current_ledger: env.ledger().sequence(),
            is_batch: env.storage().persistent().has(&DataKey::Batch(tx_id)),
            amount: p.amount,
        })
    }

    pub fn get_batch(env: Env, tx_id: u64) -> Vec<BatchItem> {
        env.storage()
            .persistent()
            .get(&DataKey::Batch(tx_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn is_cancelled(env: Env, tx_id: u64) -> bool {
        env.storage().persistent().get(&DataKey::Cancelled(tx_id)).unwrap_or(false)
    }

    pub fn get_policy(env: Env) -> Policy {
        Self::policy_of(&env)
    }

    pub fn get_allowed(env: Env) -> Vec<Address> {
        Self::allowlist(&env)
    }

    /// Amount already executed in the current cap window.
    pub fn spent_in_window(env: Env) -> i128 {
        let policy = Self::policy_of(&env);
        let w = Self::window_index(&env, &policy);
        env.storage().persistent().get(&DataKey::Spent(w)).unwrap_or(0)
    }

    pub fn is_signer(env: Env, signer: Address) -> bool {
        Self::is_signer_internal(&env, &signer)
    }

    /// This vault's own balance (native — like a Safe).
    pub fn get_balance(env: Env) -> i128 {
        let token: Address = env.storage().instance().get(&TOKEN).unwrap();
        TokenClient::new(&env, &token).balance(&env.current_contract_address())
    }

    pub fn version(_env: Env) -> u32 {
        VERSION
    }

    // ---------------- helpers ----------------

    fn proposal(env: &Env, tx_id: u64) -> Result<Proposal, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Proposal(tx_id))
            .ok_or(Error::ProposalNotFound)
    }

    /// A proposal may still be acted on: neither executed nor cancelled.
    fn require_open(env: &Env, tx_id: u64, p: &Proposal) -> Result<(), Error> {
        if p.executed {
            return Err(Error::AlreadyExecuted);
        }
        if env.storage().persistent().get(&DataKey::Cancelled(tx_id)).unwrap_or(false) {
            return Err(Error::AlreadyCancelled);
        }
        Ok(())
    }

    fn store_proposal(
        env: &Env,
        proposer: Address,
        target: Address,
        amount: i128,
        private_mode: bool,
    ) -> u64 {
        let tx_id: u64 = env.storage().instance().get(&NEXTTX).unwrap_or(0);
        let p = Proposal {
            id: tx_id,
            target: target.clone(),
            amount,
            proposer: proposer.clone(),
            private_mode,
            approval_count: 0,
            executed: false,
            created_at: env.ledger().sequence(),
        };
        env.storage().persistent().set(&DataKey::Proposal(tx_id), &p);
        env.storage().instance().set(&NEXTTX, &(tx_id + 1));

        ProposedEvent { tx_id, proposer, target, amount, private_mode }.publish(env);
        tx_id
    }

    fn require_owner(env: &Env) -> Address {
        let owner: Address = env.storage().instance().get(&OWNER).unwrap();
        owner.require_auth();
        owner
    }

    fn require_signer(env: &Env, who: &Address) -> Result<(), Error> {
        if Self::is_signer_internal(env, who) {
            Ok(())
        } else {
            Err(Error::NotSigner)
        }
    }

    fn is_signer_internal(env: &Env, signer: &Address) -> bool {
        let signers: Vec<Address> = env.storage().instance().get(&SIGNERS).unwrap();
        for s in signers.iter() {
            if &s == signer {
                return true;
            }
        }
        false
    }

    /// The stored policy, or a fully-permissive default. A vault that predates
    /// guards therefore keeps behaving exactly as it did before the upgrade.
    fn policy_of(env: &Env) -> Policy {
        env.storage().instance().get(&POLICY).unwrap_or(Policy {
            max_per_tx: 0,
            spending_cap: 0,
            cap_window_ledgers: 0,
            timelock_ledgers: 0,
            allowlist_only: false,
        })
    }

    fn allowlist(env: &Env) -> Vec<Address> {
        env.storage().instance().get(&ALLOWED).unwrap_or_else(|| Vec::new(env))
    }

    fn check_limit(policy: &Policy, amount: i128) -> Result<(), Error> {
        if policy.max_per_tx > 0 && amount > policy.max_per_tx {
            return Err(Error::ExceedsMaxPerTx);
        }
        Ok(())
    }

    fn check_recipient(env: &Env, policy: &Policy, target: &Address) -> Result<(), Error> {
        if !policy.allowlist_only {
            return Ok(());
        }
        for a in Self::allowlist(env).iter() {
            if &a == target {
                return Ok(());
            }
        }
        Err(Error::RecipientNotAllowed)
    }

    fn window_index(env: &Env, policy: &Policy) -> u32 {
        let len = if policy.cap_window_ledgers == 0 {
            DEFAULT_CAP_WINDOW
        } else {
            policy.cap_window_ledgers
        };
        env.ledger().sequence() / len
    }

    /// Book `amount` against the current window, rejecting if it breaks the cap.
    fn charge_window(env: &Env, policy: &Policy, amount: i128) -> Result<(), Error> {
        if policy.spending_cap == 0 {
            return Ok(());
        }
        let w = Self::window_index(env, policy);
        let key = DataKey::Spent(w);
        let spent: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        let next = spent.checked_add(amount).ok_or(Error::ExceedsSpendingCap)?;
        if next > policy.spending_cap {
            return Err(Error::ExceedsSpendingCap);
        }
        env.storage().persistent().set(&key, &next);
        Ok(())
    }
}

#[cfg(test)]
mod test;
