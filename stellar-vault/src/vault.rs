use soroban_sdk::{contract, contractimpl, Address, Env, String, Vec, token::TokenClient};
use crate::types::{DataKey, VaultConfig, TransactionProposal, ZKApproval, VaultStats};
use crate::types::{VaultCreatedEvent, TransactionProposedEvent, ApprovalEvent, ZKApprovalEvent, TransactionExecutedEvent};

#[contract]
pub struct VaultContract;

#[contractimpl]
impl VaultContract {
    // ==================== VAULT YÖNETİMİ ====================

    /// Yeni bir vault oluştur
    pub fn create_vault(
        env: Env,
        owner: Address,
        name: String,
        signers: Vec<Address>,
        threshold: u32,
    ) -> u64 {
        owner.require_auth();

        let signer_count = signers.len() as u32;
        if signer_count == 0 {
            panic!();
        }
        if threshold == 0 || threshold > signer_count {
            panic!();
        }

        let vault_id = Self::next_vault_id(&env);

        let config = VaultConfig {
            owner: owner.clone(),
            name,
            threshold,
            signer_count,
            signers: signers.clone(),
        };

        env.storage().persistent().set(&DataKey::VaultConfig(vault_id), &config);
        env.storage().persistent().set(&DataKey::NextVaultId, &(vault_id + 1));

        VaultCreatedEvent {
            vault_id,
            owner,
            threshold,
            signer_count,
        }
        .publish(&env);

        vault_id
    }

    /// Signer ekle (sadece owner)
    pub fn add_signer(env: Env, vault_id: u64, new_signer: Address) {
        let config = Self::get_config(&env, vault_id);
        config.owner.require_auth();

        let mut signers = config.signers.clone();
        signers.push_back(new_signer);

        let updated = VaultConfig {
            owner: config.owner,
            name: config.name,
            signer_count: signers.len() as u32,
            signers,
            threshold: config.threshold,
        };

        env.storage().persistent().set(&DataKey::VaultConfig(vault_id), &updated);
    }

    /// Signer çıkar (sadece owner)
    pub fn remove_signer(env: Env, vault_id: u64, signer: Address) {
        let config = Self::get_config(&env, vault_id);
        config.owner.require_auth();

        let mut new_signers = Vec::new(&env);
        for i in 0..config.signer_count {
            let s = config.signers.get(i).unwrap();
            if s != signer {
                new_signers.push_back(s);
            }
        }

        let new_count = new_signers.len() as u32;
        if config.threshold > new_count {
            panic!();
        }

        let updated = VaultConfig {
            owner: config.owner,
            name: config.name,
            signer_count: new_count,
            signers: new_signers,
            threshold: config.threshold,
        };

        env.storage().persistent().set(&DataKey::VaultConfig(vault_id), &updated);
    }

    /// Threshold değiştir (sadece owner)
    pub fn set_threshold(env: Env, vault_id: u64, new_threshold: u32) {
        let config = Self::get_config(&env, vault_id);
        config.owner.require_auth();

        if new_threshold == 0 || new_threshold > config.signer_count {
            panic!();
        }

        let updated = VaultConfig {
            threshold: new_threshold,
            ..config
        };

        env.storage().persistent().set(&DataKey::VaultConfig(vault_id), &updated);
    }

    // ==================== İŞLEM YÖNETİMİ ====================

    /// Yeni işlem öner
    pub fn propose_transaction(
        env: Env,
        vault_id: u64,
        proposer: Address,
        target: Address,
        amount: i128,
        private_mode: bool,
    ) -> u64 {
        proposer.require_auth();

        let _config = Self::get_config(&env, vault_id);
        let tx_id = Self::next_tx_id_for_vault(&env, vault_id);

        let proposal = TransactionProposal {
            id: tx_id,
            target: target.clone(),
            amount,
            proposer: proposer.clone(),
            private_mode,
            approval_count: 0,
            executed: false,
            created_at: env.ledger().sequence(),
        };

        env.storage().persistent().set(&DataKey::Proposal(vault_id, tx_id), &proposal);

        TransactionProposedEvent {
            vault_id,
            tx_id,
            proposer,
            target,
            amount,
            private_mode,
        }
        .publish(&env);

        tx_id
    }

