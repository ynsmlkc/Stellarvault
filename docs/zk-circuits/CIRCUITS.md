# ZK Circuits

## Genel Bakış

Bu proje ZK-proof'u **üç katmanda** kullanır:

```
┌───────────────────────────────────────────────────────────────────────┐
│                        ZK KATMANLARI                                  │
│                                                                       │
│  Katman 1: Voter Identity Privacy (Private modda)                     │
│  ├─ Circuit: voteApproval.circom (Nethermind'dan adapte)             │
│  ├─ Gizlenen: Kimin onayladığı                                       │
│  ├─ Kanıtlanan: "Geçerli bir signer onay verdi" (kimlik gizli)       │
│  └─ Mekanizma: Merkle membership proof + nullifier                   │
│                                                                       │
│  Katman 2: Confidential Execution (Private modda)                     │
│  ├─ Circuit: transaction.circom (HAZIR, Nethermind)                   │
│  ├─ Gizlenen: amount (miktar) + recipient (alıcı)                    │
│  ├─ Kanıtlanan: balance invariant, UTXO sahipliği                     │
│  └─ Mekanizma: UTXO commitments + nullifiers + encrypted outputs     │
│                                                                       │
│  Katman 3: Transparent mod (ZK YOK)                                   │
│  ├─ Her şey açık: kim önerdi, kim onayladı, miktar, alıcı           │
│  └─ Gnosis Safe'in aynısı                                            │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Katman 1: Voter Identity Privacy

### voteApproval.circom

**Kaynak:** Nethermind'in `selectiveDisclosure.circom` circuit'inden adapte edilmiştir.

Signer'ın kimliğini gizleyerek "geçerli bir signer onay verdi" kanıtını üretir:

```circom
pragma circom 2.2.2;

include "./poseidon2/poseidon2_hash.circom";
include "./merkleProof.circom";
include "./keypair.circom";

/**
 * voteApproval.circom — ZK-proof ile gizli onay
 *
 * Kanıtlanan:
 *   1. "Ben bu vault'un geçerli bir signer'ıyım" (Merkle membership proof)
 *   2. "Bu TX'i onaylıyorum" (tx_hash circuit'e bağlı)
 *   3. "Daha önce bu TX'e oy vermedim" (nullifier unique)
 *
 * Gizli Kalan:
 *   - Hangi signer olduğu (privateKey circuit input, dışarı çıkmaz)
 *   - Signer'ın vault'daki index'i
 *
 * Public (chain'de görünen):
 *   - vaultId
 *   - txHash
 *   - signerRoot (Merkle root of signer commitments)
 *   - nullifier (double-vote engelleme — ama kimlik geri hesaplanamaz)
 */
template VoteApproval(levels) {
    /** PUBLIC INPUTS **/
    signal input vaultId;          // Vault identifier
    signal input txHash;           // Transaction hash being voted on
    signal input signerRoot;       // Merkle root of signer commitments
    signal input nullifier;        // Unique nullifier (prevents double-vote)

    /** PRIVATE INPUTS **/
    signal input signerPrivateKey;    // Signer'ın private key'i (GİZLİ)
    signal input signerBlinding;      // Commitment blinding factor (GİZLİ)
    signal input merklePathIndex;     // Merkle tree path index (GİZLİ)
    signal input merklePathElements[levels]; // Merkle proof path (GİZLİ)

    // Components
    component keypair = Keypair();
    component commitmentHasher = Poseidon2(3);
    component merkleProof = MerkleProof(levels);
    component nullifierHasher = Poseidon2(3);

    // 1. Keypair: privateKey → publicKey
    keypair.privateKey <== signerPrivateKey;

    // 2. Commitment: hash(publicKey, vaultId, blinding)
    //    Bu commitment signer'ın vault'daki "kayıtlı kimliği"
    commitmentHasher.inputs[0] <== keypair.publicKey;
    commitmentHasher.inputs[1] <== vaultId;
    commitmentHasher.inputs[2] <== signerBlinding;
    commitmentHasher.domainSeparation <== 0x03;  // Vote commitment domain

    // 3. Merkle Proof: bu commitment signer tree'de var
    merkleProof.leaf <== commitmentHasher.out;
    merkleProof.pathIndices <== merklePathIndex;
    for (var i = 0; i < levels; i++) {
        merkleProof.pathElements[i] <== merklePathElements[i];
    }
    // Root doğrulama — signer gerçekten bu vault'un üyesi
    signerRoot === merkleProof.root;

    // 4. Nullifier: hash(commitment, txHash)
    //    Aynı TX için iki kez oy kullanılamaz
    //    Farklı TX'ler için farklı nullifier → privacy korunur
    nullifierHasher.inputs[0] <== commitmentHasher.out;
    nullifierHasher.inputs[1] <== txHash;
    nullifierHasher.inputs[2] <== 0;
    nullifierHasher.domainSeparation <== 0x04;  // Vote nullifier domain

    nullifier === nullifierHasher.out;
}
```

### Signer Commitment Tree (Merkle Tree)

Her vault oluşturulduğunda signer'lar bir Merkle tree'ye kaydedilir:

```
                Root: 0xabc123...
               /              \
          Node AB           Node CD
         /      \           /      \
    Leaf A    Leaf B    Leaf C    Leaf D
    (S1)      (S2)      (S3)      (S4)

