# Hackathon Planı

## Genel Bakış

Stellar Hacks ZK Hackathon — Çarşamba başlıyor, Pazar akşamı teslim. ~4.5 gün.

**Strateji:** 2 ZK circuit + Soroban vault:
1. **voteApproval.circom** — Voter identity privacy (bizim circuit'imiz)
2. **transaction.circom** — Confidential execution (Nethermind, hazır)

Kendi circuit'imizi sıfırdan yazmıyoruz — Nethermind altyapısını adapte ediyoruz.

---

## Timeline

### Çarşamba (Bugün) — Nethermind Setup + Vault Scaffold

| Saat | Görev | Çıktı |
|---|---|---|
| 10:00-12:00 | Nethermind repo clone, build env setup | Build ortamı hazır |
| 12:00-14:00 | Verifier build + testnet deploy | `VERIFIER_CONTRACT_ID` |
| 14:00-16:00 | Dummy ASP'ler deploy (empty tree) | `ASP_MEMBERSHIP_ID`, `ASP_NON_MEMBERSHIP_ID` |
| 16:00-18:00 | Pool build + deploy denemesi | `POOL_CONTRACT_ID` |
| 18:00-20:00 | Vault contract scaffold + VaultConfig, signer mgmt | `stellar-vault/` compile ediyor |
| 20:00-22:00 | Vault: propose_transaction (dual-mode: private_mode bool) | TX queue + mode seçimi |
| 22:00-23:00 | Vault: approve (transparent) | On-chain approve çalışıyor |

**Gün sonu:** Verifier + ASP + Pool deploy denemesi yapıldı. Vault temel logic compile ediyor.

---

### Perşembe — Frontend + Transparent Akış

| Saat | Görev | Çıktı |
|---|---|---|
| 09:00-11:00 | Next.js scaffold, Freighter wallet bağlantısı | Wallet connect çalışıyor |
| 11:00-13:00 | Vault oluşturma UI, signer ekleme | Create vault sayfası |
| 13:00-15:00 | TX önerme UI — ModeToggle (Transparent ↔ Private) | Propose formu + mode seçici |
| 15:00-17:00 | Pending TX listesi — dual-mode gösterim | TransactionList (2 tip TX) |
| 17:00-19:00 | Transparent approve akışı | approve() TX gönderimi |
| 19:00-21:00 | Transparent execute (normal token transfer) | Tam transparent akış çalışıyor |
| 21:00-23:00 | Dashboard + Vault detail polish | UI düzgün |

**Gün sonu:** **Transparent multi-sig tam çalışır.** Vault oluştur → TX öner → approve → execute. Gnosis Safe'in aynısı.

---

### Cuma — ZK Circuits + Private Voting 🔴 KRİTİK GÜN

| Saat | Görev | Çıktı |
|---|---|---|
| 09:00-11:00 | voteApproval.circom yazımı (selectiveDisclosure'dan adapte) | Circuit .circom dosyası |
| 11:00-13:00 | voteApproval compile → WASM + zkey | `voteApproval.wasm` + `.zkey` |
| 13:00-15:00 | Nethermind transaction.wasm + zkey → frontend'e kopyala | 4 WASM dosyası `public/zk-wasm/` |
| 15:00-17:00 | Vault: approve_zk() — Groth16 Verifier cross-call | approve_zk() Soroban'da |
| 17:00-19:00 | Frontend: Voter identity proof generation (WASM) | Browser'da vote proof üretiliyor |
| 19:00-21:00 | Vault: execute() → Pool.transact() entegrasyonu | Confidential execution |
| 21:00-23:00 | Frontend: Pool execution proof generation | Browser'da pool proof üretiliyor |

**Gün sonu:** Private akış çalışıyor. approve_zk() → voter identity gizli. execute() → Pool.confidential → amount+recipient gizli.

**🔴 Risk:** 2 circuit entegrasyonu. Öğleye kadar voteApproval POC, akşama Pool POC yapılmalı.

---

### Cumartesi — Demo + Polish

| Saat | Görev | Çıktı |
|---|---|---|
| 09:00-12:00 | Karşılaştırmalı demo ekranı (transparent vs private side-by-side) | Jüriye gösterilecek ekran |
| 12:00-15:00 | ModeToggle, VoterPrivacyBadge, ConfidentialBadge | UI elemanları |
| 15:00-18:00 | Proof generation progress indicator (2 tip proof) | Kullanıcı süreci görür |
| 18:00-21:00 | End-to-end test, bug fix, gas cost gösterimi | Her şey stabil |
| 21:00-23:00 | Demo provası, video kaydı | Demo videosu hazır |

**Gün sonu:** Tam çalışan demo. İki mod yan yana. Jüriye gösterime hazır.

---

### Pazar — Submit

| Saat | Görev | Çıktı |
|---|---|---|
| 09:00-12:00 | README, DoraHacks submission form | Draft submission |
| 12:00-15:00 | Son bug fix'ler, final test | Stabil build |
| 15:00-18:00 | Demo video final, pitchdeck | Final assets |
| 18:00 | **SUBMIT** 🚀 | Hackathon'a gönderildi |

---

## Jüri Sunum Senaryosu

### Pitch (30 saniye)

> *"Stellar'da Gnosis Safe yok. Biz yaptık — ama çok daha fazlası var. Gnosis Safe'de herkes her şeyi görür: kim önerdi, kim onayladı, kime, ne kadar gitti. Stellar Vault'ta initator seçer: Transparent veya Private. Private modda 4 şey gizlenir: kimin onayladığı ZK-proof ile gizli, miktar gizli, alıcı gizli. Sadece ZK-proof ve sonuç chain'de. Stellar'da ilk confidential multi-sig."*

### Demo Akışı (3 dakika)

| Adım | Süre | Ne Gösterilir |
|---|---|---|
| 1 | 10s | Vault oluştur (5 signer, 3/5) |
| 2 | 30s | **Transparent TX:** TX öner → 3 approve → execute. "Alice, Bob, Charlie onayladı. 1000 USDC → GXYZ..." |
| 3 | 60s | **Private TX:** TX öner (Private seçildi) → 3 approve_zk → "🔒 +3 approvals, voter identities hidden" |
| 4 | 40s | Execute → Confidential transfer. Chain explorer'da göster: "Sadece proof + encrypted output. Amount? Gizli. Recipient? Gizli." |
| 5 | 20s | "Aynı vault, aynı threshold — farklı gizlilik seviyesi. Stellar'da maliyet: $0.016 (ZK dahil)." |
| 6 | 20s | Roadmap: "Production audit, DeFi integration, mobile" |

---

## Risk Analizi

| Risk | Olasılık | Etki | Mitigasyon |
|---|---|---|---|
| **2 circuit entegrasyonu** | Orta | 🔴 Yüksek | Cuma öğleye kadar her iki circuit'in POC'unu yap |
| **Pool deploy (ASP bağımlılığı)** | Düşük | 🟡 Orta | Çarşamba ASP'leri dummy deploy et |
| **WASM proving browser'da** | Orta | 🟡 Orta | Nethermind'in WASM'ı hazır. Sadece adapter'la. |
| **Vault → Pool transact() call** | Orta | 🔴 Yüksek | Cuma akşamına kadar POC. Pool'un transact() interface'ini doğru kullan. |
| **Vault'un Pool private key'i** | Orta | 🔴 Yüksek | Deterministic key (hash vault_id + shared_secret). Frontend'de hesapla. |
| **Frontend wallet bağlantı** | Düşük | 🟢 Düşük | Perşembe bitmeden test et. |

---

## Fallback Planı

### Plan B: Voter Privacy Soft, Execution Transparent

```
approve_zk() yerine: approve() ama event'te signer emit etme
  → "Soft" voter privacy (event'te gizli, storage'da var)

execute(): Normal Stellar transfer (Pool yok)
  → Amount + recipient açıkta

Jüriye:
  "Transparent multi-sig tam çalışıyor.
  Voter privacy soft olarak aktif (event'te gizli).
  Confidential execution layer (Pool) entegrasyonu
  devam ediyor — circuit ve proving altyapısı hazır."
```

### Plan C: Sadece Transparent (Minimum Viable)

```
Tam transparent Gnosis Safe muadili çalışır.
Private mod WIP.

Jüriye:
  "Vault + approve + execute tam çalışıyor.
  Private mod (ZK voter identity + confidential execution)
  circuit level'da hazır, contract entegrasyonu devam ediyor."
```

---

## Scope Özeti

### ✅ Hackathon'da Yapılıyor

| Feature | Öncelik |
|---|---|
| Vault oluşturma + signer yönetimi | 🔴 P0 |
| TX öner + dual-mode (Transparent/Private) | 🔴 P0 |
| Transparent approve + execute | 🔴 P0 |
| voteApproval.circom + WASM | 🔴 P0 |
| approve_zk() + voter identity privacy | 🔴 P0 |
| Pool deploy + vault deposit (UTXO) | 🔴 P0 |
| Confidential execution (Pool.transact) | 🔴 P0 |
| Karşılaştırmalı demo ekranı | 🟡 P1 |

### ❌ Hackathon'da Yapılmıyor (Roadmap)

| Feature | Neden Değil |
|---|---|
| ASP gerçek kullanım | Sadece dummy deploy — production'da gerçek ASP |
| DeFi entegrasyon | Sonraki sprint |
| Mobile app | Sonraki sprint |
| Production audit | Hackathon sonrası |

---

## Demo Checklist

- [ ] Vault oluşturulabiliyor (5 signer, threshold 3/5)
- [ ] Transparent TX: propose → approve → execute
- [ ] Private TX: propose (private_mode=true)
- [ ] approve_zk() çalışıyor (voter identity gizli)
- [ ] ZKApprovalEvent emit ediliyor (nullifier, signer yok)
- [ ] Confidential execute çalışıyor (Pool.transact)
- [ ] Chain'de private TX: amount + recipient görünmüyor
- [ ] Dashboard: Transparent vs Private yan yana
- [ ] ModeToggle çalışıyor
- [ ] Proof generation progress gösteriliyor
- [ ] Gas cost görüntüleniyor
- [ ] README yazılmış
- [ ] Demo video kaydedilmiş
- [ ] DoraHacks submission formu doldurulmuş

---

*Son güncelleme: 2026-06-25*