    /// Transparent onay (Gnosis Safe tarzı — kimlik görünür)
    pub fn approve(env: Env, vault_id: u64, tx_id: u64, signer: Address) {
        signer.require_auth();

        let config = Self::get_config(&env, vault_id);
        if !Self::is_signer_internal(&config, &signer) {
            panic!();
        }

        let mut proposal = Self::get_proposal(&env, vault_id, tx_id);

        if proposal.executed {
            panic!();
        }

        if env.storage().persistent().has(&DataKey::Approval(vault_id, tx_id, signer.clone())) {
            panic!();
        }

        env.storage().persistent().set(&DataKey::Approval(vault_id, tx_id, signer.clone()), &true);
        proposal.approval_count += 1;

        env.storage().persistent().set(&DataKey::Proposal(vault_id, tx_id), &proposal);

        ApprovalEvent {
            vault_id,
            tx_id,
            signer,
        }
        .publish(&env);
    }

    /// ZK proof ile onay (Private mod — kimlik gizli)
    pub fn approve_zk(
        env: Env,
        vault_id: u64,
        tx_id: u64,
        signer: Address,
        zk_approval: ZKApproval,
    ) {
        signer.require_auth();

        let _config = Self::get_config(&env, vault_id);
        if !Self::is_signer_internal(&_config, &signer) {
            panic!();
        }

        let mut proposal = Self::get_proposal(&env, vault_id, tx_id);

        if proposal.executed {
            panic!();
        }

        // Double-vote kontrolü
        let nullifier_key = DataKey::ZKNullifier(vault_id, zk_approval.nullifier.clone());
        if env.storage().persistent().has(&nullifier_key) {
            panic!();
        }

        // Proof boş kontrolü
        if zk_approval.proof.len() == 0 {
            panic!();
        }

        // Nullifier'ı kaydet
        env.storage().persistent().set(&nullifier_key, &true);

        // Onay sayısını artır
        proposal.approval_count += 1;
        env.storage().persistent().set(&DataKey::Proposal(vault_id, tx_id), &proposal);

        ZKApprovalEvent {
            vault_id,
            tx_id,
            nullifier: zk_approval.nullifier,
        }
        .publish(&env);
    }

    /// İşlemi execute et (threshold'a ulaşınca)
    pub fn execute(env: Env, vault_id: u64, tx_id: u64, executor: Address) {
        executor.require_auth();

        let config = Self::get_config(&env, vault_id);
        let proposal = Self::get_proposal(&env, vault_id, tx_id);

        if proposal.approval_count < config.threshold {
            panic!();
        }

        if proposal.executed {
            panic!();
        }

        if proposal.private_mode {
            Self::execute_confidential(&env, vault_id, tx_id, &proposal);
        } else {
            Self::execute_transparent(&env, vault_id, tx_id, &proposal);
        }

        let mut updated = proposal;
        updated.executed = true;
        env.storage().persistent().set(&DataKey::Proposal(vault_id, tx_id), &updated);

        TransactionExecutedEvent {
            vault_id,
            tx_id,
            executed_by: executor,
        }
        .publish(&env);
    }

    /// İşlemi iptal et (sadece proposer)
    pub fn cancel(env: Env, vault_id: u64, tx_id: u64, caller: Address) {
        caller.require_auth();

        let proposal = Self::get_proposal(&env, vault_id, tx_id);

        if proposal.proposer != caller {
            panic!();
        }

        if proposal.executed {
            panic!();
        }

        let mut updated = proposal;
        updated.executed = true;
        env.storage().persistent().set(&DataKey::Proposal(vault_id, tx_id), &updated);
    }

    // ==================== QUERY ====================

    pub fn get_vault(env: Env, vault_id: u64) -> VaultConfig {
        Self::get_config(&env, vault_id)
    }

    pub fn get_proposal_fn(env: Env, vault_id: u64, tx_id: u64) -> TransactionProposal {
        Self::get_proposal(&env, vault_id, tx_id)
    }

    pub fn get_vault_stats(_env: Env, _vault_id: u64) -> VaultStats {
        VaultStats {
            total_proposals: 0,
            total_executed: 0,
            total_private: 0,
        }
    }

