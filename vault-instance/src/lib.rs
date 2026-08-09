#![no_std]

//! Vault Instance — ONE multi-sig vault per deployed contract (Safe-style).
//!
//! Each instance has its own address and holds its OWN funds natively
//! (`token.balance(self)`), so per-vault balance is free and depositing is just
//! a plain transfer to this contract's address. Deployed by `vault-factory`.
//!
//! # Governance
//!
//! Every rule the vault runs on — threshold, signer set, policy, allowlists,
//! verifier config, ownership, and the contract's own code — changes only
//! through [`AdminAction`], proposed and approved like any payment. There is no
//! owner-only entry point to any of it, so the vault is m-of-n for changing the
//! rules as well as for spending under them.
//!
//! # Guards (Safe-style policy)
//!
//! A [`Policy`] is enforced on every execution:
//! per-transaction limit, rolling spending cap, time-lock and a recipient
//! allowlist. A vault with no policy set behaves exactly as before (all guards
//! disabled), so upgrading an existing vault never changes its behaviour until
//! the signers opt in.
//!
//! # Compatibility
//!
//! `Proposal` and `VaultInfo` are deliberately unchanged from v1: an upgraded
//! vault must still be able to read proposals written by the old code, and
//! adding a field to a stored struct would break that. New state (cancellation,
//! policy, batches) lives under its own keys.

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    symbol_short, token::TokenClient, Address, Bytes, BytesN, Env, IntoVal, String, Symbol, U256, Val, Vec,
};

const OWNER: Symbol = symbol_short!("owner");
const NAME: Symbol = symbol_short!("name");
const TOKEN: Symbol = symbol_short!("token");
const THRESH: Symbol = symbol_short!("thresh");
const SIGNERS: Symbol = symbol_short!("signers");
const NEXTTX: Symbol = symbol_short!("nexttx");
const POLICY: Symbol = symbol_short!("policy");
const ALLOWED: Symbol = symbol_short!("allowed");
/// Contracts that proposals are permitted to call. Empty = no calls at all.
const CALLOWED: Symbol = symbol_short!("callowed");
/// Holds the whole [`ZkConfig`]; absent means this vault does not verify proofs.
const VERIFIER: Symbol = symbol_short!("verifier");
/// Shuffled signer commitments — the Merkle leaves a prover needs.
const COMMITS: Symbol = symbol_short!("commits");
/// Proposals below this id were made under a signer set that no longer exists.
///
/// A watermark rather than a per-proposal stamp: when the signer set changes,
/// every proposal that exists is retired and every later one is not, so the
/// boundary is a single id. Nothing is written per proposal, nothing is read
/// per proposal, and the UI learns which are dead from one number.
const RETIRED: Symbol = symbol_short!("retired");

/// Contract code version, so the dashboard can tell what a vault can do:
///   1 — pre-guards (no `version` entry point at all)
///   2 — guards, batch, cancellation, typed errors
///   3 — on-chain proof verification + arbitrary contract calls
///   4 — signature-derived signer keys + anonymous (unauthenticated) approval
///   5 — governance by proposal: no owner-only path to any rule change
///   6 — the final approval can settle the proposal in the same transaction
///   7 — a signer-set change retires the proposals it would have decided
///   8 — retired proposals are visible as such, and any signer can clear them
const VERSION: u32 = 8;

/// ~5s per ledger => one day. Used when `Policy.cap_window_ledgers` is 0.
const DEFAULT_CAP_WINDOW: u32 = 17_280;

/// Storage lifetime, in ledgers. A treasury is idle by nature — months can pass
/// between transactions — and an entry whose TTL runs out is archived, taking
/// the vault offline until somebody restores it. Every write bumps the clock:
/// ~30 days of headroom, renewed whenever the TTL drops below ~10 days.
const TTL_LOW: u32 = 172_800;
const TTL_EXTEND: u32 = 518_400;

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
    // --- on-chain zk verification ---
    /// The Groth16 verifier rejected the proof.
    ProofRejected = 24,
    /// A public input did not match what this vault expects for this proposal.
    PublicInputMismatch = 25,
    /// The proof blob was not 256 bytes of `a || b || c`.
    BadProofEncoding = 26,
    // --- arbitrary contract calls ---
    /// The target contract is not on the vault's call allowlist.
    ContractNotAllowed = 27,
    /// A proposal tried to make the vault call itself.
    SelfCallForbidden = 28,
    /// The call allowlist is full.
    CallAllowlistFull = 29,
    /// Anonymous approval needs on-chain verification switched on first.
    VerificationNotEnabled = 30,
    // --- ownership ---
    /// `transfer_ownership` was called with the address that already owns it.
    SameOwner = 31,
    // --- signer set changes ---
    /// The signer set changed after this proposal was made, so the approvals it
    /// holds were given by a different group. It has to be proposed again.
    SignerSetChanged = 32,
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
    /// The contract call a proposal performs, when it is a call rather than a
    /// transfer.
    Call(u64),
    /// Sub-invocations the vault pre-authorises for a call proposal.
    CallAuth(u64),
    /// The configuration change a proposal applies, when it is an admin action.
    Admin(u64),
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

