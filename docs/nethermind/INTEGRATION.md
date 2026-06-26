# Nethermind Entegrasyonu

## Genel Bakış

Nethermind'in [`stellar-private-payments`](https://github.com/NethermindEth/stellar-private-payments) reposu, Stellar üzerinde ZK-proof destekli gizli ödemeler için tam bir altyapı sağlar.

**Kullanım amacımız üç katmanlı:**

| Katman | Bileşen | Amaç |
|---|---|---|
| **1. Voter Identity** | voteApproval.circom (adapte) | Kimin onayladığını gizle |
| **2. Confidential Execution** | Pool Contract (core) | Amount + recipient gizle |
| **3. Proof Verification** | Groth16 Verifier | On-chain proof doğrulama |

---

## Bileşenler

### 1. Pool Contract (CORE — Confidential Execution)

**Kaynak:** `Nethermind repo → contracts/pool/`

**Ne yapar:** Confidential transfer layer. UTXO tabanlı gizlilik.

**Kullanım:** Vault'un `execute()` fonksiyonu private modda Pool'un `transact()` method'unu çağırır:

```rust
// Vault execute() içinde:
let pool = Self::get_pool(&env)?;
let pool_client = PoolContractClient::new(&env, &pool);

// Pool'un transact() method'u — doğru isim bu
pool_client.transact(
    &proof,        // Groth16 proof (256 byte)
    &ext_data,     // ExtData { recipient, ext_amount, encrypted_outputs }
    &sender,       // Vault contract address
)?;
```

**Pool'un transact() interface'i (Nethermind'den):**

```rust
// Nethermind Pool contract'tan:
pub fn transact(
    env: &Env,
    proof: Proof,          // ZK proof + public inputs
    ext_data: ExtData,     // External data (recipient, amount, encrypted outputs)
    sender: Address,       // Sender address (must authorize)
) -> Result<(), Error>;
```

**Proof struct'ı (Nethermind'den):**

```rust
pub struct Proof {
    pub proof: Groth16Proof,         // 256 byte Groth16 proof
    pub root: U256,                  // Pool Merkle tree root
    pub input_nullifiers: Vec<U256>, // Spent input UTXO nullifiers
    pub output_commitment0: U256,    // New encrypted output commitment
    pub output_commitment1: U256,    // Change UTXO commitment
    pub public_amount: U256,         // Net public amount (0 for private)
    pub ext_data_hash: BytesN<32>,   // Hash of ext_data
    pub asp_membership_root: U256,   // ASP membership root
    pub asp_non_membership_root: U256, // ASP non-membership root
}
```

**ExtData struct'ı (Nethermind'den):**

```rust
pub struct ExtData {
    pub recipient: Address,          // Recipient address
    pub ext_amount: I256,            // External amount (positive=deposit, negative=withdraw)
    pub encrypted_output0: Bytes,    // Encrypted output data for recipient
    pub encrypted_output1: Bytes,    // Encrypted change output
}
```

**Vault Entegrasyonu:**

```
Vault Contract                          Pool Contract
┌──────────────┐                       ┌──────────────────┐
│ propose_tx() │                       │                  │
│ approve_zk() │                       │                  │
│ execute()    │───Pool.transact──────▶│ internal_transact│
│              │   (proof, ext_data)   │                  │
│              │                       │ → ZK verify      │
│              │                       │ → nullifier spend│
│              │                       │ → encrypted output│
│              │                       │ → NewCommitmentEvent
└──────────────┘                       └──────────────────┘
```

---

### 2. Circom Groth16 Verifier

**Kaynak:** `Nethermind repo → contracts/circom-groth16-verifier/`

**Ne yapar:** Groth16 proof'u Soroban'da on-chain doğrular. Soroban'ın native BN254 precompile'unu kullanır.

**Kullanım:** Hem Pool hem de Vault'un `approve_zk()` fonksiyonu bu contract'a cross-contract call yapar.

