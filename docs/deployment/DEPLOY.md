# Deployment Rehberi

## Genel Bakış

5 adım — sıralama **zorunlu:**

```
1. Nethermind Groth16 Verifier → Soroban testnet
   ↓
2. Dummy ASP Contract'ları → Soroban testnet (Pool bağımlılığı)
   ↓
3. Nethermind Pool Contract → Soroban testnet
   ↓
4. Vault Contract → Soroban testnet (Pool adresi ile)
   ↓
5. Frontend (Next.js) → Vercel (2 WASM dosyası ile)
```

---

## Ön Gereksinimler

### Stellar CLI + Rust

```bash
cargo install --locked stellar-cli
rustup target add wasm32v1-none
```

### Identity

```bash
stellar keys generate deployer --network testnet --fund
```

Bu komut yeni keypair oluşturur ve Friendbot'dan 10.000 test XLM gönderir.

### Mevcut Key Kullanma

```bash
# Mevcut Freighter hesabını ekle (secret key ile)
stellar keys add <identity-name> --secret-key <SC...>
```

### Nethermind Repo

```bash
git clone https://github.com/NethermindEth/stellar-private-payments.git
cd stellar-private-payments
```

---

## Adım 1: Nethermind Groth16 Verifier Deploy

```bash
cd stellar-private-payments
export VERIFIER_VK_JSON=deployments/testnet/circuit_keys/policy_tx_2_2_vk.json

cargo build -p circom-groth16-verifier --release --target wasm32v1-none

stellar contract deploy \
  --wasm target/wasm32v1-none/release/circom_groth16_verifier.wasm \
  --source <identity-name> \
  --network testnet \
  --inclusion-fee 1000000
```

**→ `VERIFIER_CONTRACT_ID` kaydet**

---

## Adım 2: Dummy ASP Contract'ları Deploy

Pool deploy için ASP'ler zorunlu bağımlılık. Dummy (boş tree) deploy ediyoruz.

### ASP Membership

```bash
cargo build -p asp-membership --release --target wasm32v1-none

stellar contract deploy \
  --wasm target/wasm32v1-none/release/asp_membership.wasm \
  --source <identity-name> --network testnet \
  -- --admin <admin-address> --levels 1
```

**→ `ASP_MEMBERSHIP_ID` kaydet**

### ASP Non-Membership

```bash
cargo build -p asp-non-membership --release --target wasm32v1-none

stellar contract deploy \
  --wasm target/wasm32v1-none/release/asp_non_membership.wasm \
  --source <identity-name> --network testnet \
  --inclusion-fee 1000000 \
  -- --admin <admin-address>
```

**→ `ASP_NON_MEMBERSHIP_ID` kaydet**

---

## Adım 3: Nethermind Pool Contract Deploy

```bash
cargo build -p pool --release --target wasm32v1-none

# Token olarak native XLM SAC kullan (testnet'te hazır)
TOKEN="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"

# Veya custom SAC için:
# TOKEN=$(stellar contract asset deploy --asset "USDC:G..." --source-account <identity> --network testnet)

stellar contract deploy \
  --wasm target/wasm32v1-none/release/pool.wasm \
  --source <identity-name> \
  --network testnet \
  --inclusion-fee 1000000 \
  -- \
  --admin <admin-address> \
  --token $TOKEN \
  --verifier <VERIFIER_CONTRACT_ID> \
  --asp_membership <ASP_MEMBERSHIP_ID> \
  --asp_non_membership <ASP_NON_MEMBERSHIP_ID> \
  --maximum_deposit_amount 1000000000 \
  --levels 10
```

**→ `POOL_CONTRACT_ID` kaydet**

---

## Adım 4: Vault Contract Deploy

```bash
cd stellar-vault
cargo build --release --target wasm32v1-none

stellar contract deploy \
  --wasm target/wasm32v1-none/release/stellar_vault.wasm \
  --source <identity-name> \
  --network testnet \
  --inclusion-fee 1000000
```

**→ `VAULT_CONTRACT_ID` kaydet**

### Pool Adresini Set Et

```bash
stellar contract invoke \
  --id <VAULT_CONTRACT_ID> \
  --source <identity-name> \
  --network testnet \
  -- set_pool --pool <POOL_CONTRACT_ID>
```

### Vault'u Pool'a Deposit Et (UTXO Oluştur)

Vault'un Pool'da UTXO'su olmalı ki confidential transfer yapabilsin:

```bash
stellar contract invoke \
  --id <POOL_CONTRACT_ID> \
  --source <vault-signer> \
  --network testnet \
  -- transact \
  --proof <deposit_proof> \
  --ext_data '{"recipient": "<POOL_ADDRESS>", "ext_amount": 10000000, ...}'
```

Frontend üzerinden "Fund Vault" butonu ile de yapılabilir.

---

## Adım 5: Frontend Deploy

### WASM Dosyalarını Kopyala

