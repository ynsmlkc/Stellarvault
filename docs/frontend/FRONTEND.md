# Frontend Mimarisi

## Genel Bakış

Next.js (App Router) ile yazılmış dApp. Stellar'a doğrudan bağlanır, Freighter wallet kullanır, **iki ayrı ZK proof** üretir:
1. **Voter identity proof** — signer onayını gizler (approve_zk için)
2. **Pool execution proof** — amount + recipient'ı gizler (execute için)

**Backend yok.** Tüm işlemler Soroban contract'ları ve browser-side proving üzerinden yürür.

---

## Proje Yapısı

```
frontend/
├── app/
│   ├── page.tsx                  # Landing page
│   ├── dashboard/
│   │   └── page.tsx              # Ana dashboard (vault listesi)
│   ├── vault/
│   │   └── [vaultId]/
│   │       └── page.tsx          # Vault detay sayfası
│   ├── create-vault/
│   │   └── page.tsx              # Vault oluşturma formu
│   └── api/
│       └── prove/
│           └── route.ts          # (Opsiyonel) Server-side proving
├── components/
│   ├── WalletConnect.tsx         # Freighter wallet bağlantısı
│   ├── VaultCard.tsx             # Vault özet kartı
│   ├── TransactionList.tsx       # TX listesi (dual-mode)
│   ├── TransactionDetail.tsx     # TX detay + approve
│   ├── ModeToggle.tsx            # Transparent ↔ Private seçici
│   ├── ApprovalButton.tsx        # Approve / Approve (ZK)
│   ├── VoterPrivacyBadge.tsx     # "🔒 Voter identities hidden"
│   ├── ConfidentialBadge.tsx     # "🔒 Confidential transfer"
│   ├── ProofProgress.tsx         # ZK proof generation progress
│   └── VaultStats.tsx            # Vault istatistikleri
├── lib/
│   ├── stellar.ts                # Stellar SDK wrapper
│   ├── soroban.ts                # Soroban contract interactions
│   ├── prover.ts                 # ZK proof generation (2 circuit)
│   └── contracts/
│       ├── vault.ts              # Vault contract client (typed)
│       └── pool.ts               # Pool contract client (Nethermind)
├── hooks/
│   ├── useWallet.ts              # Freighter wallet hook
│   ├── useVault.ts               # Vault data fetcher
│   └── useProofGeneration.ts     # ZK proof state management
└── styles/
    └── globals.css               # Tailwind CSS
```

---

## Sayfa Mockupları — Dual Mode

### Transaction Önerme Formu

```
┌─────────────────────────────────────────┐
│  New Transaction — DAO Treasury         │
│                                         │
│  To: [GXYZ...2XKF              ]       │
│  Amount: [1000] USDC                    │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  Mode:                            │ │
│  │  ○ 📖 Transparent                 │ │
│  │     (Herkes her şeyi görür)       │ │
│  │                                   │ │
│  │  ● 🔒 Private (ZK)               │ │
│  │     Kim onayladı: GİZLİ           │ │
│  │     Amount: GİZLİ                 │ │
│  │     Recipient: GİZLİ              │ │
│  └───────────────────────────────────┘ │
│                                         │
│  [Submit Proposal]                      │
└─────────────────────────────────────────┘
```

### Vault Detail — Karşılaştırmalı Demo Ekranı