```rust
// Contract Interface:
pub fn verify(
    env: Env,
    proof: Groth16Proof,       // 256 byte: A(G1) + B(G2) + C(G1)
    public_inputs: Vec<Bn254Fr>
) -> Result<bool, Groth16Error>;
```

**Verification Key:** Build-time'da embed edilir:

```bash
VERIFIER_VK_JSON=/path/to/verification_key.json \
  cargo build -p circom-groth16-verifier --release --target wasm32v1-none
```

---

### 3. voteApproval.circom (Voter Identity — Adapte)

**Kaynak:** Nethermind'in `selectiveDisclosure.circom` circuit'inden adapte.

**Ne yapar:** Signer onayının ZK-proof'unu üretir. Kimlik gizli, sadece "geçerli signer onayladı" kanıtlanır.

**Detaylar:** [`ZK Circuits`](../zk-circuits/CIRCUITS.md) dokümanında.

### 4. transaction.circom (Confidential Execution — Hazır)

**Kaynak:** `Nethermind repo → circuits/src/transaction.circom` (HAZIR)

**Ne yapar:** Confidential transfer proof'ı. UTXO sahipliği, balance invariant, encrypted output doğruluğu.

**Biz bunu değiştirmiyoruz.** Nethermind'in circuit'ini doğrudan kullanıyoruz.

---

## Bileşen Kullanım Özeti

