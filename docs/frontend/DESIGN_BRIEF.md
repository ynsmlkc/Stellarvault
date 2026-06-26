# Stellar Vault — Frontend Design Brief

> Bu doküman Claude Design'a (veya herhangi bir tasarım aracına) yapıştırılmak için hazırlandı.
> Amaç: aşağıdaki ürünün web dApp arayüzü için güçlü, modern ve **birebir uygulanabilir** bir tasarım üretmek.

---

## 1. Ürün Tek Cümlede

**Stellar Vault** — Stellar/Soroban üzerinde çalışan çoklu-imzalı (multi-sig) hazine cüzdanı. "Gnosis Safe'in Stellar versiyonu" — ama bir farkı var: her işlem **Transparent** (şeffaf, herkes görür) veya **Private (ZK)** modda yapılabilir. Private modda *kimin onayladığı, ne kadar ve kime gönderildiği* sıfır-bilgi (zero-knowledge) kriptografiyle gizlenir.

## 2. Asıl Sahnelenmesi Gereken Fikir (tasarımın kalbi)

İki mod arasındaki **karşıtlık** ürünün ruhu. Tasarım bu zıtlığı görsel olarak hissettirmeli:

| | **Transparent Mod** | **Private (ZK) Mod** |
|---|---|---|
| Kim önerdi | Görünür | Görünür |
| Kim onayladı | ✅ Açık (Alice, Bob...) | 🔒 Gizli (sadece "3 geçerli imza") |
| Miktar | ✅ Açık (1000 XLM) | 🔒 Gizli |
| Alıcı | ✅ Açık (GXYZ...) | 🔒 Gizli |
| Görsel his | Açık, net, "klasik banka dekontu" | Şifreli, kilitli, "kasadan çıkan buğulu cam" |

> **Not:** Renkler aşağıdaki "Vault Gold" paletiyle yapılır (bkz. Bölüm 3). MOR YOK.
> - **Transparent** = altın **canlı/parlak**, içerik net ve açıkta, aydınlık yüzeyler.
> - **Private (ZK)** = altın **kısık**, içerik **blur'lu**, monokrom + kilit ikonları + nullifier hash rozetleri ("buğulu cam" hissi).
> Yani zıtlık mavi-vs-mor değil; **parlak/net altın (transparent) ↔ kısık/buğulu koyu (private)**.

## 3. Hedef Kullanıcı & Ton

- DAO'lar, kripto ekipleri, ortak hazine yöneten 3-7 kişilik gruplar.
- Teknik ama estetik bekleyen Web3 kullanıcısı.
- Ton: **üst düzey, sinematik, "award-winning" (Awwwards/Linear ligi).** Premium fintech + gizlilik teması. Stripe netliği + dramatik, dolu hero estetiği.
- Karanlık tema öncelikli (dark-mode-first), açık tema opsiyonel.

### 🚫 Kaçınılması GEREKENLER (çok önemli — "AI yapımı belli olmasın")
- **MOR / VIOLET / INDIGO YASAK.** Hiçbir yerde mor gradient kullanma. (Tipik AI-default palet bu, ondan kesinlikle uzak dur.)
- **Klişe "scroll'la fade-in olan" şablon landing yok.** Herkesin yaptığı uzun, jenerik, aşağı akan animasyon maratonundan kaçın.
- Jenerik glassmorphism + mor neon + "futuristic" stok görünümünden uzak dur.
- Hedef: gerçekten elle tasarlanmış, profesyonel, **şablon gibi durmayan** bir his.

### 🎨 Renk Paleti — "Vault Gold" (sabit, bu kullanılacak)
| Rol | Renk | Not |
|---|---|---|
| Zemin | `#0A0A0B` | neredeyse-siyah, sinematik |
| Yüzey/kart | `#141414` – `#1B1A18` | hafif sıcak koyu gri |
| Metin (ana) | `#ECE7DD` | sıcak kırık-beyaz |
| Metin (ikincil) | `#8A857B` | soluk warm gray |
| **Accent** | `#C9A86A` | **şampanya/bronz altın** — CTA, vurgular, aktif durum |
| Accent hover | `#DCC089` | açık altın |
| Başarı/transfer | `#7FB069` veya altının kendisi | yeşili az kullan |
| Hata | `#C45D4A` | toprak kırmızısı (parlak kırmızı değil) |

