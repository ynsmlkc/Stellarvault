# Stellar Vault — ZK-Powered Multi-Sig Treasury

> **Stellar Hacks ZK Hackathon**
>
> "Gnosis Safe'in Stellar versiyonu — ama oylama ve transfer gizli olabiliyor. Nethermind Privacy Pool + ZK voter identity üzerine inşa edildi."

---

## Dokümantasyon Haritası

| Doküman | Açıklama |
|---|---|
| [📄 Smart Contract — Vault](contracts/VAULT_CONTRACT.md) | Soroban multi-sig vault: signer yönetimi, dual-mode (Transparent/Private), confidential execution |
| [📄 Frontend Mimarisi](frontend/FRONTEND.md) | Next.js dApp: vault dashboard, dual-mode UI, proof generation |
| [📄 Nethermind Entegrasyonu](nethermind/INTEGRATION.md) | Pool contract + Groth16 Verifier + ASP dummy deploy |
| [📄 ZK Circuits](zk-circuits/CIRCUITS.md) | 3 katman: (1) Voter identity privacy (2) Confidential execution (3) Transparent (ZK yok) |
| [📄 Deployment Rehberi](deployment/DEPLOY.md) | Verifier → ASP → Pool → Vault → Frontend deploy sırası |
| [📄 Hackathon Planı](hackathon/HACKATHON_PLAN.md) | Çarşamba→Pazar timeline, jüri pitch senaryosu |

---

## Proje Özeti

### Problem
Ethereum'da Gnosis Safe, DAO'lar ve ekipler için çoklu imzalı (m/n) fon yönetimini standart hale getirdi. Stellar ekosisteminde bu araç yok. Üstüne, tüm fon hareketleri şeffaf — kimin ne zaman ne kadar gönderdiği herkes tarafından görünüyor.

### Çözüm
Soroban akıllı sözleşmeleri üzerine inşa edilmiş multi-sig cüzdan platformu. **İnitator mod seçer:**

| Mod | Kim önerdi? | Kim onayladı? | Amount | Recipient |
|---|---|---|---|---|
| **Transparent** | ✅ Görünür | ✅ Görünür | ✅ Açıkta | ✅ Açıkta |
| **Private (ZK)** | ✅ Görünür | 🔒 **GİZLİ** | 🔒 **GİZLİ** | 🔒 **GİZLİ** |

### İki ZK Katmanı (Private modda)

| Katman | Ne Gizler | Nasıl |
|---|---|---|
| **1. Voter Identity** | Kimin onayladığı | voteApproval.circom — ZK proof ile "geçerli signer onayladı" ama kim olduğu gizli |
| **2. Confidential Execution** | Amount + Recipient | Nethermind Pool — UTXO commitments + encrypted outputs + ZK balance proof |

### Sistem Mimarisi

```
┌─────────────────────────────────────────────────────────────────────┐
│                         STELLAR VAULT dApp                          │
│                                                                     │
│  ┌─────────────────┐     ┌──────────────────────────────────────┐  │
│  │   Frontend      │────▶│  Stellar Network (Soroban + L1)     │  │
│  │   Next.js       │     │                                      │  │
│  │   Freighter     │     │  ┌──────────────┐  ┌──────────────┐ │  │
│  └─────────────────┘     │  │ Vault        │  │ Nethermind   │ │  │
│                           │  │ Contract     │─▶│ Pool         │ │  │
│                           │  │ (SENİN)      │  │ Contract     │ │  │
│                           │  │              │  │ (confidential│ │  │
│                           │  │ Dual-mode    │  │  execution)  │ │  │
│                           │  └──────────────┘  └──────────────┘ │  │
│                           └──────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Teknoloji Yığını

| Katman | Teknoloji | Not |
|---|---|---|
| Smart Contract | Rust + Soroban SDK 23.x | Stellar'ın resmi SDK |
| Voter Privacy | Circom 2.2.2 (voteApproval) | selectiveDisclosure'dan adapte |
| Confidential TX | Nethermind Pool contract | UTXO + ZK + encrypted outputs |
| ZK Verifier | Soroban BN254 precompile | CAP-0059, native |
| Proof Generation | snarkjs + WASM | Browser-side (2 circuit) |
| Frontend | Next.js 14 + React 19 | App Router, Tailwind |
| Wallet | Freighter + Wallet Standard | Stellar ecosystem standardı |
| SDK | @stellar/stellar-sdk v10+ | Soroban support |
| Hosting | Vercel | Hackathon deploy |

---

## End-to-End Akış Özeti

### Transparent Mod (Gnosis Safe)
```
İnitator: Transparent seçer
→ TX öner (public) → Signer'lar approve eder (kimler görünür)
→ Threshold dolunca execute → Normal Stellar transfer
→ Herkes her şeyi görür
```

### Private (ZK) Mod
```
İnitator: Private seçer
→ TX öner (detay signer'lar için) → Signer'lar approve_zk() ile onaylar
→ (kimler GİZLİ — ZK proof ile "geçerli signer onayladı")
→ Threshold dolunca execute → Pool.transact() ile confidential transfer
→ Chain'de: ZK proof + encrypted output (amount + recipient GİZLİ)
→ Dış gözlemci: "TX oldu ama kime, ne kadar, kim onayladı — bilinmiyor"
```

---

*Son güncelleme: 2026-06-25*