```
┌─────────────────────────────────────────────────────────────────┐
│  🏦 DAO Treasury                    Threshold: 3/5              │
│  Signers: 5                                                     │
│                                                                 │
│  ─── Pending Transactions ───                                   │
│                                                                 │
│  ┌────────────────────────┐    ┌────────────────────────────┐  │
│  │ TX #41  📖 Transparent │    │ TX #42  🔒 Private (ZK)    │  │
│  │                        │    │                            │  │
│  │ 1000 USDC              │    │ 🔒🔒 Confidential          │  │
│  │ → GXYZ...2XKF          │    │ → ████...████              │  │
│  │                        │    │                            │  │
│  │ 👍 Alice ✓             │    │ 🔒 +2 approvals received   │  │
│  │ 👍 Bob ✓               │    │ 🔒 Voter identities hidden │  │
│  │ ⏳ Charlie             │    │                            │  │
│  │                        │    │ Approvals: ██████░░  2/3   │  │
│  │ 2/3 — Ready to execute │    │ 🔒 Confidential            │  │
│  │                        │    │                            │  │
│  │ [Execute]              │    │ [Execute 🔒 Confidential]  │  │
│  └────────────────────────┘    └────────────────────────────┘  │
│                                                                 │
│  ← Aynı vault logic, farklı gizlilik seviyesi →                │
└─────────────────────────────────────────────────────────────────┘
```

### Approve (Private/ZK) Akışı

```
┌─────────────────────────────────────────┐
│  TX #42 — 🔒 Private Transaction        │
│                                         │
│  (Signer connect edince detay açılır:)  │
│  ─────────────────────────────────────  │
│  To:     GXYZ...2XKF                    │
│  Amount: 1,000 USDC                     │
│                                         │
│  Approvals: 2/3                         │
│  🔒 voter identities hidden             │
│                                         │
│  [Approve (Private — ZK proof)]         │
│                                         │
│  (Tıklayınca:)                          │
│  ┌───────────────────────────────────┐ │
│  │ ⏳ Voter identity proof... 67%    │ │
│  │ 🔒 Generating ZK proof...         │ │
│  └───────────────────────────────────┘ │
│  → ✅ Approval recorded (hidden)       │
│     Nullifier: 0x7f3a... (anonymous)  │
└─────────────────────────────────────────┘
```

### Execute (Confidential) Akışı

```
┌─────────────────────────────────────────┐
│  Executing TX #42 — Confidential        │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │ ⏳ Pool proof generating... 45%   │ │
│  │ 🔒 UTXO commitment...             │ │
│  │ 🔒 Balance invariant proof...     │ │
│  │ 🔒 Encrypting output...           │ │
│  └───────────────────────────────────┘ │
│  → ✅ Confidential transfer complete   │
│     Gas: $0.005 (ZK verify dahil)     │
│     Chain'de: proof + encrypted only  │
└─────────────────────────────────────────┘
```

---

## Stellar SDK Entegrasyonu

### lib/soroban.ts

```typescript
import {
  SorobanRpc,
  TransactionBuilder,
  Address,
  Networks,
  nativeToScVal,
  Contract,
} from "@stellar/stellar-sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";
const server = new SorobanRpc.Server(RPC_URL);

const VAULT_CONTRACT_ID = process.env.NEXT_PUBLIC_VAULT_CONTRACT_ID!;
const POOL_CONTRACT_ID = process.env.NEXT_PUBLIC_POOL_CONTRACT_ID!;

// ===== Vault Operations =====

export async function proposeTransaction(
  walletAddress: string,
  vaultId: bigint,
  target: string,
  amount: bigint,
  privateMode: boolean
): Promise<string> {
  const account = await server.getAccount(walletAddress);
  const contract = new Contract(VAULT_CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: "10000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        "propose_transaction",
        nativeToScVal(vaultId, { type: "u64" }),
        nativeToScVal(new Address(target), { type: "address" }),
        nativeToScVal(amount, { type: "i128" }),
        nativeToScVal(privateMode, { type: "bool" })
      )
    )
    .setTimeout(30)
    .build();

  const signedTx = await window.freighter.signTransaction(tx.toXDR());
  const sentTx = await server.sendTransaction(signedTx);
  return sentTx.hash;
}

export async function approve(
  walletAddress: string,
  vaultId: bigint,
  txId: bigint
): Promise<string> {
  const account = await server.getAccount(walletAddress);
  const contract = new Contract(VAULT_CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: "10000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        "approve",
        nativeToScVal(vaultId, { type: "u64" }),
        nativeToScVal(txId, { type: "u64" })
      )
    )
    .setTimeout(30)
    .build();

  const signedTx = await window.freighter.signTransaction(tx.toXDR());
  const sentTx = await server.sendTransaction(signedTx);
  return sentTx.hash;
}

export async function approveZK(
  walletAddress: string,
  vaultId: bigint,
  txId: bigint,
  zkApproval: {
    proof: Uint8Array;
    publicInputs: string[];
    nullifier: Uint8Array;
  }
): Promise<string> {
  const account = await server.getAccount(walletAddress);
  const contract = new Contract(VAULT_CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: "10000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        "approve_zk",
        nativeToScVal(vaultId, { type: "u64" }),
        nativeToScVal(txId, { type: "u64" }),
        nativeToScVal(zkApproval, {
          type: {
            tx_id: "u64",
            proof: "bytes",
            public_inputs: { type: "vec", value: "bytes" },
            nullifier: "u256",
          },
        })
      )
    )
    .setTimeout(30)
    .build();

  const signedTx = await window.freighter.signTransaction(tx.toXDR());
  const sentTx = await server.sendTransaction(signedTx);
  return sentTx.hash;
}

export async function execute(
  walletAddress: string,
  vaultId: bigint,
  txId: bigint
): Promise<string> {
  const account = await server.getAccount(walletAddress);
  const contract = new Contract(VAULT_CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: "10000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        "execute",
        nativeToScVal(vaultId, { type: "u64" }),
        nativeToScVal(txId, { type: "u64" })
      )
    )
    .setTimeout(30)
    .build();

  const signedTx = await window.freighter.signTransaction(tx.toXDR());
  const sentTx = await server.sendTransaction(signedTx);
  return sentTx.hash;
}
```