```bash
# voteApproval.wasm (bizim circuit'imiz)
cp build/voteApproval.wasm frontend/public/zk-wasm/
cp build/voteApproval_final.zkey frontend/public/zk-wasm/

# transaction.wasm (Nethermind'den)
cp stellar-private-payments/circuits/build/transaction.wasm \
   frontend/public/zk-wasm/
cp stellar-private-payments/circuits/build/transaction_final.zkey \
   frontend/public/zk-wasm/
```

### Environment Variables

```env
# .env.local
NEXT_PUBLIC_VAULT_CONTRACT_ID=CA1...
NEXT_PUBLIC_POOL_CONTRACT_ID=CB2...
NEXT_PUBLIC_VERIFIER_CONTRACT_ID=CC3...
NEXT_PUBLIC_NETWORK=testnet
NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org
```

### Build + Deploy

```bash
cd frontend
npm install
npm run build
vercel --prod
```

---

## Testnet Token

```bash
stellar keys fund --identity <identity-name> --network testnet
# veya
curl "https://friendbot.stellar.org?addr=<YOUR_ADDRESS>"
```

---

## Deployment Checklist

### Nethermind
- [ ] Verifier build + deploy → `VERIFIER_CONTRACT_ID`
- [ ] ASP Membership deploy (dummy) → `ASP_MEMBERSHIP_ID`
- [ ] ASP Non-Membership deploy (dummy) → `ASP_NON_MEMBERSHIP_ID`
- [ ] Pool build + deploy → `POOL_CONTRACT_ID`

### Vault
- [ ] Build başarılı
- [ ] Deploy → `VAULT_CONTRACT_ID`
- [ ] Pool adresi set edildi
- [ ] Vault → Pool deposit yapıldı (UTXO oluşturuldu)

### Frontend
- [ ] Environment variables (vault + pool + verifier adresleri)
- [ ] WASM dosyaları erişilebilir (2 circuit × 2 dosya = 4 dosya)
- [ ] Build başarılı
- [ ] Vercel'e deploy edildi

### E2E Test
- [ ] Vault oluşturulabiliyor
- [ ] Transparent TX: propose → approve → execute
- [ ] Private TX: propose → approve_zk → execute (confidential)
- [ ] Chain'de private TX amount + recipient görünmüyor

---

## Troubleshooting

| Sorun | Çözüm |
|---|---|
| `wasm32v1-none target not found` | `rustup target add wasm32v1-none` |
| `VERIFIER_VK_JSON not set` | `export VERIFIER_VK_JSON=...` |
| `Pool deploy failed` | ASP'leri önce deploy et |
| `WASM load failed` | `public/zk-wasm/` dizinini kontrol et (4 dosya olmalı) |
| `Gas limit exceeded` | `--inclusion-fee` parametresini artır |
| `Insufficient funds` | Friendbot'dan XLM al |

---

---

## Mevcut Deploy Edilmiş Contract'lar (2026-06-25)

Bu contract'lar testnet'e deploy edildi ve çalışıyor.

| Contract | Adres | Explorer |
|---|---|---|
| **Verifier** | `CDRMXX3O74B7S6UV47A6JRSUUUGQ6OYWG2NYDHJKZY4PTULZN7GAKL6V` | [link](https://stellar.expert/explorer/testnet/contract/CDRMXX3O74B7S6UV47A6JRSUUUGQ6OYWG2NYDHJKZY4PTULZN7GAKL6V) |
| **ASP Membership** | `CA4N4LFE6EMPPHORRLJJGP3UDV2ENDFIWI3ZBA4GY6LFYJOB7GSEGJBD` | [link](https://stellar.expert/explorer/testnet/contract/CA4N4LFE6EMPPHORRLJJGP3UDV2ENDFIWI3ZBA4GY6LFYJOB7GSEGJBD) |
| **ASP Non-Membership** | `CBWCSODWHCUFTO5SSHFGECRY4Z7SQCY5EFPOE375SUXNTEKWWUUP6UOM` | [link](https://stellar.expert/explorer/testnet/contract/CBWCSODWHCUFTO5SSHFGECRY4Z7SQCY5EFPOE375SUXNTEKWWUUP6UOM) |
| **Pool** | `CCQRXA6UMVSPKRZDYGVS2G3E67INXML7EX5NZVFGC66E3FLJEGA5VTHY` | [link](https://stellar.expert/explorer/testnet/contract/CCQRXA6UMVSPKRZDYGVS2G3E67INXML7EX5NZVFGC66E3FLJEGA5VTHY) |
| **Token (XLM SAC)** | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | [link](https://stellar.expert/explorer/testnet/contract/CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC) |

**Deployer Account:** `GAEAII4H4RJOMCMJTVKUH5ZEJVAVT5CRFSRMMUZPNJG6BCYL7X2BOBUH`

---

*İlgili: [Vault Contract](../contracts/VAULT_CONTRACT.md) | [Nethermind Entegrasyonu](../nethermind/INTEGRATION.md)*
