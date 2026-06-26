# Smart Contract — Vault

## Genel Bakış

Soroban akıllı sözleşmesi ile yazılmış multi-sig vault. Signer yönetimi, işlem önerme, onay (approve-only, Gnosis Safe tarzı), ve **gizli fon dağıtımı** (Nethermind Privacy Pool entegrasyonu) içerir.

**İki mod:** İşlem başlatan kişi **Transparent** veya **Private (ZK)** modunu seçer. Private modda kimin onay verdiği, miktar ve alıcı gizlenir.

**Kaynak:** `stellar-vault/` (proje root'ta oluşturulacak)

---

## Mimari Özeti

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          STELLAR VAULT                                   │
│                                                                          │
│  ┌───────────────────┐          ┌───────────────────────────────────┐   │
│  │ Vault Contract    │          │  Nethermind Pool Contract         │   │
│  │ (SENİN)           │          │  (confidential execution)         │   │
│  │                   │          │                                   │   │
│  │ • Signer registry │          │ • UTXO commitments               │   │
│  │ • TX proposal     │          │ • Nullifier set                  │   │
│  │   queue           │          │ • ZK proof verify (Groth16)      │   │
│  │ • Approve         │──call──▶ │ • Encrypted outputs              │   │
│  │   (on-chain)      │          │ • Balance invariant              │   │
│  │ • Threshold check │          │                                   │   │
│  │ • Execute trigger │          │                                   │   │
│  └───────────────────┘          └───────────────────────────────────┘   │
│                                                                          │
│  MOD SEÇİMİ (TX başlatan tarafından):                                   │
│                                                                          │
│  Transparent Mode:          Private (ZK) Mode:                          │
│  ├─ Kim önerdi: GÖRÜNÜR     ├─ Kim önerdi: GÖRÜNÜR                      │
│  ├─ Kim onayladı: GÖRÜNÜR   ├─ Kim onayladı: GİZLİ (ZK proof)          │
│  ├─ Amount: AÇIKTA          ├─ Amount: GİZLİ (Pool commitment)          │
│  └─ Recipient: AÇIKTA       └─ Recipient: GİZLİ (encrypted output)      │
└──────────────────────────────────────────────────────────────────────────┘
```

### Nasıl Çalışır?

1. **TX önerilir** → İnitator mod seçer: Transparent veya Private
2. **Signer'lar onaylar** → `approve()` (transparent) veya `approve_zk()` (private)
3. **Threshold dolunca** → `execute()` çağrılır
4. **Private modda:** Execute → Pool'a `transact(proof, ext_data, sender)` → confidential transfer
5. **Transparent modda:** Execute → normal Stellar token transfer

---

## Contract Yapısı

```
stellar-vault/
├── Cargo.toml
└── src/
    ├── lib.rs           # Module exports
    ├── vault.rs         # Ana contract: Vault oluşturma, yönetme
    ├── types.rs         # Paylaşılan veri yapıları
    └── test.rs          # Unit testler
```

---

## Veri Yapıları

### VaultConfig

```rust
#[contracttype]
#[derive(Clone)]
pub struct VaultConfig {
    pub owner: Address,
    pub threshold: u32,
    pub signer_count: u32,
    pub signers: Vec<Address>,
}
```

### TransactionProposal

Her TX'in bir modu var: Transparent veya Private.

```rust
#[contracttype]
#[derive(Clone)]
pub struct TransactionProposal {
    pub id: u64,
    /// Hedef adres — transparent'ta herkes görür,
    /// private'da sadece signer'lar bilir (storage'da kayıtlı ama event'te emit edilmez)
    pub target: Address,
    /// İşlem miktarı — transparent'ta açıkta,
    /// private'da Pool tarafından gizlenir (commitment)
    pub amount: i128,
    pub proposer: Address,
    /// İşlem modu: Transparent veya Private (ZK)
    pub private_mode: bool,
    /// Transparent modda: onaylayan signer'ların listesi (görünür)
    /// Private modda: sadece count (kimlikler gizli)
    pub approval_count: u32,
    /// Execute edildi mi?
    pub executed: bool,
    pub created_at: u32,
}
```

### Approval (Transparent mod)

```rust
#[contracttype]
#[derive(Clone)]
pub struct Approval {
    pub tx_id: u64,
    pub signer: Address,    // Transparent modda — kim olduğu görünür
    pub approved_at: u32,
}
```

### ZKApproval (Private mod)

Private modda signer onayı ZK-proof ile yapılır. Kimlik gizli.

```rust
#[contracttype]
#[derive(Clone)]
pub struct ZKApproval {
    pub tx_id: u64,
    /// Groth16 proof (256 byte: A(G1) + B(G2) + C(G1))
    pub proof: Groth16Proof,
    /// Public inputs: [vault_id, tx_hash, signer_commitment_root, nullifier]
    pub public_inputs: Vec<Bn254Fr>,
    /// Nullifier — double-vote engelleme (kimlik gizli, sadece unique ID)
    pub nullifier: U256,
}
```

---

## Contract Entry Points

### Vault Yönetimi

```rust
#[contractimpl]
impl VaultContract {
    pub fn create_vault(
        env: Env,
        owner: Address,
        signers: Vec<Address>,
        threshold: u32,
    ) -> Result<u64, Error>;

    pub fn add_signer(env: Env, vault_id: u64, signer: Address) -> Result<(), Error>;
    pub fn remove_signer(env: Env, vault_id: u64, signer: Address) -> Result<(), Error>;
    pub fn set_threshold(env: Env, vault_id: u64, new_threshold: u32) -> Result<(), Error>;
}
```

### İşlem Yönetimi

```rust
    /// Yeni işlem öner
    /// initiator mod seçer: private_mode = true → ZK private
    pub fn propose_transaction(
        env: Env,
        vault_id: u64,
        target: Address,
        amount: i128,
        private_mode: bool,     // ← İŞTE BURASI: initiator seçer
    ) -> Result<u64, Error>;

    /// Transparent onay — kimlik görünür (Gnosis Safe tarzı)
    pub fn approve(env: Env, vault_id: u64, tx_id: u64) -> Result<(), Error>;

    /// ZK proof ile onay — kimlik GİZLİ (Private mod)
    pub fn approve_zk(
        env: Env,
        vault_id: u64,
        tx_id: u64,
        zk_approval: ZKApproval,
    ) -> Result<(), Error>;

    /// İşlemi execute et (threshold'a ulaşınca)
    /// Transparent → normal Stellar transfer
    /// Private → Pool.transact() ile confidential transfer
    pub fn execute(env: Env, vault_id: u64, tx_id: u64) -> Result<(), Error>;

    pub fn cancel(env: Env, vault_id: u64, tx_id: u64) -> Result<(), Error>;
```

### Query Functions

```rust
    pub fn get_vault(env: Env, vault_id: u64) -> Result<VaultConfig, Error>;
    pub fn get_proposal(env: Env, vault_id: u64, tx_id: u64) -> Result<TransactionProposal, Error>;

    /// Transparent modda: signer listesi döner
    /// Private modda: sadece approval_count döner
    pub fn get_approval_info(env: Env, vault_id: u64, tx_id: u64) -> Result<ApprovalInfo, Error>;
```

---

## Storage Key Yapısı

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Vault konfigürasyonu: vault_id → VaultConfig
    VaultConfig(u64),

    /// İşlem önerileri: vault_id + tx_id → TransactionProposal
    Proposal(u64, u64),

    /// Transparent onaylar: vault_id + tx_id + signer → bool
    Approval(u64, u64, Address),

    /// ZK onay nullifier'ları (private mod, double-vote engelleme)
    ZKNullifier(u64, U256),

    /// ZK onay sayısı (private mod)
    ZKApprovalCount(u64, u64),

    /// Sonraki vault ID counter
    NextVaultId,

    /// Pool contract adresi (confidential execution için)
    PoolAddress,

    /// Vault'un Pool'daki UTXO nullifier'ı
    VaultPoolUTXO(u64),
}
```

---

## Core Logic — approve_zk()

Private modda signer'ın kimliğini gizleyen onay fonksiyonu:

```rust
pub fn approve_zk(
    env: Env,
    vault_id: u64,
    tx_id: u64,
    zk_approval: ZKApproval,
) -> Result<(), Error> {
    // 1. Vault var mı?
    let config = Self::get_vault(&env, vault_id)?;

    // 2. TX var mı ve private modda mı?
    let proposal = Self::get_proposal(&env, vault_id, tx_id)?;
    if !proposal.private_mode {
        return Err(Error::NotPrivateMode);
    }

    // 3. TX zaten execute edilmiş mi?
    if proposal.executed {
        return Err(Error::AlreadyExecuted);
    }

    // 4. Bu nullifier daha önce kullanılmış mı? (double-vote engelleme)
    let nullifier_key = DataKey::ZKNullifier(vault_id, zk_approval.nullifier.clone());
    if env.storage().persistent().has(&nullifier_key) {
        return Err(Error::DoubleVote);
    }

    // 5. ZK proof'u doğrula → Nethermind Groth16 Verifier cross-call
    let verifier = Self::get_verifier(&env)?;
    let verifier_client = CircomGroth16VerifierClient::new(&env, &verifier);
    let is_valid = verifier_client.verify(&zk_approval.proof, &zk_approval.public_inputs)?;
    if !is_valid {
        return Err(Error::InvalidProof);
    }

    // 6. Nullifier'ı kaydet (double-vote engelleme)
    env.storage().persistent().set(&nullifier_key, &true);

    // 7. Onay sayısını artır (kimlik YOK, sadece count)
    let count = Self::get_zk_approval_count(&env, vault_id, tx_id)?;
    env.storage().persistent().set(
        &DataKey::ZKApprovalCount(vault_id, tx_id),
        &(count + 1),
    );

    // 8. Event emit (kimlik GİZLİ, sadece nullifier)
    ZKApprovalEvent {
        vault_id,
        tx_id,
        nullifier: zk_approval.nullifier,
    }
    .publish(&env);

    Ok(())
}
```

---

## Core Logic — execute()

Threshold dolduğunda çalışır. Mode'a göre farklı execution:

```rust
pub fn execute(
    env: Env,
    vault_id: u64,
    tx_id: u64,
) -> Result<(), Error> {
    let proposal = Self::get_proposal(&env, vault_id, tx_id)?;
    let config = Self::get_vault(&env, vault_id)?;

    if proposal.approval_count < config.threshold {
        return Err(Error::ThresholdNotReached);
    }
    if proposal.executed {
        return Err(Error::AlreadyExecuted);
    }

    if proposal.private_mode {
        // ── PRIVATE: Pool üzerinden confidential transfer ──
        Self::execute_confidential(&env, vault_id, tx_id, &proposal)?;
    } else {
        // ── TRANSPARENT: Normal Stellar token transfer ──
        Self::execute_transparent(&env, vault_id, tx_id, &proposal)?;
    }

    // TX'i executed olarak işaretle
    let mut updated = proposal.clone();
    updated.executed = true;
    env.storage().persistent().set(
        &DataKey::Proposal(vault_id, tx_id),
        &updated,
    );

    Ok(())
}

/// Private execution → Pool.transact() ile confidential transfer
fn execute_confidential(
    env: &Env,
    vault_id: u64,
    tx_id: u64,
    proposal: &TransactionProposal,
) -> Result<(), Error> {
    let pool = Self::get_pool(env)?;
    let pool_client = PoolContractClient::new(env, &pool);

    // Pool'un transact() method'unu çağır:
    // proof, ext_data (recipient + ext_amount + encrypted_outputs), sender
    let ext_data = ExtData {
        recipient: proposal.target.clone(),
        ext_amount: I256::from_i128(env, proposal.amount),
        encrypted_output0: /* encrypted output bytes */,
        encrypted_output1: /* change UTXO encrypted output */,
    };

    let proof_data = Self::get_pool_proof(env, vault_id, tx_id)?;

    pool_client.transact(
        &proof_data.proof,
        &proof_data.ext_data,
        &env.current_contract_address(),
    )?;

    // Event emit (detaylar GİZLİ)
    TransactionExecutedEvent {
        vault_id,
        tx_id,
        executed_by: env.invoker(),
        // target ve amount YOK — confidential
    }
    .publish(env);

    Ok(())
}

/// Transparent execution → normal token transfer
fn execute_transparent(
    env: &Env,
    vault_id: u64,
    tx_id: u64,
    proposal: &TransactionProposal,
) -> Result<(), Error> {
    let token = Self::get_token(env)?;
    let token_client = TokenClient::new(env, &token);

    token_client.transfer(
        &env.current_contract_address(),
        &proposal.target,
        &proposal.amount,
    )?;

    // Event emit (detaylar AÇIK)
    TransactionExecutedEvent {
        vault_id,
        tx_id,
        executed_by: env.invoker(),
        // target ve amount AÇIK
    }
    .publish(env);

    Ok(())
}
```

---

## Events — Dual Mode

### Transparent Mode Events

```rust
#[contractevent]
#[derive(Clone)]
pub struct TransactionProposedEvent {
    #[topic] pub vault_id: u64,
    #[topic] pub tx_id: u64,
    pub proposer: Address,
    pub target: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct ApprovalEvent {
    #[topic] pub vault_id: u64,
    #[topic] pub tx_id: u64,
    pub signer: Address,     // ← KİMLİK GÖRÜNÜR
}

#[contractevent]
#[derive(Clone)]
pub struct TransactionExecutedEvent {
    #[topic] pub vault_id: u64,
    #[topic] pub tx_id: u64,
    pub executed_by: Address,
    pub target: Address,     // ← AÇIKTA
    pub amount: i128,        // ← AÇIKTA
}
```

### Private (ZK) Mode Events

```rust
#[contractevent]
#[derive(Clone)]
pub struct PrivateTransactionProposedEvent {
    #[topic] pub vault_id: u64,
    #[topic] pub tx_id: u64,
    pub proposer: Address,   // Öneren görünür (kim başlattı bilinmeli)
    // target ve amount YOK — gizli
}

#[contractevent]
#[derive(Clone)]
pub struct ZKApprovalEvent {
    #[topic] pub vault_id: u64,
    #[topic] pub tx_id: u64,
    pub nullifier: U256,     // ← KİMLİK GİZLİ, sadece nullifier
}

#[contractevent]
#[derive(Clone)]
pub struct PrivateTransactionExecutedEvent {
    #[topic] pub vault_id: u64,
    #[topic] pub tx_id: u64,
    pub executed_by: Address,
    // target ve amount YOK — confidential execution
}
```

---

## Error Types

```rust
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
    ThresholdTooHigh = 11,
    EmptySigners = 12,
    PoolNotSet = 13,
    PoolTransferFailed = 14,
}
```

---

## On-Chain State Management

### Neden Tamamen On-Chain?

| | Soroban On-Chain | Off-Chain Relayer |
|---|---|---|
| **Güven** | Trustless — contract tek gerçek kaynak | Backend'e güvenmek lazım |
| **Gas (Stellar)** | ~$0.0001/approve — çok ucuz | Daha ucuz ama trust trade-off |
| **Karmaşıklık** | Basit — her approve bir TX | İmza toplama, aggregation, replay |

**Stellar'da TX fee'si çok düşük** (~$0.0001). Gnosis Safe Ethereum'da off-chain imza toplar çünkü her TX $1-10. Stellar'da bu sorun yok.

**Karar:** Tamamen on-chain. Her signer `approve()` veya `approve_zk()` çağrısını doğrudan contract'a yapar.

### Gas Maliyet Tablosu (Tahmini)

| İşlem | Transparent | Private (ZK) |
|---|---|---|
| Vault oluştur | ~$0.001 | ~$0.001 |
| TX öner | ~$0.0005 | ~$0.0005 |
| Approve | ~$0.0001 | ~$0.003 (ZK proof dahil) |
| Execute | ~$0.0005 | ~$0.005 (Pool transact + ZK verify) |
| **Toplam (3/5 vault)** | **~$0.002** | **~$0.016** |

---

## Vault → Pool Deposit Flow

Vault'un Pool'da UTXO'su olmalı ki confidential transfer yapabilsin.

### Setup Akışı

```
1. Vault oluşturulur → signer'lar kaydedilir
2. Vault, Pool'a deposit yapar (ilk funding):
   a. Signer'lardan biri Pool'a TX gönderir
   b. Sender = Vault contract adresi (Soroban auth ile)
   c. Vault contract, Pool.transact() çağrısı yapar
      - ext_amount > 0 (deposit)
      - input_nullifier = [] (ilk deposit, input yok)
      - output_commitment = yeni UTXO (vault için)
   d. Pool: yeni commitment Merkle tree'ye eklenir
   e. Vault artık Pool'da bakiyeye sahip

3. Vault'un Pool UTXO bilgileri off-chain saklanır:
   - commitment index
   - blinding factor
   - Bu bilgiler signer'lar arasında paylaşılır
     (frontend'de proof generation için gerekli)
```

### Funding

Her signer vault'a token gönderebilir:

```
Signer → Vault contract → Token transfer
Vault balance artar → execute için yeterli bakiye olur
```

Vault bakiyesi iki yerde olabilir:
1. **Vault contract'ın kendi token bakiyesi** (transparent execution için)
2. **Vault'un Pool'daki UTXO'su** (confidential execution için)

---

## Bağımlılıklar

```toml
[package]
name = "stellar-vault"
version = "0.1.0"
edition = "2021"
rust-version = "1.81"

[lib]
crate-type = ["cdylib"]
doctest = false

[dependencies]
soroban-sdk = { version = "23.0" }
pool-contract = { path = "../stellar-private-payments/contracts/pool" }
contract-types = { path = "../stellar-private-payments/contracts/types" }

[dev-dependencies]
soroban-sdk = { version = "23.0", features = ["testutils"] }
```

---

*İlgili: [Nethermind Entegrasyonu](../nethermind/INTEGRATION.md) | [ZK Circuits](../zk-circuits/CIRCUITS.md) | [Deployment](../deployment/DEPLOY.md)*