---

## ZK Proof Generation — İki Circuit

### lib/prover.ts

```typescript
// İki ayrı circuit:
// 1. voteApproval.wasm — Voter identity proof (approve_zk için)
// 2. transaction.wasm — Pool execution proof (confidential execute için)

import { initProver, generateProof } from "./zk-wasm";

let proverReady = false;

export async function initZKProver(): Promise<void> {
  if (!proverReady) {
    await initProver();
    proverReady = true;
  }
}

// === Voter Identity Proof (approve_zk) ===

export async function generateVoteProof(params: {
  signerPrivateKey: Uint8Array;
  vaultId: bigint;
  txHash: Uint8Array;
  merkleProof: { pathElements: Uint8Array[]; pathIndex: number; root: Uint8Array };
  blinding: Uint8Array;
}): Promise<{
  proof: Uint8Array;
  publicInputs: string[];
  nullifier: Uint8Array;
}> {
  if (!proverReady) await initZKProver();

  const { proof, publicSignals } = await snarkjs.groth16.prove(
    '/zk-wasm/voteApproval.wasm',
    '/zk-wasm/voteApproval_final.zkey',
    {
      vaultId: params.vaultId.toString(),
      txHash: bytesToFieldElement(params.txHash),
      signerRoot: bytesToFieldElement(params.merkleProof.root),
      signerPrivateKey: bytesToFieldElement(params.signerPrivateKey),
      signerBlinding: bytesToFieldElement(params.blinding),
      merklePathIndex: params.merkleProof.pathIndex,
      merklePathElements: params.merkleProof.pathElements.map(bytesToFieldElement),
    }
  );

  return {
    proof: proofToBytes(proof),
    publicInputs: publicSignals,
    nullifier: hexToBytes(publicSignals[3]),
  };
}

// === Pool Execution Proof (confidential execute) ===

export async function generatePoolProof(params: {
  inputNullifier: string;
  inputAmount: string;
  inputPrivateKey: string;
  inputBlinding: string;
  merkleProof: { pathElements: string[]; pathIndex: number; root: string };
  recipient: string;
  transferAmount: string;
  changeAmount: string;
  outBlinding0: string;
  outBlinding1: string;
}): Promise<{
  proof: Uint8Array;
  publicInputs: string[];
  extData: ExtData;
}> {
  if (!proverReady) await initZKProver();

  const { proof, publicSignals } = await snarkjs.groth16.prove(
    '/zk-wasm/transaction.wasm',
    '/zk-wasm/transaction_final.zkey',
    {
      root: params.merkleProof.root,
      publicAmount: '0',  // TAMAMEN PRIVATE
      extDataHash: computeExtDataHash(params.recipient, params.transferAmount),
      inputNullifier: [params.inputNullifier],
      inAmount: [params.inputAmount],
      inPrivateKey: [params.inputPrivateKey],
      inBlinding: [params.inputBlinding],
      inPathIndices: [params.merkleProof.pathIndex],
      inPathElements: [params.merkleProof.pathElements],
      outputCommitment: [
        computeCommitment(params.transferAmount, params.recipient, params.outBlinding0),
        computeCommitment(params.changeAmount, vaultPubkey, params.outBlinding1),
      ],
      outAmount: [params.transferAmount, params.changeAmount],
      outPubkey: [params.recipient, vaultPubkey],
      outBlinding: [params.outBlinding0, params.outBlinding1],
    }
  );

  return {
    proof: proofToBytes(proof),
    publicInputs: publicSignals,
    extData: buildExtData(params),
  };
}

// ===== Utility Functions =====

function bytesToFieldElement(bytes: Uint8Array): string {
  const num = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  return num.toString();
}

function proofToBytes(proof: any): Uint8Array {
  const a = hexToBytes(proof.pi_a[0].slice(2) + proof.pi_a[1].slice(2));
  const b = hexToBytes(
    proof.pi_b[0][1].slice(2) + proof.pi_b[0][0].slice(2) +
    proof.pi_b[1][1].slice(2) + proof.pi_b[1][0].slice(2)
  );
  const c = hexToBytes(proof.pi_c[0].slice(2) + proof.pi_c[1].slice(2));
  return new Uint8Array([...a, ...b, ...c]);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}
```