| Bileşen | Durum | Kullanım Amacı |
|---|---|---|
| **Pool Contract** | ✅ **CORE** | Confidential execution — gizli amount + recipient |
| **Groth16 Verifier** | ✅ **CORE** | On-chain proof verification (Pool + approve_zk) |
| **voteApproval.circom** | ✅ **KENDİMİZ** | Voter identity privacy (selectiveDisclosure'dan adapte) |
| **transaction.circom** | ✅ **HAZIR** | Pool'un confidential execution circuit'i |
| **merkleProof.circom** | ✅ **HAZIR** | Hem voteApproval hem Pool kullanır |
| **keypair.circom** | ✅ **HAZIR** | Hem voteApproval hem Pool kullanır |
| **Poseidon2** | ✅ **HAZIR** | Hash fonksiyonu (her iki circuit) |
| **ASP Membership** | ⚠️ **DUMMY** | Pool deploy için gerekli — empty tree deploy et |
| **ASP Non-Membership** | ⚠️ **DUMMY** | Pool deploy için gerekli — empty tree deploy et |
| **policyTransaction** | ❌ Kullanılmıyor | ASP'li transaction — gerekmez |

---

## ASP Contract'ları — Hackathon Çözümü

Pool deploy için ASP Membership ve ASP Non-Membership contract'ları **zorunlu bağımlılık.** Ama biz ASP feature'ını kullanmıyoruz.

**Çözüm: Dummy ASP'ler**

```bash
# ASP Membership deploy et (boş Merkle tree)
cargo build -p asp-membership --release --target wasm32v1-none
stellar contract deploy \
  --wasm target/wasm32v1-none/release/asp_membership.wasm \
  --source <identity> --network testnet \
  -- --admin <admin> --levels 1

# ASP Non-Membership deploy et (boş SMT)
cargo build -p asp-non-membership --release --target wasm32v1-none
stellar contract deploy \
  --wasm target/wasm32v1-none/release/asp_non_membership.wasm \
  --source <identity> --network testnet \
  -- --admin <admin> --levels 1
```

Bu ASP'ler boş tree ile başlar — hiç kimse eklenmez. Pool çalışır, ASP proof'ları trivial (empty tree proof). Hackathon'da sorun yok.

**Not:** Production'da ya ASP'li gerçek kullanım ya da Pool'u ASP'siz fork'la.

---

## Confidential Execution Akışı

### Vault → Pool Entegrasyon Detayı

```
1. VAULT DEPOSIT (setup — bir kez)
   Vault → Pool'a deposit yapar → UTXO oluşturulur
   Pool: yeni commitment Merkle tree'ye eklenir
   → Vault artık Pool'da bakiyeye sahip

   Bunu nasıl yapar:
   - Signer'lardan biri Vault contract adına Pool'a TX gönderir
   - Vault contract: Pool.transact() çağrısı (deposit proof ile)
   - proof: input_nullifier=[], output_commitment=new_leaf
   - ext_amount > 0 (deposit miktarı)

2. TX ÖNERİLMESİ (Vault katmanı)
   Signer A: "1000 USDC → GXYZ..." önerir
   private_mode = true seçer
   Proposal storage'a kaydedilir

3. ONAYLAR (Vault katmanı — Voter Privacy)
   Signer B: approve_zk(vault_id, tx_id, zk_proof)
   → voteApproval.circom proof üretir (browser WASM)
   → Contract proof verify, nullifier kaydet, count++
   → Event: ZKApprovalEvent (kimlik gizli, sadece nullifier)

   Signer C: aynı akış
   → approval_count = 2/3 → threshold doldu

4. CONFIDENTIAL EXECUTION (Vault → Pool)
   Herhangi bir signer: execute(vault_id, tx_id)

   Vault contract:
   a. Proposal'ı getir (target, amount oku)
   b. Vault'un Pool'daki UTXO'sunu bul
   c. Pool proof input'larını hazırla
      - input_nullifier = vault'un UTXO nullifier'ı
      - output_commitment0 = encrypted(recipient, amount, blinding)
      - output_commitment1 = encrypted(change, vault_pubkey, blinding)
      - public_amount = 0 (tamamen private)
   d. Pool.transact(proof, ext_data, vault_address)

   Pool contract:
   a. Groth16 Verifier → proof verify ✓
   b. Nullifier'ı spent olarak işaretle
   c. Encrypted output'ları Merkle tree'ye ekle
   d. NewCommitmentEvent emit (encrypted)

5. SONUÇ
   Blockchain'de görünen:
   - Vault.execute() çağrısı (tx_id, vault_id)
   - Pool.transact() çağrısı (proof + encrypted output)
   - Nullifier spend event
   - NewCommitmentEvent (encrypted — sadece alıcı çözer)

   Blockchain'de GÖRÜNMEYEN:
   ❌ Alıcı adres (encrypted output'ta)
   ❌ Miktar (commitment içinde, blinding factor ile gizli)
   ❌ Kimin onayladığı (voteApproval nullifier'ından geri hesaplanamaz)
   ❌ Kimin ne transfer ettiği
```

---

## Proof Generation — Kim Yapıyor?

### Voter Identity Proof (approve_zk için)

```
Signer'ın kendi browser'ında:
  1. Frontend: signer'ın private key'ini al (Freighter wallet)
  2. Merkle proof'u hesapla (signer commitment tree'den)
  3. voteApproval WASM ile proof üret (~3-5 saniye)
  4. Proof + nullifier → Soroban contract'a gönder
```

Signer'ın kendi kimliğini gizleyen proof'u kendisi üretir. Private key'i kimseyle paylaşmaz.

### Pool Execution Proof (execute için)

```
Execute yapan signer'ın browser'ında:
  1. Vault'un Pool private key'ini hesapla (deterministic, vault_id + shared_secret)
  2. Vault'un Pool UTXO'sunu bul (commitment index)
  3. transaction.circom WASM ile proof üret (~5-15 saniye)
  4. Proof + ext_data → Vault.execute() → Pool.transact()
```

**Vault Pool private key yönetimi:**

```
vault_pool_private_key = hash(vault_id, shared_secret)

shared_secret: Vault oluşturulurken signer'lara verilir.
- Her signer bu secret'ı kendi cihazında saklar
- Frontend'de private key hesaplanır
- Contract'ta saklanmaz (güvenlik)
```

---

## Integration Adımları

### Adım 1: Nethermind Verifier'ı Build + Deploy Et

```bash
git clone https://github.com/NethermindEth/stellar-private-payments.git
cd stellar-private-payments
export VERIFIER_VK_JSON=deployments/testnet/circuit_keys/policy_tx_2_2_vk.json
cargo build -p circom-groth16-verifier --release --target wasm32v1-none

stellar contract deploy \
  --wasm target/wasm32v1-none/release/circom_groth16_verifier.wasm \
  --source <identity> --network testnet
# → VERIFIER_CONTRACT_ID kaydet
```

### Adım 2: Dummy ASP'leri Deploy Et

```bash
# ASP Membership (boş tree)
cargo build -p asp-membership --release --target wasm32v1-none
stellar contract deploy \
  --wasm target/wasm32v1-none/release/asp_membership.wasm \
  --source <identity> --network testnet \
  -- --admin <admin> --levels 1
# → ASP_MEMBERSHIP_ID kaydet

# ASP Non-Membership (boş SMT)
cargo build -p asp-non-membership --release --target wasm32v1-none
stellar contract deploy \
  --wasm target/wasm32v1-none/release/asp_non_membership.wasm \
  --source <identity> --network testnet \
  -- --admin <admin> --levels 1
# → ASP_NON_MEMBERSHIP_ID kaydet
```

### Adım 3: Pool Contract'ı Deploy Et

```bash
cargo build -p pool --release --target wasm32v1-none

stellar contract deploy \
  --wasm target/wasm32v1-none/release/pool.wasm \
  --source <identity> --network testnet \
  -- --admin <admin> \
  -- --token <USDC_testnet_address> \
  -- --verifier <VERIFIER_CONTRACT_ID> \
  -- --asp_membership <ASP_MEMBERSHIP_ID> \
  -- --asp_non_membership <ASP_NON_MEMBERSHIP_ID> \
  -- --maximum_deposit_amount 1000000000 \
  -- --levels 10
# → POOL_CONTRACT_ID kaydet
```

### Adım 4: Vault Contract'ı Deploy Et

```bash
cd stellar-vault
cargo build --release --target wasm32v1-none

stellar contract deploy \
  --wasm target/wasm32v1-none/release/stellar_vault.wasm \
  --source <identity> --network testnet

# Pool adresini set et
stellar contract invoke \
  --id <VAULT_CONTRACT_ID> \
  --source <identity> --network testnet \
  -- set_pool --pool <POOL_CONTRACT_ID>
```

### Adım 5: Vault'u Pool'a Deposit Et

```bash
# Vault Pool'a deposit yapar → UTXO oluşturulur
stellar contract invoke \
  --id <POOL_CONTRACT_ID> \
  --source <vault_signer> --network testnet \
  -- transact \
  --proof <deposit_proof> \
  --ext_data '{"recipient": "<POOL_ADDRESS>", "ext_amount": 10000000, ...}'
```

Frontend üzerinden de yapılabilir — "Fund Vault" butonu ile.

### Adım 6: Frontend'e WASM Prover'ları Ekle

```bash
# voteApproval.circom WASM (bizim circuit'imiz)
cp build/voteApproval.wasm frontend/public/zk-wasm/
cp build/voteApproval_final.zkey frontend/public/zk-wasm/

# transaction.circom WASM (Nethermind'den hazır)
cp stellar-private-payments/circuits/build/transaction.wasm frontend/public/zk-wasm/
cp stellar-private-payments/circuits/build/transaction_final.zkey frontend/public/zk-wasm/
```

---

## License Durumu

| Bileşen | License | Not |
|---|---|---|
| Çoğu source code | Apache 2.0 | ✅ Kullanılabilir, attribution gerekir |
| `circuits/build.rs` | LGPLv3 | ⚠️ Derlenmiş WASM'leri distribute edersek source'u paylaşmalıyız |
| Generated artifacts (WASM, zkey) | LGPLv3 | ⚠️ Frontend deploy'da source erişilebilir olmalı |

**Hackathon için sorun yok.** Production'da license compliance gerekir.

---

*İlgili: [Vault Contract](../contracts/VAULT_CONTRACT.md) | [ZK Circuits](../zk-circuits/CIRCUITS.md) | [Deployment](../deployment/DEPLOY.md)*