Leaf = Poseidon2(publicKey, vaultId, blinding)
```

- **publicKey:** Stellar hesabından alınır (Freighter wallet)
- **vaultId:** Vault'un benzersiz ID'si
- **blinding:** Rastgele 32-byte sayı (off-chain üretilir, signer'da kalır)
- **levels:** `ceil(log2(signer_count))` — 8 signer → 3 levels

### Nullifier Mekanizması

```
nullifier = Poseidon2(commitment, txHash, 0)
```

- Aynı signer + aynı TX → **aynı nullifier** (double-vote tespit edilir)
- Aynı signer + farklı TX → **farklı nullifier** (privacy korunur)
- Nullifier'dan signer kimliği **geri hesaplanamaz** (one-way hash)

### Proof Generation (Browser WASM)

```typescript
// lib/prover.ts — Voter identity proof

export async function generateVoteProof(params: {
  signerPrivateKey: Uint8Array;
  vaultId: bigint;
  txHash: Uint8Array;
  merkleProof: { pathElements: Uint8Array[]; pathIndex: number; root: Uint8Array };
  blinding: Uint8Array;
}): Promise<{
  proof: Uint8Array;       // 256 byte Groth16 proof
  publicInputs: string[];  // [vaultId, txHash, signerRoot, nullifier]
  nullifier: Uint8Array;
}> {
  const circuitInputs = {
    vaultId: params.vaultId.toString(),
    txHash: bytesToFieldElement(params.txHash),
    signerRoot: bytesToFieldElement(params.merkleProof.root),
    signerPrivateKey: bytesToFieldElement(params.signerPrivateKey),
    signerBlinding: bytesToFieldElement(params.blinding),
    merklePathIndex: params.merkleProof.pathIndex,
    merklePathElements: params.merkleProof.pathElements.map(bytesToFieldElement),
  };

  const { proof, publicSignals } = await snarkjs.groth16.prove(
    '/zk-wasm/voteApproval.wasm',
    '/zk-wasm/voteApproval_final.zkey',
    circuitInputs
  );

  return {
    proof: proofToBytes(proof),
    publicInputs: publicSignals,
    nullifier: hexToBytes(publicSignals[3]),
  };
}
```

### Contract Tarafında Verify

```rust
// vault.rs — approve_zk() içinde:
let verifier = Self::get_verifier(&env)?;
let verifier_client = CircomGroth16VerifierClient::new(&env, &verifier);
let is_valid = verifier_client.verify(&zk_approval.proof, &zk_approval.public_inputs)?;
if !is_valid {
    return Err(Error::InvalidProof);
}
// Nullifier kaydet → double-vote engelle
// Approval count artır → kimlik YOK, sadece count
```

---

## Katman 2: Confidential Execution (Nethermind Pool)

### transaction.circom — Ana Circuit

**Kaynak:** `Nethermind repo → circuits/src/transaction.circom` (HAZIR, değiştirmiyoruz)

Vault execute aşamasında Pool'un circuit'i kullanılır:

```
Vault execute() → Pool.transact(proof, ext_data, sender)
                    ↓
            Pool: Groth16 Verifier'a call
                    ↓
            transaction.circom proof verify
                    ↓
            Encrypted output → Merkle tree'ye ekle