/// A change to the vault's own configuration, made by proposal.
///
/// Everything here used to be a direct owner call, which made the vault m-of-n
/// for spending and 1-of-1 for governance: one key could lower the threshold to
/// one, or swap the contract's code, and every guard sat behind it. These go
/// through propose -> approve -> execute like any payment, so changing the rules
/// costs the same threshold as spending under them.
///
/// Safe does this by having the multi-sig call *itself*. Soroban forbids that —
/// a contract already on the call stack cannot be re-entered, even for a read —
/// so the action is data the vault applies to itself internally instead.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AdminAction {
    SetThreshold(u32),
    AddSigner(Address),
    RemoveSigner(Address),
    SetPolicy(Policy),
    AllowRecipient(Address),
    RevokeRecipient(Address),
    AllowContract(Address),
    RevokeContract(Address),
    SetZkConfig(ZkConfig),
    SetSignerCommitments(Vec<U256>),
    TransferOwnership(Address),
    /// Replaces the contract's code. The heaviest of these by far — it can
    /// redefine every other rule — so it is only reachable this way.
    Upgrade(BytesN<32>),
}

/// One transfer inside a batch (multi-call) proposal.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchItem {
    pub target: Address,
    pub amount: i128,
}

/// A call the vault makes to another contract once a proposal passes.
///
/// This is what turns the vault from a shared wallet into a smart account: it
/// can swap on a DEX, supply to a lending market, or move an asset other than
/// the one it was created with — anything a plain account could do.
#[contracttype]
#[derive(Clone)]
pub struct CallSpec {
    pub contract: Address,
    pub function: Symbol,
    pub args: Vec<Val>,
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
    /// 256 bytes: `a (64) || b (128) || c (64)`, in the BN254 host's layout.
    pub proof: Bytes,
    /// `[vaultId, txId, signerRoot, nullifier]`, each a 32-byte big-endian
    /// field element.
    pub public_inputs: Vec<BytesN<32>>,
    pub nullifier: U256,
}

/// A Groth16 proof, shaped to match `groth16-verifier`'s `Proof`. Field names
/// are what the cross-contract call matches on, so they must stay in sync.
#[contracttype]
#[derive(Clone)]
pub struct Groth16Proof {
    pub a: BytesN<64>,
    pub b: BytesN<128>,
    pub c: BytesN<64>,
}

/// What a vault must know before it can check a proof itself.
///
/// `vault_id` and `signer_root` are the two public inputs the vault pins down;
/// without them a valid proof for *some* vault would count as a valid proof for
/// *this* one.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ZkConfig {
    pub verifier: Address,
    pub vault_id: U256,
    pub signer_root: U256,
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

/// The signer set changed; every proposal made before this is retired.
#[contractevent]
#[derive(Clone)]
pub struct SignerSetChangedEvent {
    #[topic] pub retired_below: u64,
}

#[contractevent]
#[derive(Clone)]
pub struct AdminExecutedEvent {
    #[topic] pub tx_id: u64,
    #[topic] pub executed_by: Address,
    pub action: AdminAction,
}

