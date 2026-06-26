use soroban_sdk::{contracttype, contracterror, contractevent, Address, Vec, U256, Bytes, BytesN};

/// Vault yapılandırması
#[contracttype]
#[derive(Clone)]
pub struct VaultConfig {
    pub owner: Address,
    pub threshold: u32,
    pub signer_count: u32,
    pub signers: Vec<Address>,
}

/// İşlem önerisi
#[contracttype]
#[derive(Clone)]
pub struct TransactionProposal {
    pub id: u64,
    pub target: Address,
    pub amount: i128,
    pub proposer: Address,
    pub private_mode: bool,
    pub approval_count: u32,
    pub executed: bool,
    pub created_at: u32,
}

/// ZK onay yapısı (Private mod için)
#[contracttype]
#[derive(Clone)]
pub struct ZKApproval {
    pub tx_id: u64,
    pub proof: Bytes,            // 256 byte Groth16 proof
    pub public_inputs: Vec<BytesN<32>>,  // Public inputs
    pub nullifier: U256,
}

/// Storage key'leri
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    VaultConfig(u64),
    Proposal(u64, u64),
    Approval(u64, u64, Address),
    ZKNullifier(u64, U256),
    ZKApprovalCount(u64, u64),
    NextVaultId,
    PoolAddress,
    TokenAddress,
}

/// Vault istatistikleri
#[contracttype]
#[derive(Clone)]
pub struct VaultStats {
    pub total_proposals: u64,
    pub total_executed: u64,
    pub total_private: u64,
}

/// Hata tipleri
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    VaultNotFound = 1,
    NotAuthorized = 2,
    NotSigner = 3,
    AlreadyApproved = 4,
    AlreadyExecuted = 5,
    ThresholdNotReached = 6,
    DoubleVote = 7,
    InvalidProof = 8,
    NotPrivateMode = 9,
    AlreadyCanceled = 10,
    PoolNotSet = 11,
    ThresholdTooHigh = 12,
    EmptySigners = 13,
}

/// Events
#[contractevent]
#[derive(Clone)]
pub struct VaultCreatedEvent {
    #[topic]
    pub vault_id: u64,
    pub owner: Address,
    pub threshold: u32,
    pub signer_count: u32,
}

#[contractevent]
#[derive(Clone)]
pub struct TransactionProposedEvent {
    #[topic] pub vault_id: u64,
    #[topic] pub tx_id: u64,
    pub proposer: Address,
    pub target: Address,
    pub amount: i128,
    pub private_mode: bool,
}

#[contractevent]
#[derive(Clone)]
pub struct ApprovalEvent {
    #[topic] pub vault_id: u64,
    #[topic] pub tx_id: u64,
    pub signer: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct ZKApprovalEvent {
    #[topic] pub vault_id: u64,
    #[topic] pub tx_id: u64,
    pub nullifier: U256,
}

#[contractevent]
#[derive(Clone)]
pub struct TransactionExecutedEvent {
    #[topic] pub vault_id: u64,
    #[topic] pub tx_id: u64,
    pub executed_by: Address,
}