```

### Pool'un Kanıtladıkları

| Kanıt | Açıklama |
|---|---|
| **UTXO sahipliği** | Input commitment'in owner'ıyım (privateKey biliyorum) |
| **Nullifier doğruluğu** | Doğru nullifier hesaplandı (double-spend önlendi) |
| **Merkle proof** | Input commitment tree'de mevcut |
| **Balance invariant** | Σinput = Σoutput (para kaybolmadı, yaratılmadı) |
| **Nullifier uniqueness** | Aynı nullifier bu TX'te tekrar yok |
| **extDataHash bağı** | Proof bu specific recipient + amount'a bağlı |

### Bizim Kullanım Senaryomuz

```
Private Execution Input'ları:

  Public (chain'de görünür):
  ├─ root = Pool Merkle tree root
  ├─ publicAmount = 0  ← TAMAMEN PRIVATE
  └─ extDataHash = hash(recipient, ext_amount, encrypted_outputs)

  Private (circuit içinde, gizli):
  ├─ inputNullifier = Vault'un Pool'daki UTXO nullifier'ı
  ├─ inAmount = Vault'un Pool bakiyesi
  ├─ inPrivateKey = Vault'un Pool private key'i
  ├─ outputCommitment[0] = Yeni encrypted output (alıcı + miktar gizli)
  ├─ outputCommitment[1] = Change UTXO (kalan bakiye)
  └─ outBlinding = Output blinding faktörleri

  Chain'de GİZLİ:
  ✗ Transfer miktarı (commitment içinde, blinding ile gizli)
  ✗ Alıcı adres (encrypted output'ta)
  ✗ Gönderen (nullifier owner'ı belli değil)
```

### Vault'un Pool'daki UTXO'su — Private Key Yönetimi

Vault bir contract — kendi Pool private key'i olmalı. Bu private key nasıl yönetilir?

**Çözüm: Deterministik Vault Key**

```
Vault Pool Private Key = hash(vault_id, shared_secret)

shared_secret: Vault oluşturulurken signer'lar arasında paylaşılır.
- Her signer bu key'i kendi frontend'inde hesaplayabilir
- Contract'ta saklanmaz (güvenlik)
- Proof generation için frontend'de kullanılır
```

Signer execute yapınca:
1. Frontend'de vault'un Pool private key'ini hesaplar
2. Bu key ile Pool proof'unu üretir (snarkjs WASM)
3. Proof + ext_data → Vault.execute() → Pool.transact()

---

## Katman 3: Transparent Mod (ZK YOK)

Gnosis Safe'in aynısı. ZK-proof yok:

```
propose_transaction(target, amount, private_mode=false)
  → TX önerilir, detaylar açıkta

approve(vault_id, tx_id)
  → Signer onaylar, kimlik görünür
  → ApprovalEvent(vault_id, tx_id, signer: "GABC...")

execute(vault_id, tx_id)
  → Normal Stellar token transfer
  → TransactionExecutedEvent(target, amount açıkta)
```

---

## Mod Karşılaştırması

| | Transparent | Private (ZK) |
|---|---|---|
| **Kim önerdi** | ✅ Görünür | ✅ Görünür |
| **Kim onayladı** | ✅ Görünür | 🔒 GİZLİ (voteApproval.circom) |
| **Miktar** | ✅ Açıkta | 🔒 GİZLİ (transaction.circom) |
| **Alıcı** | ✅ Açıkta | 🔒 GİZLİ (encrypted output) |
| **Approval mekanizması** | approve() | approve_zk() |
| **Execution** | Normal transfer | Pool.transact() |
| **Gas** | ~$0.002 | ~$0.016 |
| **Proof generation** | Yok | Browser WASM (~5-15s) |

---

## Circuit Build Süreci

### voteApproval.circom (Kendi Circuit'imiz)

```bash
# Compile
circom voteApproval.circom --wasm --r1cs --output ./build/

# Setup
snarkjs groth16 setup build/voteApproval.r1cs pot12_final.ptau build/voteApproval_final.zkey

# Verification key
snarkjs zkey export verificationkey build/voteApproval_final.zkey build/voteApproval_vk.json
```

### transaction.circom (Nethermind — Hazır)

```bash
# Nethermind repo'dan WASM dosyalarını al
cp stellar-private-payments/circuits/build/transaction.wasm frontend/public/zk-wasm/
cp stellar-private-payments/circuits/build/transaction_final.zkey frontend/public/zk-wasm/

# Verification key (hazır)
ls stellar-private-payments/deployments/testnet/circuit_keys/policy_tx_2_2_vk.json
```

---

## Fallback Planı

### voteApproval.circom çalışmazsa → Soft Voter Privacy

```
Event'te signer emit etme:
  ApprovalEvent(vault_id, tx_id)  ← signer YOK
  Sadece approval_count görünür

Storage'da signer kayıtlı (contract doğrulama için)
ama dış gözlemciler event stream'de göremez
```

### Pool transact() çalışmazsa → Transparent Execution

```
execute() → Normal Stellar token transfer
Amount + recipient açıkta
Ama voter privacy (soft) çalışmaya devam eder
```

---

*İlgili: [Vault Contract](../contracts/VAULT_CONTRACT.md) | [Nethermind Entegrasyonu](../nethermind/INTEGRATION.md)*