    pub fn is_signer(env: Env, vault_id: u64, signer: Address) -> bool {
        let config = Self::get_config(&env, vault_id);
        Self::is_signer_internal(&config, &signer)
    }

    // ==================== POOL YÖNETİMİ ====================

    pub fn set_pool(env: Env, caller: Address, pool_address: Address) {
        caller.require_auth();
        env.storage().persistent().set(&DataKey::PoolAddress, &pool_address);
    }

    pub fn get_pool_address(env: Env) -> Address {
        env.storage()
            .persistent()
            .get(&DataKey::PoolAddress)
            .unwrap_or_else(|| panic!())
    }

    /// Transparent transferlerin kullanacağı token (asset) adresini ayarla
    pub fn set_token(env: Env, caller: Address, token_address: Address) {
        caller.require_auth();
        env.storage().persistent().set(&DataKey::TokenAddress, &token_address);
    }

    pub fn get_token_address(env: Env) -> Address {
        env.storage()
            .persistent()
            .get(&DataKey::TokenAddress)
            .unwrap_or_else(|| panic!())
    }

    // ==================== BAKİYE (per-vault) ====================

    /// Belirli bir vault'a fon yatır — bakiye o vault'a yazılır
    pub fn deposit(env: Env, vault_id: u64, from: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic!();
        }
        let _config = Self::get_config(&env, vault_id); // vault var mı doğrula
        let token_addr = Self::get_token_address(env.clone());
        TokenClient::new(&env, &token_addr).transfer(&from, &env.current_contract_address(), &amount);

        let new_bal = Self::vault_balance(&env, vault_id) + amount;
        env.storage().persistent().set(&DataKey::VaultBalance(vault_id), &new_bal);
    }

    /// Bir vault'un kendi bakiyesi (paylaşılan değil, vault'a özel)
    pub fn get_vault_balance(env: Env, vault_id: u64) -> i128 {
        Self::vault_balance(&env, vault_id)
    }

    // ==================== YARDIMCI ====================

    fn vault_balance(env: &Env, vault_id: u64) -> i128 {
        env.storage().persistent().get(&DataKey::VaultBalance(vault_id)).unwrap_or(0)
    }

    fn get_config(env: &Env, vault_id: u64) -> VaultConfig {
        env.storage()
            .persistent()
            .get(&DataKey::VaultConfig(vault_id))
            .unwrap_or_else(|| panic!())
    }

    fn get_proposal(env: &Env, vault_id: u64, tx_id: u64) -> TransactionProposal {
        env.storage()
            .persistent()
            .get(&DataKey::Proposal(vault_id, tx_id))
            .unwrap_or_else(|| panic!())
    }

    fn next_vault_id(env: &Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::NextVaultId)
            .unwrap_or(0)
    }

    fn next_tx_id_for_vault(env: &Env, vault_id: u64) -> u64 {
        let mut id: u64 = 0;
        while env.storage().persistent().has(&DataKey::Proposal(vault_id, id)) {
            id += 1;
        }
        id
    }

    fn is_signer_internal(config: &VaultConfig, signer: &Address) -> bool {
        for i in 0..config.signer_count {
            if config.signers.get(i) == Some(signer.clone()) {
                return true;
            }
        }
        false
    }

    /// Transparent execution — vault'un kendi bakiyesinden token transferi
    fn execute_transparent(env: &Env, vault_id: u64, _tx_id: u64, proposal: &TransactionProposal) {
        let bal = Self::vault_balance(env, vault_id);
        if bal < proposal.amount {
            panic!(); // yetersiz vault bakiyesi
        }
        env.storage().persistent().set(&DataKey::VaultBalance(vault_id), &(bal - proposal.amount));

        let token_addr = Self::get_token_address(env.clone());
        let client = TokenClient::new(env, &token_addr);
        client.transfer(&env.current_contract_address(), &proposal.target, &proposal.amount);
    }

    /// Confidential execution — Pool.transact() ile gizli transfer
    fn execute_confidential(env: &Env, _vault_id: u64, _tx_id: u64, _proposal: &TransactionProposal) {
        let _pool_address = Self::get_pool_address(env.clone());
        // Pool.transact(proof, ext_data, sender) çağrısı
        // Pool contract'ının interface'ine göre implement edilecek
    }
}