- **Transparent mod** = altın canlı/parlak, net, aydınlık yüzeyler.
- **Private (ZK) mod** = altın kısılır, içerik blur'lanır, kilit ikonları, monokrom + nullifier hash rozetleri. Aynı palet, "kısık/buğulu" varyant.
- Tipografi: güçlü, kalın bir display font (hero için) + temiz bir sans (gövde için). Geniş başlıklar, cömert boşluk.

## 4. Ekranlar (sayfalar)

### 4.1 Landing / Intro (PROJE TANITIM SAYFASI — ilk açılan ekran)
Bu sayfa **direkt uygulamaya girmez**; önce projeyi tanıtır, sonra kullanıcı "Get Started" ile asıl uygulamaya geçer.
- **Sağ üstte "Get Started ↗" butonu** (altın) — tıklanınca uygulamaya (connect/dashboard) geçer. Sol üstte logo/marka adı.
- **Hero (tek güçlü ekran):** sinematik, dolu, dramatik. Büyük display başlık (örn. *"The first confidential multi-sig treasury on Stellar"*) + tek cümle alt-açıklama + ikincil "Get Started" CTA. Arka plan: koyu, derin, hareketli ama abartısız (örn. ince ışık, vault/grid dokusu — mor değil, altın/sıcak ışık).
- **TEK destekleyici bölüm (opsiyonel, kısa):** Transparent vs Private karşıtlığını gösteren yan yana iki kart/görsel. "Aynı güvenlik, farklı gizlilik." Uzun scroll yok — en fazla bir-iki vurucu bölüm.
- His: Awwwards seviyesi, şablon değil, "elle yapılmış" premium. Klişe scroll-fade animasyonlarından kaçın; varsa animasyon ince ve amaçlı olsun (hero'da hafif paralaks/ışık gibi).

### 4.1b Connect (Get Started sonrası)
- "Connect Wallet" (Freighter) — sade, net.
- Cüzdan bağlanınca dashboard'a geç.

### 4.2 Dashboard (cüzdan bağlıyken ana ekran)
- Kullanıcının üyesi olduğu vault'ların listesi (kart grid).
- Her kart: vault adı/id, signer sayısı, threshold (örn "2 / 3"), toplam bakiye, bekleyen işlem sayısı.
- "Create New Vault" CTA.

### 4.3 Create Vault (vault oluştur)
- Form: signer adresleri (ekle/çıkar, dinamik liste), threshold seçici (m / n slider veya stepper).
- Canlı özet: "3 signer'dan 2'si onaylamalı."
- Submit → wallet imza → on-chain create.

### 4.4 Vault Detail (asıl çalışma ekranı — EN ÖNEMLİ)
Üç bölüm:
1. **Header:** vault id, bakiye (XLM), signer avatarları, threshold rozeti, "Deposit" + "New Transaction" butonları.
2. **Signers paneli:** signer listesi, owner işareti, ekle/çıkar (sadece owner).
3. **İşlemler listesi:** bekleyen + geçmiş işlemler. Her işlem bir kart/satır:
   - **Transparent TX kartı:** proposer, alıcı (GXYZ...), miktar, onay ilerlemesi (örn "●●○ 2/3"), kimlerin onayladığı (avatarlar). Aksiyon: Approve / Execute.
   - **Private TX kartı:** proposer görünür AMA miktar/alıcı **blur'lu + 🔒**, onaylar "🔒 2/3 — voter identities hidden", nullifier hash'leri rozet olarak. Execute sonrası "Confidential — amount & recipient hidden on-chain" etiketi + explorer linki.

### 4.5 Propose Transaction (yeni işlem önerme modal/sayfa)
- **ModeToggle** en üstte: `Transparent ⟷ Private` — büyük, belirgin, mod değişince formun görseli/teması değişsin.
- Alanlar: alıcı adresi, miktar, (token sabit: XLM şimdilik).
- Private seçiliyse: "Bu işlemde onaylayanların kimliği ve transfer detayları gizlenecek" uyarı kutusu + ZK rozeti.
- Submit → wallet imza.

### 4.6 Proof Generation (ZK overlay — Private mod için)
- Private approve/execute sırasında tarayıcıda ZK proof üretilirken gösterilecek tam-ekran/modal overlay.
- Aşamalı progress: "Witness hesaplanıyor → Proof üretiliyor (Groth16) → Zincire gönderiliyor."
- "Bu işlem ~birkaç saniye sürebilir, sekmeyi kapatma" mesajı. Şık bir loading animasyonu (kripto/partikül teması).

## 5. Tekrar Eden Bileşenler (component kütüphanesi)
- **ModeToggle** (Transparent/Private switch — imzası belirgin)
- **VaultCard** (dashboard grid)
- **TransactionRow / TransactionCard** (iki varyant: transparent & private)
- **ApprovalProgress** (●●○ threshold göstergesi)
- **SignerAvatar / SignerList**
- **VoterPrivacyBadge** ("🔒 identities hidden") & **ConfidentialBadge** ("🔒 amount & recipient hidden")
- **WalletButton** (connect / connected state — adres kısaltması + bakiye)
- **ProofProgressOverlay**
- **AmountDisplay** (private modda blur + reveal-on-hover yok, kalıcı gizli)
- **AddressPill** (kısaltılmış adres + kopyala + explorer linki)
- **EmptyState** (vault yok / işlem yok)
- **TxStatusToast** (gönderildi / başarılı / hata)

## 6. Önemli Durumlar (states — tasarlanması şart)
- Cüzdan bağlı değil
- Yükleniyor (skeleton)
- Boş (hiç vault / hiç işlem yok)
- İşlem onay bekliyor / threshold doldu (execute edilebilir) / execute edildi / iptal edildi
- ZK proof üretiliyor
- Hata (yetersiz bakiye, signer değil, zaten onaylandı, vb.)

## 7. Demo Senaryosu (tasarımın desteklemesi gereken akış)
Jüriye gösterilecek "side-by-side karşılaştırma" çok değerli olur:
- Aynı vault, aynı threshold, iki işlem yan yana: biri Transparent (her şey açık), biri Private (her şey kilitli).
- "Aynı güvenlik, farklı gizlilik" mesajını veren bir karşılaştırma ekranı/bölümü.

## 8. Teknik Kısıtlar (tasarımın uygulanabilir olması için)
- **Next.js 14 (App Router) + React + TailwindCSS** ile kodlanacak. Tailwind ile yapılabilir token/spacing/komponentler tercih edilsin.
- Cüzdan: **Freighter** (Stellar Wallets Kit olabilir).
- Veri kaynağı: testnet Soroban contract (canlı, deploy edilmiş — aşağıda).
- shadcn/ui benzeri component yapısı uyumlu olur (ama şart değil).
- Mobil uyumlu (responsive) olmalı; ama öncelik masaüstü demo.

## 9. Canlı Veri / Gerçeklik Çapaları
- Network: **Stellar Testnet**
- Vault contract: `CDSIBLZ3LQ5CEXKPWQNE5IWAMVNDYAYNMSLB4ECXTRQAQYLEZWF42YKM`
- Token: XLM (SAC) `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`
- Mevcut çalışan akış (CLI'da kanıtlandı): create_vault → set_token → fund → propose → approve(×threshold) → execute. Transparent transfer testnet'te gerçekten para taşıdı.
- Contract fonksiyonları (UI'ın bağlanacağı): `create_vault, add_signer, remove_signer, set_threshold, propose_transaction(private_mode bool), approve, approve_zk, execute, cancel, get_vault, get_proposal_fn, is_signer, deposit/fund`.

## 10. İstenen Çıktı (design tool'dan)
- Tüm ekranların yüksek kaliteli görsel tasarımı (dark-mode öncelikli).
- Net bir tasarım sistemi: renk paleti (Transparent vs Private temaları dahil), tipografi, spacing, component görünümleri.
- Özellikle **Vault Detail** ve **Propose (ModeToggle)** ekranları detaylı.
- Mümkünse component'lerin state varyantları.
- İmplementasyona uygun: Tailwind'le kurulabilecek düzenler, gerçekçi boşluklar/ölçüler.
