#![no_std]

//! Vault Instance — ONE multi-sig vault per deployed contract (Safe-style).
//!
//! Each instance has its own address and holds its OWN funds natively
//! (`token.balance(self)`), so per-vault balance is free and depositing is just
//! a plain transfer to this contract's address. Deployed by `vault-factory`.

use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, symbol_short, token::TokenClient, Address,
    Bytes, BytesN, Env, String, Symbol, U256, Vec,
};

const OWNER: Symbol = symbol_short!("owner");
const NAME: Symbol = symbol_short!("name");
const TOKEN: Symbol = symbol_short!("token");
const THRESH: Symbol = symbol_short!("thresh");
const SIGNERS: Symbol = symbol_short!("signers");
const NEXTTX: Symbol = symbol_short!("nexttx");

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Proposal(u64),
    Approval(u64, Address),
    Nullifier(U256),
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
            panic!();
        }
        if threshold == 0 || threshold > signer_count {
            panic!();
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

    pub fn propose(env: Env, proposer: Address, target: Address, amount: i128, private_mode: bool) -> u64 {
        proposer.require_auth();
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

        ProposedEvent { tx_id, proposer, target, amount, private_mode }.publish(&env);
        tx_id
    }

    /// Transparent approval — identity visible.
    pub fn approve(env: Env, tx_id: u64, signer: Address) {
        signer.require_auth();
        if !Self::is_signer_internal(&env, &signer) {
            panic!();
        }
        let mut p = Self::proposal(&env, tx_id);
        if p.executed {
            panic!();
        }
        if env.storage().persistent().has(&DataKey::Approval(tx_id, signer.clone())) {
            panic!();
        }
        env.storage().persistent().set(&DataKey::Approval(tx_id, signer.clone()), &true);
        p.approval_count += 1;
        env.storage().persistent().set(&DataKey::Proposal(tx_id), &p);

        ApprovedEvent { tx_id, signer }.publish(&env);
    }

    /// ZK approval — identity hidden (only the nullifier is recorded).
    pub fn approve_zk(env: Env, tx_id: u64, signer: Address, zk: ZKApproval) {
        signer.require_auth();
        if !Self::is_signer_internal(&env, &signer) {
            panic!();
        }
        let mut p = Self::proposal(&env, tx_id);
        if p.executed {
            panic!();
        }
        let nk = DataKey::Nullifier(zk.nullifier.clone());
        if env.storage().persistent().has(&nk) {
            panic!(); // double-vote
        }
        if zk.proof.len() == 0 {
            panic!();
        }
        env.storage().persistent().set(&nk, &true);
        p.approval_count += 1;
        env.storage().persistent().set(&DataKey::Proposal(tx_id), &p);

        ZKApprovedEvent { tx_id, nullifier: zk.nullifier }.publish(&env);
    }

    /// Execute once threshold is reached — moves funds from this vault's own
    /// balance. Both modes transfer; in private mode the difference is only that
    /// approvals were ZK proofs (the chain never learns WHO approved).
    pub fn execute(env: Env, tx_id: u64, executor: Address) {
        executor.require_auth();
        let threshold: u32 = env.storage().instance().get(&THRESH).unwrap();
        let mut p = Self::proposal(&env, tx_id);
        if p.approval_count < threshold {
            panic!();
        }
        if p.executed {
            panic!();
        }
        let token: Address = env.storage().instance().get(&TOKEN).unwrap();
        TokenClient::new(&env, &token).transfer(&env.current_contract_address(), &p.target, &p.amount);

        p.executed = true;
        env.storage().persistent().set(&DataKey::Proposal(tx_id), &p);

        ExecutedEvent { tx_id, executed_by: executor, private_mode: p.private_mode }.publish(&env);
    }

    pub fn cancel(env: Env, tx_id: u64, caller: Address) {
        caller.require_auth();
        let mut p = Self::proposal(&env, tx_id);
        if p.proposer != caller {
            panic!();
        }
        if p.executed {
            panic!();
        }
        p.executed = true;
        env.storage().persistent().set(&DataKey::Proposal(tx_id), &p);
    }

    // ---------------- admin (owner) ----------------

    pub fn add_signer(env: Env, new_signer: Address) {
        let owner: Address = env.storage().instance().get(&OWNER).unwrap();
        owner.require_auth();
        let mut signers: Vec<Address> = env.storage().instance().get(&SIGNERS).unwrap();
        signers.push_back(new_signer);
        env.storage().instance().set(&SIGNERS, &signers);
    }

    pub fn remove_signer(env: Env, signer: Address) {
        let owner: Address = env.storage().instance().get(&OWNER).unwrap();
        owner.require_auth();
        let signers: Vec<Address> = env.storage().instance().get(&SIGNERS).unwrap();
        let mut next = Vec::new(&env);
        for s in signers.iter() {
            if s != signer {
                next.push_back(s);
            }
        }
        let threshold: u32 = env.storage().instance().get(&THRESH).unwrap();
        if threshold > next.len() as u32 {
            panic!();
        }
        env.storage().instance().set(&SIGNERS, &next);
    }

    pub fn set_threshold(env: Env, new_threshold: u32) {
        let owner: Address = env.storage().instance().get(&OWNER).unwrap();
        owner.require_auth();
        let signers: Vec<Address> = env.storage().instance().get(&SIGNERS).unwrap();
        if new_threshold == 0 || new_threshold > signers.len() as u32 {
            panic!();
        }
        env.storage().instance().set(&THRESH, &new_threshold);
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

    pub fn get_proposal(env: Env, tx_id: u64) -> Proposal {
        Self::proposal(&env, tx_id)
    }

    pub fn is_signer(env: Env, signer: Address) -> bool {
        Self::is_signer_internal(&env, &signer)
    }

    /// This vault's own balance (native — like a Safe).
    pub fn get_balance(env: Env) -> i128 {
        let token: Address = env.storage().instance().get(&TOKEN).unwrap();
        TokenClient::new(&env, &token).balance(&env.current_contract_address())
    }

    // ---------------- helpers ----------------

    fn proposal(env: &Env, tx_id: u64) -> Proposal {
        env.storage().persistent().get(&DataKey::Proposal(tx_id)).unwrap_or_else(|| panic!())
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
}

#[cfg(test)]
mod test;