---

## Hooks

### hooks/useProofGeneration.ts

```typescript
import { useState, useCallback } from "react";
import { generateVoteProof, generatePoolProof, initZKProver } from "@/lib/prover";

export function useProofGeneration() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [proofType, setProofType] = useState<'vote' | 'pool' | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const generateVote = useCallback(async (params: Parameters<typeof generateVoteProof>[0]) => {
    setIsGenerating(true);
    setProofType('vote');
    setProgress(10);
    try {
      await initZKProver();
      setProgress(30);
      const result = await generateVoteProof(params);
      setProgress(100);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      return null;
    } finally {
      setIsGenerating(false);
      setProofType(null);
    }
  }, []);

  const generatePool = useCallback(async (params: Parameters<typeof generatePoolProof>[0]) => {
    setIsGenerating(true);
    setProofType('pool');
    setProgress(10);
    try {
      await initZKProver();
      setProgress(30);
      const result = await generatePoolProof(params);
      setProgress(100);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      return null;
    } finally {
      setIsGenerating(false);
      setProofType(null);
    }
  }, []);

  return { generateVote, generatePool, isGenerating, proofType, progress, error };
}
```

---

## Gerekli npm Paketleri

```json
{
  "dependencies": {
    "next": "^14.2.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@stellar/stellar-sdk": "^13.0.0",
    "tailwindcss": "^4.0.0",
    "snarkjs": "^0.7.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "typescript": "^5.6.0"
  }
}
```

---

## Backend Neden Yok?

- **Soroban RPC** tüm contract okuma/yazma işlemlerini doğrudan yapar
- **Freighter wallet** signing'i browser'da yapar
- **ZK proving** WASM ile browser'da çalışır (2 circuit)
- **Event streaming** Soroban events ile yapılır
- Backend'e ihtiyaç yok — fully client-side dApp

---

*İlgili: [Vault Contract](../contracts/VAULT_CONTRACT.md) | [Nethermind Entegrasyonu](../nethermind/INTEGRATION.md) | [ZK Circuits](../zk-circuits/CIRCUITS.md)*