#[contractevent]
#[derive(Clone)]
pub struct OwnershipTransferredEvent {
    #[topic] pub from: Address,
    #[topic] pub to: Address,
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

#[contractevent]
#[derive(Clone)]
pub struct CallTargetChangedEvent {
    #[topic] pub contract: Address,
    pub allowed: bool,
}

#[contractevent]
#[derive(Clone)]
pub struct CallExecutedEvent {
    #[topic] pub tx_id: u64,
    pub contract: Address,
    pub function: Symbol,
    pub executed_by: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct ZkConfigSetEvent {
    #[topic] pub by: Address,
    pub config: ZkConfig,
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

    /// Propose a call to another contract — a swap, a supply, a transfer of an
    /// asset this vault wasn't created with. The vault executes it as itself,
    /// so it acts with its own authority and its own balances.
    ///
    /// Unlike transfers, calls are allowlist-only: the target must have been
    /// approved by the owner via [`allow_contract`]. A vault with an empty call
    /// allowlist cannot make calls at all, which is the safe default.
    /// `auth` lists calls the *callee* will make back out as this vault, which
    /// the vault must pre-authorise.
    ///
    /// A contract's own authority covers only what it invokes directly. Calling
    /// a token's `deposit`, which in turn calls the underlying asset's
    /// `transfer(from = vault, ...)`, puts that transfer one level too deep —
    /// the host rejects it with `Error(Auth, InvalidAction)` no matter how the
    /// proposal was approved. Naming those sub-calls here is the only way to
    /// express "yes, the thing I am calling may move my funds to do it".
    ///
    /// Each named contract must itself be on the call allowlist: authorising a
    /// sub-call is a strictly larger permission than making one, so it cannot
    /// be the looser of the two.
    pub fn propose_call(
        env: Env,
        proposer: Address,
        contract: Address,
        function: Symbol,
        args: Vec<Val>,
        auth: Vec<CallSpec>,
        private_mode: bool,
    ) -> Result<u64, Error> {
        proposer.require_auth();
        Self::require_signer(&env, &proposer)?;
        Self::check_call_target(&env, &contract)?;
        for a in auth.iter() {
            Self::check_call_target(&env, &a.contract)?;
        }

        // amount 0: a call carries no transfer of its own. Whatever it moves,
        // it moves through the callee under this vault's authority.
        let tx_id = Self::store_proposal(&env, proposer, contract.clone(), 0, private_mode);
        env.storage()
            .persistent()
            .set(&DataKey::Call(tx_id), &CallSpec { contract, function, args });
        if auth.len() > 0 {
            env.storage().persistent().set(&DataKey::CallAuth(tx_id), &auth);
        }
        Ok(tx_id)
    }

    /// Transparent approval — identity visible.
    /// Propose a change to the vault's own rules.
    ///
    /// Same lifecycle as a payment — any signer proposes, the threshold
    /// approves, anyone executes — and the time-lock applies, so a signer set
    /// or a code swap cannot land the instant it reaches the threshold. The
    /// amount guards do not: an admin action moves nothing.
    pub fn propose_admin(env: Env, proposer: Address, action: AdminAction) -> Result<u64, Error> {
        proposer.require_auth();
        Self::require_signer(&env, &proposer)?;
        // Rejected here as well as at execution, so a proposal that could never
        // land does not sit in the list collecting approvals.
        Self::check_admin(&env, &action)?;

        // target = the vault itself. `Proposal` has no room for a third shape
        // without breaking v1 byte compatibility, so the action lives under its
        // own key and the proposal records a zero-amount transfer to self.
        let tx_id = Self::store_proposal(&env, proposer, env.current_contract_address(), 0, false);
        env.storage().persistent().set(&DataKey::Admin(tx_id), &action);
        Self::bump_key(&env, &DataKey::Admin(tx_id));
        Ok(tx_id)
    }

    /// The configuration change a proposal applies, if it is an admin action.
    pub fn get_admin(env: Env, tx_id: u64) -> Option<AdminAction> {
        env.storage().persistent().get(&DataKey::Admin(tx_id))
    }

    pub fn approve(env: Env, tx_id: u64, signer: Address) -> Result<(), Error> {
        Self::bump(&env);
        signer.require_auth();
        Self::require_signer(&env, &signer)?;
        let mut p = Self::proposal(&env, tx_id)?;
        Self::require_open(&env, tx_id, &p)?;
        Self::require_current_set(&env, tx_id)?;
        if env.storage().persistent().has(&DataKey::Approval(tx_id, signer.clone())) {
            return Err(Error::AlreadyApproved);
        }
        env.storage().persistent().set(&DataKey::Approval(tx_id, signer.clone()), &true);
        p.approval_count += 1;
        env.storage().persistent().set(&DataKey::Proposal(tx_id), &p);
        Self::bump_key(&env, &DataKey::Proposal(tx_id));

        ApprovedEvent { tx_id, signer }.publish(&env);
        Ok(())
    }

    /// ZK approval — identity hidden (only the nullifier is recorded).
    ///
    /// Once [`set_zk_config`] has been called, the proof is verified on-chain
    /// and its public inputs are pinned to this vault and this proposal. Before
    /// that, the vault only records the nullifier — see [`set_zk_config`] for
    /// why that weaker mode still exists.
    /// Approve, and settle it in the same transaction if that was the last
    /// approval needed.
    ///
    /// A contract cannot act on its own — there is no scheduler, and every state
    /// change needs a transaction somebody signs and pays for — so a proposal
    /// that has reached its threshold still has to be pushed. Making the final
    /// approver push it is one signature instead of two, and removes the state
    /// where a proposal is fully approved and simply sitting there.
    ///
    /// If it is not ready — threshold not met yet, or the time-lock has not
    /// expired — this records the approval and stops. That is the whole point of
    /// the check: executing here on a proposal that cannot execute would fail
    /// the transaction and roll the approval back with it.
    pub fn approve_and_execute(env: Env, tx_id: u64, signer: Address) -> Result<(), Error> {
        Self::approve(env.clone(), tx_id, signer.clone())?;

        let p = Self::proposal(&env, tx_id)?;
        let threshold: u32 = env.storage().instance().get(&THRESH).unwrap();
        if p.approval_count < threshold {
            return Ok(());
        }
        let policy = Self::policy_of(&env);
        if policy.timelock_ledgers > 0
            && env.ledger().sequence() < p.created_at.saturating_add(policy.timelock_ledgers)
        {
            return Ok(());
        }
        Self::run(env, tx_id, signer)
    }

    pub fn approve_zk(env: Env, tx_id: u64, signer: Address, zk: ZKApproval) -> Result<(), Error> {
        Self::bump(&env);
        signer.require_auth();
        Self::require_signer(&env, &signer)?;
        let mut p = Self::proposal(&env, tx_id)?;
        Self::require_open(&env, tx_id, &p)?;
        Self::require_current_set(&env, tx_id)?;
        let nk = DataKey::Nullifier(zk.nullifier.clone());
        if env.storage().persistent().has(&nk) {
            return Err(Error::NullifierUsed); // double-vote
        }
        if zk.proof.len() == 0 {
            return Err(Error::EmptyProof);
        }
        Self::check_proof(&env, tx_id, &zk)?;
        env.storage().persistent().set(&nk, &true);
        Self::bump_key(&env, &nk);
        p.approval_count += 1;
        env.storage().persistent().set(&DataKey::Proposal(tx_id), &p);
        Self::bump_key(&env, &DataKey::Proposal(tx_id));

        ZKApprovedEvent { tx_id, nullifier: zk.nullifier }.publish(&env);
        Ok(())
    }

    /// Approve anonymously: the proof is the authorization, so no wallet needs
    /// to identify itself and anyone at all can submit.
    ///
    /// [`approve_zk`] hides the approver in the *event* while the transaction
    /// still names them — it calls `require_auth` on the signer, so the
    /// envelope and the argument both give it away. Anyone can read a vault's
    /// events, take the transaction hash, and ask the network who sent it. The
    /// proof was doing real work and the plumbing around it was undoing that.
    ///
    /// Once proofs are verified on-chain that identification is redundant: a
    /// valid proof already establishes membership in the published signer set,
    /// binds itself to this proposal, and burns a nullifier so it counts once.
    /// A wallet signature adds nothing except the name.
    ///
    /// This is refused unless verification is enabled — without it the proof is
    /// not checked, and dropping the auth as well would let anyone approve.
    pub fn approve_zk_anon(env: Env, tx_id: u64, zk: ZKApproval) -> Result<(), Error> {
        Self::bump(&env);
        if Self::get_zk_config(env.clone()).is_none() {
            return Err(Error::VerificationNotEnabled);
        }
        let mut p = Self::proposal(&env, tx_id)?;
        Self::require_open(&env, tx_id, &p)?;
        Self::require_current_set(&env, tx_id)?;

        let nk = DataKey::Nullifier(zk.nullifier.clone());
        if env.storage().persistent().has(&nk) {
            return Err(Error::NullifierUsed);
        }
        if zk.proof.len() == 0 {
            return Err(Error::EmptyProof);
        }
        Self::check_proof(&env, tx_id, &zk)?;

        env.storage().persistent().set(&nk, &true);
        Self::bump_key(&env, &nk);
        p.approval_count += 1;
        env.storage().persistent().set(&DataKey::Proposal(tx_id), &p);
        Self::bump_key(&env, &DataKey::Proposal(tx_id));

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
        Self::run(env, tx_id, executor)
    }

    /// `execute` without the authorisation check, so `approve_and_execute` can
    /// reach it. The host refuses a second `require_auth` for an address already
    /// authorised in this frame — and the approval that precedes this one has
    /// already made exactly that check against the same address.
    fn run(env: Env, tx_id: u64, executor: Address) -> Result<(), Error> {
        Self::bump(&env);
        let mut p = Self::proposal(&env, tx_id)?;
        Self::require_open(&env, tx_id, &p)?;
        Self::require_current_set(&env, tx_id)?;

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

        // An admin action moves nothing, so the amount guards and the recipient
        // allowlist have nothing to bite on — the time-lock above already
        // applied, which is the one that matters for a rule change.
        if let Some(action) = env.storage().persistent().get::<_, AdminAction>(&DataKey::Admin(tx_id)) {
            p.executed = true;
            env.storage().persistent().set(&DataKey::Proposal(tx_id), &p);
            Self::apply_admin(&env, &action)?;
            AdminExecutedEvent { tx_id, action, executed_by: executor }.publish(&env);
            return Ok(());
        }

        // A contract call moves no amount of its own, so the amount-based
        // guards have nothing to bite on. Its guard is the call allowlist,
        // re-checked here in case the owner revoked the target meanwhile.
        if let Some(spec) = env.storage().persistent().get::<_, CallSpec>(&DataKey::Call(tx_id)) {
            Self::check_call_target(&env, &spec.contract)?;

            // Re-checked here as well: the owner may have revoked a sub-call
            // target while this sat waiting for approvals.
            let auth: Vec<CallSpec> = env
                .storage()
                .persistent()
                .get(&DataKey::CallAuth(tx_id))
                .unwrap_or_else(|| Vec::new(&env));
            if auth.len() > 0 {
                let mut entries = Vec::new(&env);
                for a in auth.iter() {
                    Self::check_call_target(&env, &a.contract)?;
                    entries.push_back(InvokerContractAuthEntry::Contract(SubContractInvocation {
                        context: ContractContext {
                            contract: a.contract,
                            fn_name: a.function,
                            args: a.args,
                        },
                        sub_invocations: Vec::new(&env),
                    }));
                }
                env.authorize_as_current_contract(entries);
            }

            // Marked spent BEFORE the call, following checks-effects-
            // interactions. Soroban already forbids re-entry outright — a
            // contract on the call stack cannot be called again, even for a
            // read — so this ordering is not what stops a hostile callee, and
            // the tests say so. It costs nothing and removes the need to rely
            // on that guarantee holding for every future shape of this branch.
            p.executed = true;
            env.storage().persistent().set(&DataKey::Proposal(tx_id), &p);

            env.invoke_contract::<Val>(&spec.contract, &spec.function, spec.args.clone());

            CallExecutedEvent {
                tx_id,
                contract: spec.contract,
                function: spec.function,
                executed_by: executor,
            }
            .publish(&env);
            return Ok(());
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

        // Same ordering as the call branch, for the same reason.
        p.executed = true;
        env.storage().persistent().set(&DataKey::Proposal(tx_id), &p);

        match batch {
            Some(items) => {
                for item in items.iter() {
                    client.transfer(&vault, &item.target, &item.amount);
                }
            }
            None => client.transfer(&vault, &p.target, &p.amount),
        }

        ExecutedEvent { tx_id, executed_by: executor, private_mode: p.private_mode }.publish(&env);
        Ok(())
    }

    /// Cancel a pending proposal. The proposer or the owner may cancel.
    pub fn cancel(env: Env, tx_id: u64, caller: Address) -> Result<(), Error> {
        Self::bump(&env);
        caller.require_auth();
        let p = Self::proposal(&env, tx_id)?;
        // Proposer only, for a live proposal. The owner used to be able to
        // cancel anything, which meant one key could veto every proposal —
        // including the admin action that would take that key's powers away.
        // Signers who disagree withhold approval; nobody kills it outright.
        //
        // A RETIRED proposal is different: it cannot execute whatever anyone
        // does, so clearing it is tidying, not vetoing. Any current signer may,
        // because the proposer is often the person who was just removed — and
        // otherwise it sits in the pending list forever with nobody able to
        // touch it.
        if p.proposer != caller {
            if tx_id >= Self::retired_below(&env) {
                return Err(Error::NotProposer);
            }
            Self::require_signer(&env, &caller)?;
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
    pub fn get_allowed_contracts(env: Env) -> Vec<Address> {
        Self::call_allowlist(&env)
    }

    /// The call a proposal will make, if it is a call rather than a transfer.
    pub fn get_call(env: Env, tx_id: u64) -> Option<CallSpec> {
        env.storage().persistent().get(&DataKey::Call(tx_id))
    }

    /// The verifier and pinned public inputs, or `None` if this vault does not
    /// verify proofs on-chain.
    pub fn get_zk_config(env: Env) -> Option<ZkConfig> {
        env.storage().instance().get(&VERIFIER)
    }

    /// The signer commitments the Merkle tree is built from.
    ///
    /// A prover needs every leaf to build its membership path, so this list is
    /// necessarily public. What must NOT be public is which leaf belongs to
    /// whom: given that mapping, anyone could compute `Poseidon(leaf, txId)`
    /// for each signer and match it against the nullifier an approval
    /// published — recovering the approver in as many guesses as there are
    /// signers. They are published **shuffled**, in an order unrelated to the
    /// signer list: each signer recognises their own, nobody attributes the rest.
    pub fn get_signer_commitments(env: Env) -> Vec<U256> {
        env.storage().instance().get(&COMMITS).unwrap_or_else(|| Vec::new(&env))
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

    /// Proposals with an id below this were retired by a signer-set change.
    ///
    /// One number for the whole vault, so the list can mark them without a call
    /// per proposal. They are not pending and never will be — showing them as
    /// pending forever is what made this worth exposing.
    pub fn retired_before(env: Env) -> u64 {
        Self::retired_below(&env)
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
    /// Retire every proposal made under the outgoing signer set.
    ///
    /// One number, not a sweep: the proposals are not touched, they simply fall
    /// below the line. A vault with a thousand proposals costs the same as one
    /// with three, and the proposal that made this change is itself retired —
    /// which is correct, since it has already been applied.
    fn retired_below(env: &Env) -> u64 {
        env.storage().instance().get(&RETIRED).unwrap_or(0)
    }

    fn retire_open_proposals(env: &Env) {
        let watermark: u64 = env.storage().instance().get(&NEXTTX).unwrap_or(0);
        env.storage().instance().set(&RETIRED, &watermark);
        SignerSetChangedEvent { retired_below: watermark }.publish(env);
    }

    /// Refuse a proposal whose approvals were gathered under a different signer
    /// set.
    ///
    /// `approval_count` is a plain counter, and the alternative — recounting the
    /// approvals against the current signers — cannot work here. An anonymous
    /// approval records a nullifier and no address, by design, so there is
    /// nothing to recount it against; asking who gave it is the exact question
    /// `approve_zk_anon` exists to refuse. One comparison covers both kinds.
    ///
    /// Retired rather than re-approvable, for the same reason: an anonymous
    /// approver has already burned their nullifier for this `tx_id` and could
    /// not approve it a second time. A fresh proposal gets a fresh id, and with
    /// it fresh nullifiers.
    fn require_current_set(env: &Env, tx_id: u64) -> Result<(), Error> {
        if tx_id < Self::retired_below(env) {
            return Err(Error::SignerSetChanged);
        }
        Ok(())
    }

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
        Self::bump(&env);
        Self::bump_key(&env, &DataKey::Proposal(tx_id));
        env.storage().instance().set(&NEXTTX, &(tx_id + 1));

        ProposedEvent { tx_id, proposer, target, amount, private_mode }.publish(env);
        tx_id
    }

    /// Push the instance's archival deadline out. Called from every write, so a
    /// vault in regular use never approaches it; one left idle past the limit is
    /// archived rather than lost, and a `RestoreFootprint` brings it back.
    fn bump(env: &Env) {
        env.storage().instance().extend_ttl(TTL_LOW, TTL_EXTEND);
    }

    /// Same, for one persistent entry (a proposal, a nullifier, a batch).
    fn bump_key(env: &Env, key: &DataKey) {
        env.storage().persistent().extend_ttl(key, TTL_LOW, TTL_EXTEND);
    }

    /// What can be judged about an action before anyone approves it.
    ///
    /// Duplicated at execution time rather than trusted from here: the vault's
    /// state moves between the two, so a threshold that was reachable when
    /// proposed may not be by the time it passes.
    fn check_admin(env: &Env, action: &AdminAction) -> Result<(), Error> {
        match action {
            AdminAction::SetThreshold(t) => {
                let signers: Vec<Address> = env.storage().instance().get(&SIGNERS).unwrap();
                if *t == 0 || *t > signers.len() as u32 {
                    return Err(Error::BadThreshold);
                }
            }
            AdminAction::AddSigner(a) => {
                if Self::is_signer_internal(env, a) {
                    return Err(Error::DuplicateSigner);
                }
            }
            AdminAction::RemoveSigner(a) => {
                if !Self::is_signer_internal(env, a) {
                    return Err(Error::SignerNotFound);
                }
                let signers: Vec<Address> = env.storage().instance().get(&SIGNERS).unwrap();
                let threshold: u32 = env.storage().instance().get(&THRESH).unwrap();
                if threshold > signers.len() as u32 - 1 {
                    return Err(Error::BadThreshold);
                }
            }
            AdminAction::SetPolicy(p) => {
                if p.max_per_tx < 0 || p.spending_cap < 0 {
                    return Err(Error::InvalidPolicy);
                }
            }
            AdminAction::AllowRecipient(_) => {
                if Self::allowlist(env).len() as u32 >= MAX_ALLOWED {
                    return Err(Error::AllowlistFull);
                }
            }
            AdminAction::AllowContract(c) => {
                // The vault may never be added to its own call allowlist: the
                // host refuses re-entry anyway, so such a proposal could only
                // ever fail — and naming it here says why.
                if *c == env.current_contract_address() {
                    return Err(Error::SelfCallForbidden);
                }
                if Self::call_allowlist(env).len() as u32 >= MAX_ALLOWED {
                    return Err(Error::CallAllowlistFull);
                }
            }
            AdminAction::TransferOwnership(a) => {
                let owner: Address = env.storage().instance().get(&OWNER).unwrap();
                if owner == *a {
                    return Err(Error::SameOwner);
                }
            }
            _ => {}
        }
        Ok(())
    }

    /// Apply a passed action. Reached only from `execute`, which is reached only
    /// by a proposal that met the threshold — there is no other caller, and no
    /// public entry point for any of this.
    fn apply_admin(env: &Env, action: &AdminAction) -> Result<(), Error> {
        Self::check_admin(env, action)?;
        let s = env.storage().instance();
        match action {
            AdminAction::SetThreshold(t) => s.set(&THRESH, t),
            AdminAction::AddSigner(a) => {
                let mut signers: Vec<Address> = s.get(&SIGNERS).unwrap();
                signers.push_back(a.clone());
                s.set(&SIGNERS, &signers);
                Self::retire_open_proposals(env);
            }
            AdminAction::RemoveSigner(a) => {
                let mut next = Vec::new(env);
                for x in s.get::<_, Vec<Address>>(&SIGNERS).unwrap().iter() {
                    if x != *a {
                        next.push_back(x);
                    }
                }
                s.set(&SIGNERS, &next);
                Self::retire_open_proposals(env);
            }
            AdminAction::SetPolicy(p) => {
                s.set(&POLICY, p);
                PolicyUpdatedEvent { by: env.current_contract_address(), policy: p.clone() }
                    .publish(env);
            }
            AdminAction::AllowRecipient(t) => {
                let mut list = Self::allowlist(env);
                for a in list.iter() {
                    if a == *t {
                        return Ok(()); // idempotent
                    }
                }
                list.push_back(t.clone());
                s.set(&ALLOWED, &list);
                AllowlistChangedEvent { target: t.clone(), allowed: true }.publish(env);
            }
            AdminAction::RevokeRecipient(t) => {
                let mut next = Vec::new(env);
                for a in Self::allowlist(env).iter() {
                    if a != *t {
                        next.push_back(a);
                    }
                }
                s.set(&ALLOWED, &next);
                AllowlistChangedEvent { target: t.clone(), allowed: false }.publish(env);
            }
            AdminAction::AllowContract(c) => {
                let mut list = Self::call_allowlist(env);
                for a in list.iter() {
                    if a == *c {
                        return Ok(());
                    }
                }
                list.push_back(c.clone());
                s.set(&CALLOWED, &list);
                CallTargetChangedEvent { contract: c.clone(), allowed: true }.publish(env);
            }
            AdminAction::RevokeContract(c) => {
                let mut next = Vec::new(env);
                for a in Self::call_allowlist(env).iter() {
                    if a != *c {
                        next.push_back(a);
                    }
                }
                s.set(&CALLOWED, &next);
                CallTargetChangedEvent { contract: c.clone(), allowed: false }.publish(env);
            }
            AdminAction::SetZkConfig(cfg) => {
                s.set(&VERIFIER, cfg);
                ZkConfigSetEvent { by: env.current_contract_address(), config: cfg.clone() }
                    .publish(env);
            }
            AdminAction::SetSignerCommitments(c) => s.set(&COMMITS, c),
            AdminAction::TransferOwnership(a) => {
                let old: Address = s.get(&OWNER).unwrap();
                s.set(&OWNER, a);
                OwnershipTransferredEvent { from: old, to: a.clone() }.publish(env);
            }
            AdminAction::Upgrade(hash) => {
                env.deployer().update_current_contract_wasm(hash.clone());
            }
        }
        Ok(())
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

    fn call_allowlist(env: &Env) -> Vec<Address> {
        env.storage().instance().get(&CALLOWED).unwrap_or_else(|| Vec::new(env))
    }

    /// A call target must be explicitly allowed, and can never be this vault.
    fn check_call_target(env: &Env, contract: &Address) -> Result<(), Error> {
        if contract == &env.current_contract_address() {
            return Err(Error::SelfCallForbidden);
        }
        for a in Self::call_allowlist(env).iter() {
            if &a == contract {
                return Ok(());
            }
        }
        Err(Error::ContractNotAllowed)
    }

    fn allowlist(env: &Env) -> Vec<Address> {
        env.storage().instance().get(&ALLOWED).unwrap_or_else(|| Vec::new(env))
    }

    /// Verify a ZK approval against the configured verifier, and pin every
    /// public input to something this contract already knows.
    ///
    /// Binding `txId` is not optional. The circuit derives
    /// `nullifier = Poseidon(commitment, txId)` and takes `txId` as a *public
    /// input*, so a signer free to choose it could mint a fresh nullifier per
    /// proof and approve one proposal as many times as they liked — reaching
    /// the threshold alone. Verifying the proof without this check would buy
    /// nothing.
    fn check_proof(env: &Env, tx_id: u64, zk: &ZKApproval) -> Result<(), Error> {
        let cfg: ZkConfig = match env.storage().instance().get(&VERIFIER) {
            Some(c) => c,
            None => return Ok(()), // unenforced mode — see set_zk_config
        };

        if zk.public_inputs.len() != 4 {
            return Err(Error::PublicInputMismatch);
        }
        // the verifier takes field elements, the wire format is 32-byte limbs
        let mut inputs: Vec<U256> = Vec::new(env);
        for limb in zk.public_inputs.iter() {
            inputs.push_back(U256::from_be_bytes(
                env,
                &Bytes::from_array(env, &limb.to_array()),
            ));
        }

        // [vaultId, txId, signerRoot, nullifier] — all four are ours to dictate
        if inputs.get(0).unwrap() != cfg.vault_id
            || inputs.get(1).unwrap() != U256::from_u128(env, tx_id as u128)
            || inputs.get(2).unwrap() != cfg.signer_root
            || inputs.get(3).unwrap() != zk.nullifier
        {
            return Err(Error::PublicInputMismatch);
        }

        if zk.proof.len() != 256 {
            return Err(Error::BadProofEncoding);
        }
        let a: BytesN<64> = zk.proof.slice(0..64).try_into().map_err(|_| Error::BadProofEncoding)?;
        let b: BytesN<128> = zk.proof.slice(64..192).try_into().map_err(|_| Error::BadProofEncoding)?;
        let c: BytesN<64> = zk.proof.slice(192..256).try_into().map_err(|_| Error::BadProofEncoding)?;

        let ok: bool = env.invoke_contract(
            &cfg.verifier,
            &Symbol::new(env, "verify"),
            (Groth16Proof { a, b, c }, inputs).into_val(env),
        );
        if ok {
            Ok(())
        } else {
            Err(Error::ProofRejected)
        }
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
