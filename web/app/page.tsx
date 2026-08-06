"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CONFIG,
  connectFreighter,
  getConnectedAddress,
  shortAddr,
  shortContract,
  formatXLM,
  contractExplorerUrl,
} from "@/lib/stellar";
import {
  getVault,
  getVaultBalance,
  getProposals,
  getMyVaults,
  createVault as createVaultTx,
  proposeTransaction,
  proposeBatch,
  approve as approveTx,
  approveZk,
  approveZkAnon,
  execute as executeTx,
  cancel as cancelTx,
  depositToVault,
  getPolicy,
  getAllowed,
  getSpentInWindow,
  getStatus,
  getZkConfig,
  getVersion,
  upgradeVault,
  getCall,
  getAllowedContracts,
  getSignerCommitments,
  setSignerCommitments,
  proposeCall,
  allowContract,
  revokeContract,
  setZkConfig as setZkConfigTx,
  setPolicy as setPolicyTx,
  allowRecipient,
  revokeRecipient,
  describeError,
  OPEN_POLICY,
  type VaultConfig,
  type Proposal,
  type Policy,
  type ProposalStatus,
  type BatchItem,
  type ZkConfig,
  type CallArg,
  type CallArgType,
  type CallSpec,
} from "@/lib/contract";
import { generateVoteProof, verifyVoteProof, secretFromSeed, signerKey, myCommitment, rootOf } from "@/lib/prover";
import Confidential from "./confidential";

/* ============================ tokens ============================ */
const DISPLAY = "'Newsreader',serif";
const SANS = "'Hanken Grotesk',sans-serif";
const MONO = "'JetBrains Mono',monospace";

const GRAD_A = "linear-gradient(135deg,#C9A86A,#8a6f3e)";
const GRAD_B = "linear-gradient(135deg,#bda07f,#6f5b3d)";
const GRAD_C = "linear-gradient(135deg,#a99272,#5e4e34)";
const GRADS = [GRAD_A, GRAD_B, GRAD_C];

/**
 * Vaults the user has chosen not to see.
 *
 * A vault cannot be deleted — it is a deployed contract holding real balances,
 * and the factory has no `upgrade`, so its registry can never learn to forget
 * one either. Hiding is therefore local and reversible: the vault keeps its
 * address, its funds and its listing on-chain; this only stops it filling the
 * dashboard. Nothing here can lose anything.
 */
const hiddenKey = (w: string) => `sv_hidden_${CONFIG.factoryId}_${w}`;
const loadHidden = (w: string | null): string[] => {
  if (!w || typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(hiddenKey(w)) ?? "[]");
  } catch {
    return [];
  }
};
const saveHidden = (w: string, list: string[]) => {
  try {
    localStorage.setItem(hiddenKey(w), JSON.stringify(list));
  } catch {}
};

// remember which (vault, tx) this wallet already approved → avoid re-click errors
const apprKey = (v: string, t: number, w: string) => `sv_appr_${v}_${t}_${w}`;
const didApprove = (v: string, t: number, w: string | null) =>
  !!w && typeof localStorage !== "undefined" && localStorage.getItem(apprKey(v, t, w)) === "1";
const markApproved = (v: string, t: number, w: string) => {
  try {
    localStorage.setItem(apprKey(v, t, w), "1");
  } catch {}
};

type Screen = "landing" | "connect" | "dashboard" | "create" | "vault" | "propose" | "guards" | "confidential";
type Mode = "transparent" | "private";
type ToastMsg = { title: string; sub: string; tone: "ok" | "err" } | null;

/* ============================ helpers ============================ */
function parseAmountToStroops(s: string): bigint {
  const clean = s.replace(/,/g, "").trim();
  const n = Number(clean);
  if (!isFinite(n) || n <= 0) throw new Error("Enter a valid amount");
  return BigInt(Math.round(n * 1e7));
}
const letterFor = (i: number) => String.fromCharCode(65 + (i % 26));

function Avatar({ letter, grad, size = 26, border, ml = 0, muted = false }: { letter: string; grad?: string; size?: number; border?: string; ml?: number; muted?: boolean }) {
  return (
    <span style={{ width: size, height: size, borderRadius: "50%", background: muted ? "#26241f" : grad, border, marginLeft: ml, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size <= 22 ? 10 : 11, fontWeight: muted ? 600 : 700, color: muted ? "#8A857B" : "#0A0A0B" }}>{letter}</span>
  );
}

function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", border: "1.5px solid #C9A86A", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
      <div style={{ width: size > 28 ? 8 : 7, height: size > 28 ? 8 : 7, borderRadius: 2, background: "#C9A86A" }} />
      {size > 28 && <div style={{ position: "absolute", inset: 5, borderRadius: "50%", border: "1px solid rgba(201,168,106,0.35)" }} />}
    </div>
  );
}

function Row({ label, value, valueNode, mono }: { label: string; value?: string; valueNode?: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, alignItems: "center" }}>
      <span style={{ color: "#8A857B" }}>{label}</span>
      {valueNode ?? <span style={{ fontFamily: mono ? MONO : SANS, color: "#ECE7DD" }}>{value}</span>}
    </div>
  );
}
function Blurred({ children }: { children: React.ReactNode }) {
  return <span style={{ fontFamily: MONO, color: "#6f6a60", filter: "blur(7px)", userSelect: "none" }}>{children}</span>;
}
function Pill({ children }: { children: React.ReactNode }) {
  return <span style={{ border: "1px solid rgba(236,231,221,0.14)", borderRadius: 6, padding: "4px 8px" }}>{children}</span>;
}

/* ============================ page ============================ */
export default function Page() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [mode, setMode] = useState<Mode>("transparent");
  const [proof, setProof] = useState(false);
  const [proofStage, setProofStage] = useState(0);
  const [toast, setToast] = useState<ToastMsg>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // live chain data for the active vault — each vault is its own contract address
  const [vaultAddress, setVaultAddress] = useState<string>("");
  const [config, setConfig] = useState<VaultConfig | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // guards — the vault's policy plus the per-proposal state it produces
  const [policy, setPolicy] = useState<Policy>(OPEN_POLICY);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [spent, setSpent] = useState<bigint>(0n);
  const [statuses, setStatuses] = useState<Record<number, ProposalStatus>>({});
  // null = this vault does not verify proofs on-chain
  const [zkConfig, setZkConfigState] = useState<ZkConfig | null>(null);
  const [allowedContracts, setAllowedContracts] = useState<string[]>([]);
  // published Merkle leaves, in the shuffled order the owner posted them
  const [commitments, setCommitments] = useState<bigint[]>([]);
  /** null = pre-versioning vault (v1), which has no upgrade path at all. */
  const [version, setVersion] = useState<number | null>(null);
  // this signer's own leaf, shown once so they can hand it to the owner
  const [myLeaf, setMyLeaf] = useState<bigint | null>(null);
  const [calls, setCalls] = useState<Record<number, CallSpec>>({});

  const loadData = useCallback(async (addr: string = vaultAddress) => {
    if (!addr) return;
    setLoading(true);
    try {
      const [c, b, p, pol, allow, sp, zk, callTargets, leaves, ver] = await Promise.all([
        getVault(addr),
        getVaultBalance(addr),
        getProposals(addr),
        getPolicy(addr),
        getAllowed(addr),
        getSpentInWindow(addr),
        getZkConfig(addr),
        getAllowedContracts(addr),
        getSignerCommitments(addr),
        getVersion(addr),
      ]);
      setConfig(c);
      setBalance(b);
      setProposals(p);
      setPolicy(pol);
      setAllowed(allow);
      setSpent(sp);
      setZkConfigState(zk);
      setAllowedContracts(callTargets);
      setCommitments(leaves);
      setVersion(ver);

      // guard state per proposal (time-lock, cancellation) — a pre-guards vault
      // returns null for every one of these and the UI simply falls back
      const st = await Promise.all(p.map((x) => getStatus(addr, x.id)));
      const map: Record<number, ProposalStatus> = {};
      p.forEach((x, i) => {
        if (st[i]) map[x.id] = st[i]!;
      });
      setStatuses(map);

      // which proposals are contract calls rather than transfers
      const cs = await Promise.all(p.map((x) => getCall(addr, x.id)));
      const callMap: Record<number, CallSpec> = {};
      p.forEach((x, i) => {
        if (cs[i]) callMap[x.id] = cs[i]!;
      });
      setCalls(callMap);
    } catch (e) {
      // leave nulls; UI falls back to skeleton/empty
    } finally {
      setLoading(false);
    }
  }, [vaultAddress]);

  useEffect(() => {
    getConnectedAddress().then((a) => a && setWallet(a));
    loadData();
    return () => timers.current.forEach(clearTimeout);
  }, [loadData]);

  const go = (s: Screen) => {
    setScreen(s);
    window.scrollTo(0, 0);
    if (s === "vault" || s === "dashboard") loadData();
  };

  // re-read now AND after a few seconds — covers the RPC lag right after a write
  const refreshSoon = () => {
    loadData();
    timers.current.push(setTimeout(() => loadData(), 4500));
  };

  // open a specific vault by address (from the dashboard list)
  const selectVault = (addr: string) => {
    setVaultAddress(addr);
    setScreen("vault");
    window.scrollTo(0, 0);
    loadData(addr);
  };

  const showToast = (t: ToastMsg) => {
    setToast(t);
    timers.current.push(setTimeout(() => setToast(null), 6000));
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const w = await connectFreighter();
      setWallet(w.address);
    } catch {
      /* proceed for demo even without Freighter */
    } finally {
      setConnecting(false);
      go("dashboard");
    }
  };

  const runProof = () => {
    timers.current.forEach(clearTimeout);
    setProof(true);
    setProofStage(0);
    timers.current = [
      setTimeout(() => setProofStage(1), 1500),
      setTimeout(() => setProofStage(2), 3100),
      setTimeout(() => {
        setProof(false);
        setProofStage(0);
        showToast({ title: "Confidential transaction submitted", sub: "Amount & recipient hidden on-chain · view ↗", tone: "ok" });
      }, 4700),
    ];
  };

  const requireWallet = (): string | null => {
    if (!wallet) {
      showToast({ title: "Connect a wallet first", sub: "Authorize Freighter to sign on-chain.", tone: "err" });
      return null;
    }
    return wallet;
  };

  // Create a real vault owned by the connected wallet, then switch to it.
  const doCreate = async (name: string, signers: string[], threshold: number) => {
    const w = requireWallet();
    if (!w) return;
    setBusy("create");
    try {
      const newAddr = await createVaultTx(w, name, signers, threshold);
      setVaultAddress(newAddr);
      setScreen("vault"); // go straight to the NEW vault (go() would reload the stale address)
      window.scrollTo(0, 0);
      await loadData(newAddr); // getVault retries through the fresh-deploy RPC lag
      showToast({ title: `${name} created`, sub: "Its own contract address & balance — deposit, propose, execute.", tone: "ok" });
    } catch (e: any) {
      showToast({ title: "Create failed", sub: cleanErr(e), tone: "err" });
    } finally {
      setBusy(null);
    }
  };

  // Propose — real on-chain txn in both modes (private_mode flag differs).
  const submitPropose = async (target: string, amountStr: string) => {
    const w = requireWallet();
    if (!w) return;
    let stroops: bigint;
    try {
      stroops = parseAmountToStroops(amountStr);
    } catch (e: any) {
      showToast({ title: "Invalid amount", sub: e.message, tone: "err" });
      return;
    }
    const priv = mode === "private";
    setBusy("propose");
    try {
      await proposeTransaction(vaultAddress, w, target.trim(), stroops, priv);
      await loadData();
      go("vault");
      showToast({
        title: priv ? "Private transaction proposed" : "Transaction proposed",
        sub: priv ? "Co-signers approve it with a zero-knowledge proof." : "Co-signers can now approve it.",
        tone: "ok",
      });
    } catch (e: any) {
      showToast({ title: "Propose failed", sub: cleanErr(e), tone: "err" });
    } finally {
      setBusy(null);
    }
  };

  // Private approval: generate a REAL anonymous-membership proof in-browser,
  // verify it, then submit the nullifier on-chain (identity hidden).
  const doApproveZk = async (txId: number) => {
    const w = requireWallet();
    if (!w) return;
    if (!config) {
      showToast({ title: "Vault not loaded", sub: "Try again in a moment.", tone: "err" });
      return;
    }
    const myIndex = config.signers.indexOf(w);
    if (myIndex < 0) {
      showToast({ title: "Not a signer", sub: "Your wallet isn't a signer of this vault.", tone: "err" });
      return;
    }
    timers.current.forEach(clearTimeout);
    setProof(true);
    setProofStage(0);
    try {
      // When the vault verifies on-chain it dictates the domain id, and the
      // proposal id IS the second public input — the contract checks both. A
      // vault that doesn't verify keeps deriving the id from its address.
      const vId = zkConfig ? zkConfig.vault_id : await secretFromSeed(vaultAddress);
      const txHash = BigInt(txId);

      // Only this signer's own key is knowable; the leaves come from the chain
      // in the shuffled order the owner published them.
      const { secret, blinding } = await signerKey(vaultAddress);
      if (!commitments.length) {
        throw new Error("This vault has no published signer set yet — the owner needs to publish one.");
      }

      setProofStage(1); // generating proof
      const vp = await generateVoteProof({ vaultId: vId, txHash, commitments, secret, blinding });
      const ok = await verifyVoteProof(vp.publicSignals, vp.proof);
      if (!ok) throw new Error("Local proof verification failed");

      setProofStage(2); // submitting on-chain
      // With verification on, the proof authorizes itself and no wallet has to
      // name itself. Without it the contract still demands a signer, because an
      // unchecked proof plus no auth would let anyone approve.
      if (zkConfig) {
        await approveZkAnon(vaultAddress, txId, w, vp.proof, vp.publicSignals);
      } else {
        await approveZk(vaultAddress, txId, w, vp.proof, vp.publicSignals);
      }

      setProof(false);
      setProofStage(0);
      markApproved(vaultAddress, txId, w);
      refreshSoon();
      showToast({
        title: "Anonymous approval submitted",
        sub: zkConfig
          ? `Nullifier 0x${vp.nullifier.toString(16).slice(0, 10)}… · no wallet identified itself`
          : `Nullifier 0x${vp.nullifier.toString(16).slice(0, 10)}… · proof not verified on this vault`,
        tone: "ok",
      });
    } catch (e: any) {
      setProof(false);
      setProofStage(0);
      showToast({ title: "ZK approve failed", sub: cleanErr(e), tone: "err" });
    }
  };

  const doApprove = async (txId: number) => {
    const w = requireWallet();
    if (!w) return;
    if (config && !config.signers.includes(w)) {
      showToast({ title: "Not a signer of this vault", sub: "Your wallet isn't a signer here. Create your own vault to approve.", tone: "err" });
      return;
    }
    setBusy(`approve-${txId}`);
    try {
      await approveTx(vaultAddress, txId, w);
      markApproved(vaultAddress, txId, w);
      refreshSoon();
      showToast({ title: "Approval signed", sub: `Proposal #${txId} approved on-chain.`, tone: "ok" });
    } catch (e: any) {
      showToast({ title: "Approve failed", sub: cleanErr(e), tone: "err" });
    } finally {
      setBusy(null);
    }
  };

  const doExecute = async (txId: number) => {
    const w = requireWallet();
    if (!w) return;
    const priv = proposals.find((p) => p.id === txId)?.private_mode;
    setBusy(`execute-${txId}`);
    try {
      await executeTx(vaultAddress, txId, w);
      refreshSoon();
      showToast(
        priv
          ? { title: "Private transaction executed", sub: "Funds moved on-chain — but the chain never learned who approved (ZK).", tone: "ok" }
          : { title: "Transaction executed", sub: `Funds moved on-chain · proposal #${txId}.`, tone: "ok" }
      );
    } catch (e: any) {
      showToast({ title: "Execute failed", sub: cleanErr(e), tone: "err" });
    } finally {
      setBusy(null);
    }
  };

  const doDeposit = async () => {
    const w = requireWallet();
    if (!w) return;
    setBusy("deposit");
    try {
      await depositToVault(vaultAddress, w, parseAmountToStroops("100"));
      await loadData();
      showToast({ title: "Deposited 100 XLM", sub: "Vault balance updated.", tone: "ok" });
    } catch (e: any) {
      showToast({ title: "Deposit failed", sub: cleanErr(e), tone: "err" });
    } finally {
      setBusy(null);
    }
  };

  const doCancel = async (txId: number) => {
    const w = requireWallet();
    if (!w) return;
    setBusy(`cancel-${txId}`);
    try {
      await cancelTx(vaultAddress, txId, w);
      refreshSoon();
      showToast({ title: "Proposal cancelled", sub: `#${txId} can no longer be approved or executed.`, tone: "ok" });
    } catch (e: any) {
      showToast({ title: "Cancel failed", sub: cleanErr(e), tone: "err" });
    } finally {
      setBusy(null);
    }
  };

  // Batch (multi-call): N payments approved once, executed atomically.
  const submitBatch = async (items: BatchItem[]) => {
    const w = requireWallet();
    if (!w) return;
    setBusy("propose");
    try {
      await proposeBatch(vaultAddress, w, items, mode === "private");
      await loadData();
      go("vault");
      showToast({
        title: `Batch of ${items.length} proposed`,
        sub: "One approval round — all payments settle together or not at all.",
        tone: "ok",
      });
    } catch (e: any) {
      showToast({ title: "Batch propose failed", sub: cleanErr(e), tone: "err" });
    } finally {
      setBusy(null);
    }
  };

  /** Propose a call to another contract — a swap, a supply, another asset. */
  const submitCall = async (contract: string, fn: string, args: CallArg[]) => {
    const w = requireWallet();
    if (!w) return;
    setBusy("propose");
    try {
      await proposeCall(vaultAddress, w, contract.trim(), fn.trim(), args, mode === "private");
      await loadData();
      go("vault");
      showToast({
        title: "Contract call proposed",
        sub: `${fn.trim()}() on ${shortAddr(contract.trim(), 6, 4)} — the vault will call it as itself.`,
        tone: "ok",
      });
    } catch (e: any) {
      showToast({ title: "Couldn't propose the call", sub: cleanErr(e), tone: "err" });
    } finally {
      setBusy(null);
    }
  };

  const doAllowContract = async (contract: string, allow: boolean) => {
    const w = requireWallet();
    if (!w) return;
    setBusy(`callee-${contract}`);
    try {
      await (allow ? allowContract : revokeContract)(vaultAddress, w, contract);
      refreshSoon();
      showToast({
        title: allow ? "Contract allowed" : "Contract revoked",
        sub: allow
          ? "Proposals may now call it."
          : "Pending calls to it can no longer execute.",
        tone: "ok",
      });
    } catch (e: any) {
      showToast({ title: "Call allowlist update failed", sub: cleanErr(e), tone: "err" });
    } finally {
      setBusy(null);
    }
  };

  /**
   * Bring this vault onto the code the factory now serves. Existing vaults keep
   * whatever they were deployed with — a fix only reaches them through here.
   */
  const doUpgrade = async () => {
    const w = requireWallet();
    if (!w) return;
    if (!CONFIG.vaultWasmHash) {
      showToast({ title: "No target build configured", sub: "NEXT_PUBLIC_VAULT_WASM_HASH is unset.", tone: "err" });
      return;
    }
    setBusy("upgrade");
    try {
      await upgradeVault(vaultAddress, w, CONFIG.vaultWasmHash);
      refreshSoon();
      showToast({ title: "Vault upgraded", sub: "It now runs the same code new vaults are created with.", tone: "ok" });
    } catch (e: any) {
      showToast({ title: "Upgrade failed", sub: cleanErr(e), tone: "err" });
    } finally {
      setBusy(null);
    }
  };

  const doSavePolicy = async (next: Policy) => {
    const w = requireWallet();
    if (!w) return;
    setBusy("policy");
    try {
      await setPolicyTx(vaultAddress, w, next);
      refreshSoon();
      showToast({ title: "Guards updated", sub: "Enforced on-chain from the next execution onward.", tone: "ok" });
    } catch (e: any) {
      showToast({ title: "Couldn't update guards", sub: cleanErr(e), tone: "err" });
    } finally {
      setBusy(null);
    }
  };

  const doAllowRecipient = async (target: string, allow: boolean) => {
    const w = requireWallet();
    if (!w) return;
    setBusy(`allow-${target}`);
    try {
      await (allow ? allowRecipient : revokeRecipient)(vaultAddress, w, target);
      refreshSoon();
      showToast({
        title: allow ? "Recipient allowed" : "Recipient revoked",
        sub: allow ? "Funds may now go to this address." : "Pending proposals to this address can no longer execute.",
        tone: "ok",
      });
    } catch (e: any) {
      showToast({ title: "Allowlist update failed", sub: cleanErr(e), tone: "err" });
    } finally {
      setBusy(null);
    }
  };

  /**
   * Derive this signer's leaf and show it. Only the key holder can compute it,
   * so every signer does this on their own device and hands the result to the
   * owner — over any channel. It is not secret; the secret behind it never
   * leaves the browser.
   */
  const doRegisterKey = async () => {
    const w = requireWallet();
    if (!w) return;
    setBusy("register");
    try {
      const vId = zkConfig ? zkConfig.vault_id : await secretFromSeed(vaultAddress);
      setMyLeaf(await myCommitment(vaultAddress, vId));
      showToast({
        title: "Signing key derived",
        sub: "Send the commitment to the vault owner. Nothing was written on-chain.",
        tone: "ok",
      });
    } catch (e: any) {
      showToast({ title: "Couldn't derive your key", sub: cleanErr(e), tone: "err" });
    } finally {
      setBusy(null);
    }
  };

  /**
   * Publish the signer set: the leaves, SHUFFLED, plus the root the contract
   * pins. The shuffle is the whole point — a list in signer order would let
   * anyone match a nullifier back to the signer who produced it, which is
   * exactly the leak this replaces.
   */
  const doPublishSignerSet = async (raw: string) => {
    const w = requireWallet();
    if (!w) return;
    let leaves: bigint[];
    try {
      leaves = raw
        .split(/[\s,]+/)
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => BigInt(x));
    } catch {
      showToast({ title: "Couldn't read the commitments", sub: "Expected decimal or 0x values, one per signer.", tone: "err" });
      return;
    }
    if (!leaves.length) {
      showToast({ title: "Nothing to publish", sub: "Paste one commitment per signer.", tone: "err" });
      return;
    }
    if (!CONFIG.groth16VerifierId) {
      showToast({ title: "No verifier configured", sub: "NEXT_PUBLIC_GROTH16_VERIFIER_ID is unset.", tone: "err" });
      return;
    }

    // Fisher-Yates: the published order must carry no information
    for (let i = leaves.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [leaves[i], leaves[j]] = [leaves[j], leaves[i]];
    }

    setBusy("zk");
    try {
      const vId = await secretFromSeed(vaultAddress);
      const root = await rootOf(leaves);
      await setSignerCommitments(vaultAddress, w, leaves);
      await setZkConfigTx(vaultAddress, w, CONFIG.groth16VerifierId, vId, root);
      refreshSoon();
      showToast({
        title: `Signer set published · ${leaves.length} members`,
        sub: "Approvals are now verified on-chain, and the order reveals nothing.",
        tone: "ok",
      });
    } catch (e: any) {
      showToast({ title: "Couldn't publish the signer set", sub: cleanErr(e), tone: "err" });
    } finally {
      setBusy(null);
    }
  };

  const isApp = screen === "dashboard" || screen === "create" || screen === "vault" || screen === "propose" || screen === "guards" || screen === "confidential";

  return (
    <div style={{ minHeight: "100vh", width: "100%", position: "relative", background: "#0A0A0B" }}>
      {screen === "landing" && <Landing onConnect={() => go("connect")} onVault={() => go("connect")} balance={balance} />}
      {screen === "connect" && <Connect onBack={() => go("landing")} onConnect={handleConnect} connecting={connecting} />}
      {isApp && (
        <AppShell screen={screen} go={go} mode={mode} setMode={setMode} submitPropose={submitPropose} submitBatch={submitBatch} submitCall={submitCall} wallet={wallet}
          vaultAddress={vaultAddress} config={config} balance={balance} proposals={proposals} loading={loading} busy={busy}
          policy={policy} allowed={allowed} spent={spent} statuses={statuses} zkConfig={zkConfig} allowedContracts={allowedContracts} calls={calls}
          onCreate={doCreate} onApprove={doApprove} onApproveZk={doApproveZk} onExecute={doExecute} onCancel={doCancel} onDeposit={doDeposit} onOpenVault={selectVault} onRefresh={() => loadData()}
          onConfidentialProposed={(fn) => { refreshSoon(); showToast({ title: `${fn}() proposed`, sub: "A confidential operation is now a pending proposal — approve it like any other.", tone: "ok" }); }} onConfidentialError={(msg) => showToast({ title: "Confidential op failed", sub: msg, tone: "err" })} version={version} onUpgrade={doUpgrade} onSavePolicy={doSavePolicy} onAllowRecipient={doAllowRecipient} onRegisterKey={doRegisterKey} onPublishSignerSet={doPublishSignerSet} myLeaf={myLeaf} commitments={commitments} onAllowContract={doAllowContract} />
      )}
      {proof && <ProofOverlay stage={proofStage} />}
      {toast && <Toast msg={toast} />}
    </div>
  );
}

function cleanErr(e: any): string {
  // surface the full error in the browser console for debugging
  if (typeof console !== "undefined") console.error("[StellarVault] action failed:", e);
  // a typed contract error tells us exactly which guard fired — prefer it
  const described = describeError(e);
  const m = described.replace(/^Error:\s*/, "");
  if (described !== (e?.message ?? String(e))) return m;
  if (/getAccount|not found|404/i.test(m)) return "Account not funded on testnet, or not a vault signer.";
  if (/Transaction failed/i.test(m)) return "Rejected on-chain — you may not be a signer for this vault.";
  return m.length > 90 ? m.slice(0, 90) + "…" : m;
}

/* ---------------- guard formatting ---------------- */
const LEDGER_SECONDS = 5;
/** Ledgers → a human duration. The chain's unit is ledgers; people think in time. */
function ledgersToHuman(n: number): string {
  if (n <= 0) return "none";
  const secs = n * LEDGER_SECONDS;
  if (secs < 90) return `${secs}s`;
  if (secs < 5400) return `${Math.round(secs / 60)} min`;
  if (secs < 172800) return `${(secs / 3600).toFixed(secs < 36000 ? 1 : 0)} h`;
  return `${(secs / 86400).toFixed(1)} days`;
}
const xlmFromStroops = (v: bigint) => Number(v) / 1e7;
const stroopsFromXlm = (s: string): bigint => {
  const n = Number(String(s).replace(/,/g, "").trim());
  if (!isFinite(n) || n < 0) throw new Error("Enter a valid amount");
  return BigInt(Math.round(n * 1e7));
};

/** Why "Execute" is unavailable right now, or null when it's clear to go. */
function executeBlocker(p: Proposal, st: ProposalStatus | undefined, policy: Policy, balance: bigint | null): string | null {
  if (st?.cancelled) return "Cancelled";
  if (st && st.current_ledger < st.unlock_ledger) {
    return `Time-locked · ${ledgersToHuman(st.unlock_ledger - st.current_ledger)} left`;
  }
  if (policy.max_per_tx > 0n && p.amount > policy.max_per_tx) return "Over the per-transaction limit";
  if (balance != null && balance < p.amount) return "Vault balance too low";
  return null;
}

/* ============================ LANDING ============================ */
function Landing({ onConnect, onVault, balance }: { onConnect: () => void; onVault: () => void; balance: bigint | null }) {
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div style={{ position: "relative", minHeight: "100vh", overflow: "hidden" }}>
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 0 }}>
        <div style={{ position: "absolute", top: "-12%", right: "-8%", width: 780, height: 780, borderRadius: "50%", background: "radial-gradient(circle at center, rgba(201,168,106,0.22), rgba(201,168,106,0.05) 40%, transparent 66%)", filter: "blur(8px)", animation: "vsGlow 9s ease-in-out infinite" }} />
        <div style={{ position: "absolute", bottom: "-30%", left: "-12%", width: 620, height: 620, borderRadius: "50%", background: "radial-gradient(circle at center, rgba(201,168,106,0.10), transparent 64%)", filter: "blur(10px)" }} />
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(236,231,221,0.035) 1px,transparent 1px),linear-gradient(90deg,rgba(236,231,221,0.035) 1px,transparent 1px)", backgroundSize: "64px 64px", maskImage: "radial-gradient(ellipse 90% 80% at 60% 30%, #000 30%, transparent 80%)", WebkitMaskImage: "radial-gradient(ellipse 90% 80% at 60% 30%, #000 30%, transparent 80%)" }} />
      </div>
      <div style={{ position: "fixed", top: "50%", right: -180, transform: "translateY(-50%)", width: 760, height: 760, pointerEvents: "none", opacity: 0.9, zIndex: 0 }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "1px solid rgba(201,168,106,0.16)", animation: "vsSpin 80s linear infinite" }} />
        <div style={{ position: "absolute", inset: 70, borderRadius: "50%", border: "1px solid rgba(201,168,106,0.12)" }} />
        <div style={{ position: "absolute", inset: 140, borderRadius: "50%", border: "1px dashed rgba(201,168,106,0.18)", animation: "vsSpinR 60s linear infinite" }} />
        <div style={{ position: "absolute", inset: 210, borderRadius: "50%", border: "1px solid rgba(201,168,106,0.10)" }} />
        <div style={{ position: "absolute", inset: 285, borderRadius: "50%", border: "2px solid rgba(201,168,106,0.24)", boxShadow: "inset 0 0 60px rgba(201,168,106,0.08)" }} />
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 54, height: 54, borderRadius: "50%", border: "1px solid rgba(201,168,106,0.5)", display: "flex", alignItems: "center", justifyContent: "center", background: "#0d0d0e" }}>
            <div style={{ width: 14, height: 14, borderRadius: 3, background: "#C9A86A", boxShadow: "0 0 24px rgba(201,168,106,0.7)" }} />
          </div>
        </div>
      </div>

      <div className="vsec" style={{ position: "relative", zIndex: 5, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "26px 48px", maxWidth: 1340, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <LogoMark />
          <span style={{ fontWeight: 600, letterSpacing: ".16em", fontSize: 14, color: "#ECE7DD" }}>STELLAR&nbsp;VAULT</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <div className="vnav-links" style={{ display: "flex", gap: 30, fontSize: 14, color: "#8A857B" }}>
            <span className="h-navtext" style={{ cursor: "pointer" }} onClick={() => scrollTo("product")}>Product</span>
            <span className="h-navtext" style={{ cursor: "pointer" }} onClick={() => scrollTo("privacy")}>Privacy</span>
            <span className="h-navtext" style={{ cursor: "pointer" }} onClick={() => scrollTo("docs")}>Docs</span>
          </div>
          <button onClick={onConnect} className="h-goldbtn h-lift" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#C9A86A", color: "#0A0A0B", fontFamily: SANS, fontWeight: 600, fontSize: 14, padding: "11px 18px", border: "none", borderRadius: 8, cursor: "pointer", boxShadow: "0 6px 24px rgba(201,168,106,0.22)" }}>Get Started <span style={{ fontSize: 15 }}>↗</span></button>
        </div>
      </div>

      <div className="vsec" style={{ position: "relative", zIndex: 4, maxWidth: 1340, margin: "0 auto", padding: "96px 48px 60px" }}>
        <div style={{ maxWidth: 820 }}>
          <div className="vs-rise" style={{ display: "inline-flex", alignItems: "center", gap: 10, border: "1px solid rgba(201,168,106,0.28)", borderRadius: 100, padding: "7px 14px", fontFamily: MONO, fontSize: 11, letterSpacing: ".18em", color: "#C9A86A", marginBottom: 34 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#7FB069", animation: "vsPulseDot 2s ease-in-out infinite" }} />
            STELLAR · SOROBAN · ZERO-KNOWLEDGE
          </div>
          <h1 className="vs-rise vh1" style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 84, lineHeight: 1.02, letterSpacing: "-0.02em", color: "#ECE7DD", marginBottom: 30 }}>
            The first <span style={{ fontStyle: "italic", color: "#C9A86A" }}>confidential</span> multi-sig treasury on Stellar.
          </h1>
          <p className="vs-rise" style={{ fontSize: 19, lineHeight: 1.6, color: "#8A857B", maxWidth: 560, marginBottom: 42 }}>
            Approve as a team. Reveal nothing. Every transaction runs <span style={{ color: "#ECE7DD" }}>transparent</span> for the world to audit — or <span style={{ color: "#ECE7DD" }}>private</span>, where signer identities, amounts and recipients stay sealed behind zero-knowledge proofs.
          </p>
          <div className="vs-rise vrow-wrap" style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button onClick={onConnect} className="h-goldbtn h-lift" style={{ display: "inline-flex", alignItems: "center", gap: 9, background: "#C9A86A", color: "#0A0A0B", fontFamily: SANS, fontWeight: 600, fontSize: 16, padding: "15px 28px", border: "none", borderRadius: 9, cursor: "pointer", boxShadow: "0 8px 30px rgba(201,168,106,0.26)" }}>Get Started <span>↗</span></button>
            <button onClick={() => scrollTo("product")} className="h-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 9, background: "transparent", color: "#ECE7DD", fontFamily: SANS, fontWeight: 500, fontSize: 16, padding: "15px 24px", border: "1px solid rgba(236,231,221,0.16)", borderRadius: 9, cursor: "pointer" }}>See how it works ↓</button>
          </div>
          <div className="vs-rise vstats" style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 56, fontFamily: MONO, fontSize: 12, color: "#5a564d" }}>
            <div><span style={{ color: "#8A857B" }}>CONTRACT</span> &nbsp;{shortContract(CONFIG.factoryId)}</div>
            <div style={{ width: 1, height: 14, background: "rgba(236,231,221,0.12)" }} />
            <div><span style={{ color: "#8A857B" }}>NETWORK</span> &nbsp;Testnet · live</div>
            <div style={{ width: 1, height: 14, background: "rgba(236,231,221,0.12)" }} />
            <div><span style={{ color: "#8A857B" }}>PROOFS</span> &nbsp;Groth16</div>
          </div>
        </div>
      </div>

      <div id="product" className="vsec" style={{ position: "relative", zIndex: 4, maxWidth: 1340, margin: "0 auto", padding: "60px 48px 30px", scrollMarginTop: 24 }}>
        <div style={{ borderTop: "1px solid rgba(236,231,221,0.08)", paddingTop: 40, marginBottom: 36 }}>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: ".2em", color: "#C9A86A", marginBottom: 12 }}>HOW IT WORKS</div>
          <h2 className="vh2" style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 40, letterSpacing: "-0.01em", color: "#ECE7DD", maxWidth: 620 }}>From zero to a confidential treasury in three steps.</h2>
        </div>
        <div className="vgrid3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 22, marginBottom: 26 }}>
          {[
            { n: "01", t: "Create a vault", d: "A factory deploys a fresh smart contract — its own address & balance, your chosen signers and m-of-n threshold. Safe-style, one contract per vault." },
            { n: "02", t: "Propose & approve", d: "Anyone proposes a transfer. Co-signers approve — transparently (name on-chain) or privately, where a zero-knowledge proof proves a valid signer approved without revealing who." },
            { n: "03", t: "Execute", d: "Once the threshold is met, any signer executes. Real XLM moves from the vault — and in private mode the chain never learns who approved." },
          ].map((s) => (
            <div key={s.n} className="h-card" style={{ border: "1px solid rgba(236,231,221,0.08)", borderRadius: 15, background: "#101010", padding: 26 }}>
              <div style={{ fontFamily: MONO, fontSize: 12, color: "#C9A86A", marginBottom: 16 }}>{s.n}</div>
              <div style={{ fontFamily: DISPLAY, fontSize: 22, color: "#ECE7DD", marginBottom: 10 }}>{s.t}</div>
              <div style={{ fontSize: 13.5, color: "#8A857B", lineHeight: 1.6 }}>{s.d}</div>
            </div>
          ))}
        </div>
        <div className="vgrid4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
          {[
            ["Safe-style factory", "One contract per vault"],
            ["Per-transaction privacy", "Transparent or private, your call"],
            ["ZK voter privacy", "Hide who approved (Groth16, verified on-chain)"],
            ["Confidential balances", "Hide amounts, on a SEP-41 standard"],
          ].map(([t, d]) => (
            <div key={t} style={{ border: "1px solid rgba(236,231,221,0.06)", borderRadius: 12, background: "#0d0d0e", padding: "16px 18px" }}>
              <div style={{ fontSize: 13, color: "#ECE7DD", fontWeight: 600, marginBottom: 4 }}>{t}</div>
              <div style={{ fontSize: 12, color: "#8A857B", lineHeight: 1.5 }}>{d}</div>
            </div>
          ))}
        </div>
      </div>

      <div id="privacy" className="vsec" style={{ position: "relative", zIndex: 4, maxWidth: 1340, margin: "0 auto", padding: "60px 48px 110px", scrollMarginTop: 24 }}>
        <div className="vwrap-head" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 30, borderTop: "1px solid rgba(236,231,221,0.08)", paddingTop: 40 }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: ".2em", color: "#C9A86A", marginBottom: 12 }}>THE SAME LEDGER, TWO STATES</div>
            <h2 className="vh2" style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 40, letterSpacing: "-0.01em", color: "#ECE7DD" }}>Same security. Different privacy.</h2>
          </div>
          <p style={{ maxWidth: 300, fontSize: 14, color: "#8A857B", textAlign: "right" }}>One vault, one threshold. You decide — per transaction — what the chain is allowed to see.</p>
        </div>
        <div className="vgrid2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div style={{ position: "relative", border: "1px solid rgba(201,168,106,0.28)", borderRadius: 16, background: "linear-gradient(180deg,#16150f,#121210)", padding: 30, overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,transparent,#C9A86A,transparent)" }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 14, color: "#C9A86A" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#C9A86A", boxShadow: "0 0 12px #C9A86A" }} />TRANSPARENT</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: "#5a564d" }}>RECEIPT #4471</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Row label="Approved by" value="Alice · Bob · Carol" />
              <Row label="Amount" value="1,000.00 XLM" mono />
              <Row label="Recipient" value="GXYZ…7K2P" mono />
              <div style={{ height: 1, background: "rgba(236,231,221,0.08)", margin: "4px 0" }} />
              <Row label="Status" valueNode={<span style={{ color: "#7FB069", fontWeight: 600 }}>Settled on-chain</span>} />
            </div>
            <div style={{ marginTop: 24, fontSize: 13, color: "#8A857B", lineHeight: 1.5 }}>Every detail is publicly verifiable. The classic bank statement — fully auditable.</div>
          </div>
          <div style={{ position: "relative", border: "1px solid rgba(236,231,221,0.10)", borderRadius: 16, background: "linear-gradient(180deg,#101010,#0c0c0d)", padding: 30, overflow: "hidden" }}>
            <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(115deg,rgba(236,231,221,0.018) 0 2px,transparent 2px 9px)", pointerEvents: "none" }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 14, color: "#8A857B" }}>🕶 ANONYMOUS APPROVALS</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: "#46433c" }}>RECEIPT #4472</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Row label="Approved by" valueNode={<span style={{ color: "#8A857B" }}>🔒 3 valid signatures</span>} />
              <Row label="Amount" valueNode={<Blurred>1,000.00 XLM</Blurred>} />
              <Row label="Recipient" valueNode={<Blurred>GXYZ…7K2P</Blurred>} />
              <div style={{ height: 1, background: "rgba(236,231,221,0.06)", margin: "4px 0" }} />
              <Row label="Status" valueNode={<span style={{ color: "#ECE7DD", fontWeight: 600 }}>Confidential · settled</span>} />
            </div>
            <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 8, fontFamily: MONO, fontSize: 11, color: "#8A857B" }}>
              <Pill>nullifier 0x9f…c1a4</Pill><Pill>Groth16 ✓</Pill>
            </div>
          </div>
        </div>
      </div>

      <div id="docs" className="vsec" style={{ position: "relative", zIndex: 4, maxWidth: 1340, margin: "0 auto", padding: "20px 48px 100px", scrollMarginTop: 24 }}>
        <div className="vgridD" style={{ borderTop: "1px solid rgba(236,231,221,0.08)", paddingTop: 40, display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 48 }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: ".2em", color: "#C9A86A", marginBottom: 12 }}>UNDER THE HOOD</div>
            <h2 className="vh2" style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 38, letterSpacing: "-0.01em", color: "#ECE7DD", marginBottom: 20 }}>Real contracts. Real proofs.</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              {[
                ["Smart-contract vault", "Soroban (Rust, SDK 23) — not native multi-sig, so it can run custom logic native accounts can't."],
                ["Our own ZK circuits", "voteApproval (Poseidon + Merkle membership + nullifier) & confidentialTransfer, compiled with circom."],
                ["Groth16 in the browser", "Proofs are generated client-side with snarkjs; the chain records only a nullifier — never who approved."],
                ["Factory architecture", "One deployed contract per vault, with an on-chain owner→vaults registry."],
              ].map(([t, d]) => (
                <div key={t} style={{ display: "flex", gap: 12 }}>
                  <span style={{ color: "#C9A86A", marginTop: 2 }}>▹</span>
                  <div><span style={{ color: "#ECE7DD", fontWeight: 600, fontSize: 14 }}>{t}</span> <span style={{ color: "#8A857B", fontSize: 13.5, lineHeight: 1.55 }}>— {d}</span></div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <a href="https://github.com/ynsmlkc/Stellarvault" target="_blank" rel="noopener noreferrer" className="h-kit" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", textDecoration: "none", border: "1px solid rgba(236,231,221,0.12)", borderRadius: 12, padding: "16px 18px", color: "#ECE7DD" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Source on GitHub</span><span style={{ color: "#8A857B" }}>↗</span>
            </a>
            <a href={contractExplorerUrl(CONFIG.factoryId)} target="_blank" rel="noopener noreferrer" className="h-kit" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", textDecoration: "none", border: "1px solid rgba(236,231,221,0.12)", borderRadius: 12, padding: "16px 18px", color: "#ECE7DD" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Factory on stellar.expert</span><span style={{ color: "#8A857B" }}>↗</span>
            </a>
            <div style={{ border: "1px solid rgba(236,231,221,0.06)", borderRadius: 12, background: "#0d0d0e", padding: 18, marginTop: 4 }}>
              <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".14em", color: "#5a564d", marginBottom: 10 }}>STACK</div>
              <div style={{ fontFamily: MONO, fontSize: 12, color: "#8A857B", lineHeight: 1.9 }}>Soroban SDK 23 · circom + circomlib<br />snarkjs Groth16 (BN254)<br />Next.js 14 · Freighter · Protocol 23</div>
            </div>
          </div>
        </div>
      </div>

      <div className="vsec" style={{ position: "relative", zIndex: 4, borderTop: "1px solid rgba(236,231,221,0.08)", padding: "30px 48px" }}>
        <div style={{ maxWidth: 1340, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, color: "#5a564d" }}>
          <span style={{ letterSpacing: ".14em" }}>STELLAR&nbsp;VAULT</span>
          <span style={{ fontFamily: MONO }}>© 2026 · Built on Soroban testnet</span>
        </div>
      </div>
    </div>
  );
}

/* ============================ CONNECT ============================ */
function Connect({ onBack, onConnect, connecting }: { onBack: () => void; onConnect: () => void; connecting: boolean }) {
  return (
    <div style={{ position: "relative", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", padding: "24px 20px" }}>
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 640, height: 640, borderRadius: "50%", background: "radial-gradient(circle,rgba(201,168,106,0.14),transparent 65%)", filter: "blur(10px)", animation: "vsGlow 8s ease-in-out infinite", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: 26, left: 48, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }} onClick={onBack}>
        <LogoMark size={30} />
        <span style={{ fontWeight: 600, letterSpacing: ".16em", fontSize: 14 }}>STELLAR&nbsp;VAULT</span>
      </div>
      <div className="vs-rise vfixed" style={{ position: "relative", zIndex: 2, width: 440, border: "1px solid rgba(236,231,221,0.10)", borderRadius: 18, background: "linear-gradient(180deg,#141413,#0f0f10)", padding: 40, textAlign: "center", boxShadow: "0 30px 80px rgba(0,0,0,0.5)" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", border: "1px solid rgba(201,168,106,0.4)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 26px", position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "1px dashed rgba(201,168,106,0.25)", animation: "vsSpin 24s linear infinite" }} />
          <div style={{ width: 18, height: 18, borderRadius: 4, background: "#C9A86A", boxShadow: "0 0 20px rgba(201,168,106,0.6)" }} />
        </div>
        <h2 style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 28, marginBottom: 10 }}>Connect your wallet</h2>
        <p style={{ fontSize: 14, color: "#8A857B", lineHeight: 1.6, marginBottom: 30 }}>Authorize with Freighter to load the vaults you sign on. Your keys never leave your device.</p>
        <button onClick={onConnect} disabled={connecting} className="h-goldbtn" style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, background: "#C9A86A", color: "#0A0A0B", fontFamily: SANS, fontWeight: 600, fontSize: 15, padding: 15, border: "none", borderRadius: 10, cursor: connecting ? "wait" : "pointer", opacity: connecting ? 0.8 : 1 }}>
          <span style={{ width: 20, height: 20, borderRadius: 5, background: "#0A0A0B", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#C9A86A", fontSize: 12, fontWeight: 700 }}>F</span>
          {connecting ? "Connecting…" : "Connect Freighter"}
        </button>
        <div style={{ marginTop: 24, fontFamily: MONO, fontSize: 11, color: "#5a564d" }}>TESTNET · no real funds at risk</div>
      </div>
    </div>
  );
}

/* ============================ APP SHELL ============================ */
type ShellProps = {
  screen: Screen; go: (s: Screen) => void; mode: Mode; setMode: (m: Mode) => void;
  submitPropose: (target: string, amount: string) => void; submitBatch: (items: BatchItem[]) => void; submitCall: (contract: string, fn: string, args: CallArg[]) => void; wallet: string | null; vaultAddress: string;
  config: VaultConfig | null; balance: bigint | null; proposals: Proposal[]; loading: boolean; busy: string | null;
  policy: Policy; allowed: string[]; spent: bigint; statuses: Record<number, ProposalStatus>; zkConfig: ZkConfig | null; allowedContracts: string[]; calls: Record<number, CallSpec>;
  onCreate: (name: string, signers: string[], threshold: number) => void; onApprove: (id: number) => void; onApproveZk: (id: number) => void; onExecute: (id: number) => void; onCancel: (id: number) => void; onDeposit: () => void; onOpenVault: (addr: string) => void; onRefresh: () => void;
  onConfidentialProposed: (fn: string) => void; onConfidentialError: (msg: string) => void;
  version: number | null; onUpgrade: () => void;
  onSavePolicy: (p: Policy) => void; onAllowRecipient: (target: string, allow: boolean) => void; onRegisterKey: () => void; onPublishSignerSet: (raw: string) => void; myLeaf: bigint | null; commitments: bigint[]; onAllowContract: (contract: string, allow: boolean) => void;
};
function AppShell(p: ShellProps) {
  /** Screens that act on one specific vault rather than the account as a whole. */
  const inVault =
    p.screen === "vault" || p.screen === "propose" || p.screen === "guards" || p.screen === "confidential";

  const navBtn = (label: string, active: boolean, onClick?: () => void) => (
    <button onClick={onClick} className="h-nav" style={{ background: "transparent", border: "none", color: active ? "#ECE7DD" : "#8A857B", fontFamily: SANS, fontSize: 13, padding: "7px 12px", borderRadius: 7, cursor: "pointer" }}>{label}</button>
  );
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 32px", borderBottom: "1px solid rgba(236,231,221,0.08)", background: "rgba(10,10,11,0.82)", backdropFilter: "blur(14px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 34 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, cursor: "pointer" }} onClick={() => p.go("landing")}>
            <LogoMark size={28} />
            <span style={{ fontWeight: 600, letterSpacing: ".14em", fontSize: 13 }}>STELLAR&nbsp;VAULT</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            {navBtn("Vaults", p.screen === "dashboard", () => p.go("dashboard"))}
            {/* Guards and the confidential balance belong to ONE vault — its
                limits, its signer set, its balance. They show only while you
                are inside that vault: gating on "a vault is selected" is not
                enough, because the selection survives navigating back to the
                list, which is exactly where they do not belong. */}
            {inVault && p.vaultAddress && (
              <>
                <span style={{ color: "#3a3833", fontSize: 15, margin: "0 2px" }}>/</span>
                <span style={{ fontFamily: MONO, fontSize: 11, color: "#5a564d", letterSpacing: ".06em" }}>
                  {p.config?.name || shortContract(p.vaultAddress)}
                </span>
                {navBtn("Guards", p.screen === "guards", () => p.go("guards"))}
                {navBtn("💰 Hidden amounts", p.screen === "confidential", () => p.go("confidential"))}
              </>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: MONO, fontSize: 11, color: "#8A857B", border: "1px solid rgba(236,231,221,0.10)", borderRadius: 7, padding: "6px 10px" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#7FB069" }} />Testnet</div>
          <button className="h-wallet" style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(201,168,106,0.08)", border: "1px solid rgba(201,168,106,0.28)", borderRadius: 9, padding: "7px 12px", cursor: "pointer", fontFamily: SANS }}>
            <span style={{ width: 22, height: 22, borderRadius: "50%", background: GRAD_A }} />
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2 }}>
              <span style={{ fontFamily: MONO, fontSize: 12, color: "#ECE7DD" }}>{p.wallet ? shortAddr(p.wallet, 6, 4) : "Not connected"}</span>
              <span style={{ fontSize: 10, color: "#8A857B" }}>{p.wallet ? "Freighter" : "demo mode"}</span>
            </span>
          </button>
        </div>
      </div>

      <div className="vsec" style={{ flex: 1, width: "100%", maxWidth: 1340, margin: "0 auto", padding: 32 }}>
        {p.screen === "dashboard" && <Dashboard go={p.go} wallet={p.wallet} balance={p.balance} proposals={p.proposals} vaultAddress={p.vaultAddress} onOpenVault={p.onOpenVault} />}
        {p.screen === "create" && <CreateVault go={p.go} wallet={p.wallet} busy={p.busy} onCreate={p.onCreate} />}
        {p.screen === "vault" && <VaultDetail go={p.go} vaultAddress={p.vaultAddress} config={p.config} balance={p.balance} proposals={p.proposals} loading={p.loading} busy={p.busy} wallet={p.wallet} policy={p.policy} allowed={p.allowed} spent={p.spent} statuses={p.statuses} zkConfig={p.zkConfig} calls={p.calls} onApprove={p.onApprove} onApproveZk={p.onApproveZk} onExecute={p.onExecute} onCancel={p.onCancel} onDeposit={p.onDeposit} onRefresh={p.onRefresh} />}
        {p.screen === "propose" && <Propose go={p.go} mode={p.mode} setMode={p.setMode} submitPropose={p.submitPropose} submitBatch={p.submitBatch} submitCall={p.submitCall} busy={p.busy} balance={p.balance} policy={p.policy} allowed={p.allowed} spent={p.spent} allowedContracts={p.allowedContracts} />}
        {p.screen === "guards" && <Guards go={p.go} wallet={p.wallet} config={p.config} policy={p.policy} allowed={p.allowed} spent={p.spent} busy={p.busy} zkConfig={p.zkConfig} allowedContracts={p.allowedContracts} version={p.version} onUpgrade={p.onUpgrade} onSave={p.onSavePolicy} onAllowRecipient={p.onAllowRecipient} onRegisterKey={p.onRegisterKey} onPublishSignerSet={p.onPublishSignerSet} myLeaf={p.myLeaf} commitments={p.commitments} onAllowContract={p.onAllowContract} />}
        {p.screen === "confidential" && (
          <Confidential
            wallet={p.wallet}
            vaultAddress={p.vaultAddress}
            publicBalance={p.balance}
            fromLedger={CONFIG.confidentialFromLedger}
            onBack={() => p.go("vault")}
            onGoToVault={() => p.go("vault")}
            onProposed={p.onConfidentialProposed}
            onError={p.onConfidentialError}
          />
        )}
      </div>
    </div>
  );
}

/* ============================ DASHBOARD ============================ */
function Dashboard({ go, wallet, balance, proposals, vaultAddress, onOpenVault }: { go: (s: Screen) => void; wallet: string | null; balance: bigint | null; proposals: Proposal[]; vaultAddress: string; onOpenVault: (addr: string) => void }) {
  const pending = proposals.filter((x) => !x.executed).length;
  const [myVaults, setMyVaults] = useState<{ address: string; name: string; threshold: number; signers: number; balance: bigint }[]>([]);
  const [loadingVaults, setLoadingVaults] = useState(true);
  const [hidden, setHidden] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => setHidden(loadHidden(wallet)), [wallet]);

  const toggleHidden = (addr: string) => {
    if (!wallet) return;
    const next = hidden.includes(addr) ? hidden.filter((a) => a !== addr) : [...hidden, addr];
    setHidden(next);
    saveHidden(wallet, next);
  };

  useEffect(() => {
    if (!wallet) {
      setMyVaults([]);
      setLoadingVaults(false);
      return;
    }
    let alive = true;
    setLoadingVaults(true);
    (async () => {
      try {
        const addrs = (await getMyVaults(wallet)).filter((a) => a !== CONFIG.demoVault);
        const items = await Promise.all(
          addrs.map(async (address) => {
            try {
              const [c, b] = await Promise.all([getVault(address), getVaultBalance(address)]);
              return { address, name: c.name, threshold: c.threshold, signers: c.signer_count, balance: b };
            } catch {
              return null;
            }
          })
        );
        if (alive) setMyVaults(items.filter(Boolean) as any);
      } finally {
        if (alive) setLoadingVaults(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [wallet]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 30 }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: ".18em", color: "#8A857B", marginBottom: 10 }}>YOUR TREASURIES</div>
          <h1 style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 38, letterSpacing: "-0.01em" }}>Vaults</h1>
        </div>
        <button onClick={() => go("create")} className="h-goldbtn" style={{ display: "inline-flex", alignItems: "center", gap: 9, background: "#C9A86A", color: "#0A0A0B", fontFamily: SANS, fontWeight: 600, fontSize: 14, padding: "12px 18px", border: "none", borderRadius: 9, cursor: "pointer" }}><span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Create New Vault</button>
      </div>
      <div className="vgrid3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 18, marginBottom: 30 }}>
        <Stat label="Total balance" valueNode={<>{loadingVaults ? "…" : formatXLM(myVaults.reduce((s, v) => s + v.balance, 0n))} <span style={{ fontSize: 15, color: "#8A857B", fontFamily: MONO }}>XLM</span></>} />
        <Stat label="Your vaults" valueNode={<>{loadingVaults ? "…" : myVaults.length}</>} />
        <Stat label="Pending (current vault)" valueNode={<span style={{ color: "#C9A86A" }}>{pending}</span>} gold />
      </div>

      {wallet && (
        <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: ".16em", color: "#8A857B", marginBottom: 14 }}>YOUR VAULTS</div>
      )}
      <div className="vgrid3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 18, marginBottom: 30 }}>
        {loadingVaults && wallet && [0, 1, 2].map((i) => <VaultCardSkeleton key={i} />)}
        {!loadingVaults && myVaults.filter((v) => showHidden || !hidden.includes(v.address)).map((v) => (
          <VaultCard key={v.address} onClick={() => onOpenVault(v.address)} name={v.name || "Vault"} id={shortContract(v.address)} threshold={`${v.threshold} / ${v.signers}`} balance={formatXLM(v.balance)} avatars={Array.from({ length: v.signers }, (_, i) => letterFor(i))} gold={v.address === vaultAddress} live hidden={hidden.includes(v.address)} onToggleHidden={() => toggleHidden(v.address)} />
        ))}
        {!loadingVaults && !myVaults.length && wallet && (
          <div style={{ gridColumn: "1 / -1", border: "1px dashed rgba(236,231,221,0.12)", borderRadius: 15, padding: 28, textAlign: "center", color: "#8A857B", fontSize: 13 }}>
            No vaults yet. Click <span style={{ color: "#C9A86A" }}>“Create New Vault”</span> — each one is its own contract, recorded on-chain.
          </div>
        )}
      </div>

      {hidden.length > 0 && (
        <div style={{ fontSize: 12.5, color: "#5a564d", marginTop: -14, marginBottom: 24 }}>
          {hidden.length} vault{hidden.length === 1 ? "" : "s"} hidden — still on-chain, still holding whatever they hold.{" "}
          <span onClick={() => setShowHidden(!showHidden)} style={{ color: "#C9A86A", cursor: "pointer" }}>
            {showHidden ? "hide them again" : "show them"}
          </span>
        </div>
      )}
    </div>
  );
}
function Stat({ label, valueNode, gold }: { label: string; valueNode: React.ReactNode; gold?: boolean }) {
  return (
    <div style={{ border: gold ? "1px solid rgba(201,168,106,0.24)" : "1px solid rgba(236,231,221,0.08)", borderRadius: 13, background: gold ? "linear-gradient(180deg,#16150f,#121210)" : "#121211", padding: "20px 22px" }}>
      <div style={{ fontSize: 12, color: "#8A857B", marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: DISPLAY, fontSize: 30, color: "#ECE7DD" }}>{valueNode}</div>
    </div>
  );
}
function VaultCardSkeleton() {
  const bar = (w: string | number, h = 12) => <div style={{ width: w, height: h, borderRadius: 5, background: "rgba(236,231,221,0.06)", animation: "vsShimmer 1.4s ease-in-out infinite" }} />;
  return (
    <div style={{ border: "1px solid rgba(236,231,221,0.06)", borderRadius: 15, background: "#121211", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{bar(120, 15)}{bar(70)}</div>
        {bar(44, 18)}
      </div>
      <div style={{ marginBottom: 18 }}>{bar(110, 22)}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>{bar(70, 22)}{bar(60)}</div>
    </div>
  );
}

function VaultCard({ name, id, threshold, balance, avatars, pending, gold, live, onClick, hidden, onToggleHidden }: { name: string; id: string; threshold: string; balance: string; avatars: string[]; pending?: string; gold?: boolean; live?: boolean; onClick?: () => void; hidden?: boolean; onToggleHidden?: () => void }) {
  return (
    <div onClick={onClick} className={gold ? "h-cardgold" : "h-card"} style={{ position: "relative", border: gold ? "1px solid rgba(201,168,106,0.24)" : "1px solid rgba(236,231,221,0.08)", borderRadius: 15, background: gold ? "linear-gradient(180deg,#15140f,#111110)" : "#121211", padding: 24, cursor: "pointer", overflow: "hidden" }}>
      {gold && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,transparent,#C9A86A,transparent)" }} />}
      {onToggleHidden && (
        <span
          onClick={(e) => { e.stopPropagation(); onToggleHidden(); }}
          title={hidden ? "Show on the dashboard again" : "Hide from the dashboard — the vault and its funds are untouched"}
          style={{ position: "absolute", top: 10, right: 12, fontFamily: MONO, fontSize: 10.5, color: "#46433c", cursor: "pointer", letterSpacing: ".08em" }}
        >{hidden ? "unhide" : "hide"}</span>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 5, display: "flex", alignItems: "center", gap: 8 }}>{name}{live && <span style={{ fontFamily: MONO, fontSize: 9, color: "#7FB069", border: "1px solid rgba(127,176,105,0.4)", borderRadius: 4, padding: "1px 5px" }}>LIVE</span>}</div>
          <div style={{ fontFamily: MONO, fontSize: 11, color: "#8A857B" }}>{id}</div>
        </div>
        <span style={{ fontFamily: MONO, fontSize: 11, color: gold ? "#C9A86A" : "#8A857B", border: gold ? "1px solid rgba(201,168,106,0.32)" : "1px solid rgba(236,231,221,0.14)", borderRadius: 6, padding: "3px 7px" }}>{threshold}</span>
      </div>
      <div style={{ fontFamily: DISPLAY, fontSize: 26, marginBottom: 18 }}>{balance} <span style={{ fontSize: 13, fontFamily: MONO, color: "#8A857B" }}>XLM</span></div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex" }}>
          {avatars.map((a, i) => {
            const muted = a.startsWith("+");
            const cardBg = gold ? "#111110" : "#121211";
            return <Avatar key={i} letter={a} grad={GRADS[i % 3]} muted={muted} border={`2px solid ${cardBg}`} ml={i === 0 ? 0 : -8} />;
          })}
        </div>
        {pending ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: "#C9A86A" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#C9A86A", animation: "vsPulseDot 2s ease-in-out infinite" }} />{pending}</span>
        ) : (<span style={{ fontSize: 12, color: "#5a564d" }}>No pending</span>)}
      </div>
    </div>
  );
}

/* ============================ CREATE VAULT (live) ============================ */
function CreateVault({ go, wallet, busy, onCreate }: { go: (s: Screen) => void; wallet: string | null; busy: string | null; onCreate: (name: string, signers: string[], threshold: number) => void }) {
  const [name, setName] = useState("");
  const [extra, setExtra] = useState<string[]>([]);
  const [threshold, setThreshold] = useState(1);
  const inputStyle: React.CSSProperties = { flex: 1, background: "#0d0d0e", border: "1px solid rgba(236,231,221,0.10)", borderRadius: 9, padding: "11px 13px", color: "#ECE7DD", fontFamily: MONO, fontSize: 13 };

  const allSigners = [wallet ?? "", ...extra].filter((s) => s.trim().length > 0);
  const validAddr = (a: string) => /^G[A-Z2-7]{55}$/.test(a.trim());
  const signerCount = allSigners.length;
  const canCreate = !!wallet && name.trim().length > 0 && allSigners.every(validAddr) && threshold >= 1 && threshold <= signerCount && busy !== "create";

  const setExtraAt = (i: number, v: string) => setExtra((xs) => xs.map((x, j) => (j === i ? v : x)));
  const removeExtra = (i: number) => setExtra((xs) => xs.filter((_, j) => j !== i));

  return (
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      <button onClick={() => go("dashboard")} className="h-navtext" style={{ background: "transparent", border: "none", color: "#8A857B", fontFamily: SANS, fontSize: 13, cursor: "pointer", marginBottom: 22, padding: 0 }}>← Back to vaults</button>
      <h1 style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 34, marginBottom: 8 }}>Create a vault</h1>
      <p style={{ fontSize: 14, color: "#8A857B", marginBottom: 34 }}>Define who holds the keys and how many must agree before funds move.</p>

      <div style={{ border: "1px solid rgba(236,231,221,0.08)", borderRadius: 15, background: "#121211", padding: 28, marginBottom: 18 }}>
        <label style={{ display: "block", fontSize: 13, color: "#ECE7DD", fontWeight: 600, marginBottom: 10 }}>Vault name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Orbital Treasury" maxLength={40} style={{ width: "100%", background: "#0d0d0e", border: "1px solid rgba(236,231,221,0.10)", borderRadius: 9, padding: "12px 14px", color: "#ECE7DD", fontFamily: SANS, fontSize: 14 }} />
      </div>

      <div style={{ border: "1px solid rgba(236,231,221,0.08)", borderRadius: 15, background: "#121211", padding: 28, marginBottom: 18 }}>
        <label style={{ display: "block", fontSize: 13, color: "#ECE7DD", fontWeight: 600, marginBottom: 14 }}>Signers</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Avatar letter="A" grad={GRAD_A} size={28} />
            <input readOnly value={wallet ?? "Connect wallet first"} style={{ ...inputStyle, color: wallet ? "#ECE7DD" : "#5a564d" }} />
            <span style={{ fontSize: 11, color: "#C9A86A", border: "1px solid rgba(201,168,106,0.3)", borderRadius: 5, padding: "3px 7px", whiteSpace: "nowrap" }}>you · owner</span>
          </div>
          {extra.map((val, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar letter={letterFor(i + 1)} grad={GRADS[(i + 1) % 3]} size={28} />
              <input value={val} onChange={(e) => setExtraAt(i, e.target.value)} placeholder="G…" style={{ ...inputStyle, borderColor: val && !validAddr(val) ? "rgba(196,93,74,0.5)" : "rgba(236,231,221,0.10)" }} />
              <button onClick={() => removeExtra(i)} className="h-x" style={{ background: "transparent", border: "none", color: "#5a564d", cursor: "pointer", fontSize: 18, padding: "0 6px" }}>×</button>
            </div>
          ))}
        </div>
        <button onClick={() => setExtra((xs) => [...xs, ""])} className="h-addsigner" style={{ background: "transparent", border: "1px dashed rgba(236,231,221,0.18)", color: "#8A857B", fontFamily: SANS, fontSize: 13, padding: 10, width: "100%", borderRadius: 9, cursor: "pointer" }}>+ Add signer</button>
      </div>

      <div style={{ border: "1px solid rgba(236,231,221,0.08)", borderRadius: 15, background: "#121211", padding: 28, marginBottom: 18 }}>
        <label style={{ display: "block", fontSize: 13, color: "#ECE7DD", fontWeight: 600, marginBottom: 6 }}>Approval threshold</label>
        <p style={{ fontSize: 13, color: "#8A857B", marginBottom: 18 }}>How many signers must approve each transaction.</p>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", gap: 8 }}>
            {Array.from({ length: Math.max(signerCount, 1) }).map((_, i) => (
              <button key={i} onClick={() => setThreshold(i + 1)} className={threshold === i + 1 ? undefined : "h-thresh"} style={{ width: 42, height: 42, borderRadius: 9, border: threshold === i + 1 ? "1px solid #C9A86A" : "1px solid rgba(236,231,221,0.12)", background: threshold === i + 1 ? "rgba(201,168,106,0.12)" : "#0d0d0e", color: threshold === i + 1 ? "#C9A86A" : "#8A857B", fontSize: 15, fontWeight: threshold === i + 1 ? 700 : 600, cursor: "pointer" }}>{i + 1}</button>
            ))}
          </div>
          <span style={{ color: "#5a564d" }}>of {signerCount} signer{signerCount === 1 ? "" : "s"}</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid rgba(201,168,106,0.24)", borderRadius: 13, background: "linear-gradient(180deg,#16150f,#121210)", padding: "18px 22px", marginBottom: 22 }}>
        <span style={{ fontSize: 14, color: "#8A857B" }}>Live summary</span>
        <span style={{ fontSize: 15, color: "#ECE7DD" }}><span style={{ color: "#C9A86A", fontWeight: 600 }}>{threshold} of {signerCount}</span> signer{signerCount === 1 ? "" : "s"} must approve to move funds.</span>
      </div>

      <button onClick={() => canCreate && onCreate(name.trim(), allSigners, threshold)} disabled={!canCreate} className="h-goldbtn" style={{ width: "100%", background: "#C9A86A", color: "#0A0A0B", fontFamily: SANS, fontWeight: 600, fontSize: 15, padding: 15, border: "none", borderRadius: 11, cursor: canCreate ? "pointer" : "not-allowed", opacity: canCreate ? 1 : 0.5 }}>{busy === "create" ? "Creating · check Freighter…" : "Create vault · sign with wallet"}</button>
      <p style={{ fontSize: 11, color: "#5a564d", textAlign: "center", marginTop: 12, fontFamily: MONO }}>{wallet ? "Threshold 1 + just you = full solo demo (propose → approve → execute yourself)" : "Connect a Freighter wallet to create on-chain"}</p>
    </div>
  );
}

/* ============================ VAULT DETAIL (live) ============================ */
function VaultDetail({ go, vaultAddress, config, balance, proposals, loading, busy, wallet, policy, allowed, spent, statuses, zkConfig, calls, onApprove, onApproveZk, onExecute, onCancel, onDeposit, onRefresh }: {
  go: (s: Screen) => void; vaultAddress: string; config: VaultConfig | null; balance: bigint | null; proposals: Proposal[]; loading: boolean; busy: string | null; wallet: string | null;
  policy: Policy; allowed: string[]; spent: bigint; statuses: Record<number, ProposalStatus>; zkConfig: ZkConfig | null; calls: Record<number, CallSpec>;
  onApprove: (id: number) => void; onApproveZk: (id: number) => void; onExecute: (id: number) => void; onCancel: (id: number) => void; onDeposit: () => void; onRefresh: () => void;
}) {
  const threshold = config?.threshold ?? 2;
  const signers = config?.signers ?? [];
  // a cancelled proposal is neither pending nor a settled payment — it belongs in history
  const isDone = (p: Proposal) => p.executed || !!statuses[p.id]?.cancelled;
  const pending = proposals.filter((p) => !isDone(p));
  const history = proposals.filter(isDone);
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const list = tab === "pending" ? pending : history;

  return (
    <div>
      <button onClick={() => go("dashboard")} className="h-navtext" style={{ background: "transparent", border: "none", color: "#8A857B", fontFamily: SANS, fontSize: 13, cursor: "pointer", marginBottom: 20, padding: 0 }}>← All vaults</button>

      <div style={{ position: "relative", border: "1px solid rgba(201,168,106,0.22)", borderRadius: 17, background: "linear-gradient(180deg,#15140f,#111110)", padding: "28px 30px", marginBottom: 24, overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,transparent,#C9A86A,transparent)" }} />
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 20 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <h1 style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 32 }}>{config?.name || "Vault"}</h1>
              <span style={{ fontFamily: MONO, fontSize: 11, color: "#C9A86A", border: "1px solid rgba(201,168,106,0.32)", borderRadius: 6, padding: "4px 9px" }}>{threshold} / {config?.signer_count ?? signers.length} threshold</span>
              <span style={{ fontFamily: MONO, fontSize: 9, color: "#7FB069", border: "1px solid rgba(127,176,105,0.4)", borderRadius: 4, padding: "2px 6px" }}>LIVE · TESTNET</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: MONO, fontSize: 12, color: "#8A857B" }}>
              {shortAddr(vaultAddress, 8, 9)}
              <span className="h-copy" style={{ cursor: "pointer", color: "#C9A86A" }} onClick={() => navigator.clipboard?.writeText(vaultAddress)}>⧉ copy</span>
              <a className="h-copy" href={contractExplorerUrl(vaultAddress)} target="_blank" rel="noreferrer" style={{ cursor: "pointer", color: "#C9A86A", textDecoration: "none" }}>↗ explorer</a>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12, color: "#8A857B", marginBottom: 4 }}>Vault balance</div>
            <div style={{ fontFamily: DISPLAY, fontSize: 38, lineHeight: 1 }}>{balance != null ? formatXLM(balance) : (loading ? "…" : "—")} <span style={{ fontSize: 16, fontFamily: MONO, color: "#8A857B" }}>XLM</span></div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginTop: 24, paddingTop: 22, borderTop: "1px solid rgba(236,231,221,0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex" }}>
              {(signers.length ? signers : ["A", "B", "C"]).map((_, i) => (
                <Avatar key={i} letter={letterFor(i)} grad={GRADS[i % 3]} size={30} border="2px solid #121110" ml={i === 0 ? 0 : -9} />
              ))}
            </div>
            <span style={{ fontSize: 13, color: "#8A857B" }}>{config?.signer_count ?? signers.length} signers</span>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onRefresh} disabled={loading} className="h-deposit" title="Refresh from chain" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "transparent", color: "#8A857B", border: "1px solid rgba(236,231,221,0.12)", borderRadius: 9, padding: "11px 14px", fontFamily: SANS, fontSize: 14, cursor: "pointer", opacity: loading ? 0.5 : 1 }}>↻</button>
            <button onClick={onDeposit} disabled={busy === "deposit"} className="h-deposit" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "transparent", color: "#ECE7DD", border: "1px solid rgba(236,231,221,0.16)", borderRadius: 9, padding: "11px 18px", fontFamily: SANS, fontSize: 14, fontWeight: 500, cursor: "pointer", opacity: busy === "deposit" ? 0.6 : 1 }}>{busy === "deposit" ? "Depositing…" : "↓ Deposit 100"}</button>
            <button onClick={() => go("propose")} className="h-goldbtn" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#C9A86A", color: "#0A0A0B", border: "none", borderRadius: 9, padding: "11px 18px", fontFamily: SANS, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>+ New Transaction</button>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24, alignItems: "start" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>Transactions</span>
              <div style={{ display: "flex", gap: 4, fontSize: 12 }}>
                <span onClick={() => setTab("pending")} style={{ color: tab === "pending" ? "#0A0A0B" : "#8A857B", background: tab === "pending" ? "#C9A86A" : "transparent", borderRadius: 6, padding: "4px 10px", fontWeight: 600, cursor: "pointer" }}>Pending {pending.length}</span>
                <span onClick={() => setTab("history")} className="h-history" style={{ color: tab === "history" ? "#ECE7DD" : "#8A857B", padding: "4px 10px", cursor: "pointer" }}>History {history.length}</span>
              </div>
            </div>
            <span style={{ fontFamily: MONO, fontSize: 11, color: "#5a564d" }}>live · {shortContract(vaultAddress)}</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {loading && !proposals.length && <Skeleton />}
            {!loading && !list.length && <Empty label={tab === "pending" ? "No pending transactions. Propose one." : "No history yet."} />}
            {list.map((p) => {
              const shared = {
                p, threshold, busy,
                st: statuses[p.id],
                call: calls[p.id],
                blocker: executeBlocker(p, statuses[p.id], policy, balance),
                canCancel: !!wallet && (wallet === p.proposer || wallet === config?.owner),
                onCancel,
                iApproved: didApprove(vaultAddress, p.id, wallet),
              };
              return p.private_mode
                ? <PrivateTx key={p.id} {...shared} onApproveZk={onApproveZk} onExecute={onExecute} />
                : <TransparentTx key={p.id} {...shared} onApprove={onApprove} onExecute={onExecute} />;
            })}
          </div>
        </div>

        <div style={{ position: "sticky", top: 96, display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ border: "1px solid rgba(236,231,221,0.08)", borderRadius: 15, background: "#121211", padding: 22 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Signers</div>
            {(signers.length ? signers : ["", "", ""]).map((s, i) => (
              <SignerRow key={i} letter={letterFor(i)} grad={GRADS[i % 3]} addr={s ? shortAddr(s, 6, 4) : "…"} owner={i === 0} you={!!wallet && s === wallet} />
            ))}
            <button className="h-addsigner" style={{ background: "transparent", border: "1px dashed rgba(236,231,221,0.18)", color: "#8A857B", fontFamily: SANS, fontSize: 13, padding: 9, width: "100%", borderRadius: 9, cursor: "pointer", marginTop: 6 }}>+ Add signer</button>
          </div>
          <div style={{ border: "1px solid rgba(236,231,221,0.08)", borderRadius: 15, background: "#121211", padding: 22 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Guards</span>
              <button onClick={() => go("guards")} className="h-navtext" style={{ background: "transparent", border: "none", color: "#C9A86A", fontFamily: SANS, fontSize: 12, cursor: "pointer", padding: 0 }}>Edit →</button>
            </div>
            <PolicyRow label="Threshold" value={`${threshold} of ${config?.signer_count ?? signers.length}`} />
            <PolicyRow
              label="Per-tx limit"
              valueNode={<GuardValue on={policy.max_per_tx > 0n} text={policy.max_per_tx > 0n ? `${formatXLM(policy.max_per_tx)} XLM` : "Unlimited"} />}
            />
            <PolicyRow
              label="Spending cap"
              valueNode={<GuardValue on={policy.spending_cap > 0n} text={policy.spending_cap > 0n ? `${formatXLM(policy.spending_cap)} / ${ledgersToHuman(policy.cap_window_ledgers || 17280)}` : "Unlimited"} />}
            />
            <PolicyRow
              label="Time-lock"
              valueNode={<GuardValue on={policy.timelock_ledgers > 0} text={policy.timelock_ledgers > 0 ? ledgersToHuman(policy.timelock_ledgers) : "None"} />}
            />
            <PolicyRow
              label="Allowlist"
              valueNode={<GuardValue on={policy.allowlist_only} text={policy.allowlist_only ? `${allowed.length} allowed` : "Off · any recipient"} />}
            />
            {policy.spending_cap > 0n && <CapMeter spent={spent} cap={policy.spending_cap} />}
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(236,231,221,0.05)" }}>
              <PolicyRow label="Token" value="XLM (SAC)" />
              <PolicyRow
                label="ZK proofs"
                valueNode={
                  zkConfig
                    ? <span style={{ color: "#7FB069" }}>Verified on-chain</span>
                    : <span style={{ color: "#8A857B" }}>Recorded, not verified</span>
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Skeleton() {
  return <div style={{ border: "1px solid rgba(236,231,221,0.08)", borderRadius: 14, background: "#121211", padding: 22, color: "#5a564d", fontFamily: MONO, fontSize: 12 }}>Loading on-chain transactions…</div>;
}
function Empty({ label }: { label: string }) {
  return <div style={{ border: "1px dashed rgba(236,231,221,0.12)", borderRadius: 14, background: "transparent", padding: 28, textAlign: "center", color: "#8A857B", fontSize: 13 }}>{label}</div>;
}
function SignerRow({ letter, grad, addr, owner, you }: { letter: string; grad: string; addr: string; owner?: boolean; you?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderBottom: "1px solid rgba(236,231,221,0.05)" }}>
      <Avatar letter={letter} grad={grad} size={28} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: "#ECE7DD", display: "flex", alignItems: "center", gap: 7 }}>Signer {letter}
          {owner && <span style={{ fontSize: 10, color: "#C9A86A", border: "1px solid rgba(201,168,106,0.3)", borderRadius: 5, padding: "1px 6px" }}>owner</span>}
          {you && <span style={{ fontSize: 10, color: "#7FB069", border: "1px solid rgba(127,176,105,0.4)", borderRadius: 5, padding: "1px 6px" }}>you</span>}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 11, color: "#8A857B" }}>{addr}</div>
      </div>
    </div>
  );
}
function PolicyRow({ label, value, valueNode }: { label: string; value?: string; valueNode?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "8px 0" }}>
      <span style={{ color: "#8A857B" }}>{label}</span>
      {valueNode ?? <span style={{ color: "#ECE7DD" }}>{value}</span>}
    </div>
  );
}

/** An active guard reads gold; an inactive one stays quiet. */
function GuardValue({ on, text }: { on: boolean; text: string }) {
  return <span style={{ color: on ? "#C9A86A" : "#5a564d", fontFamily: on ? MONO : SANS, fontSize: on ? 12 : 13 }}>{text}</span>;
}

/** How much of the current spending window is already used. */
function CapMeter({ spent, cap }: { spent: bigint; cap: bigint }) {
  const pct = cap > 0n ? Math.min(100, (xlmFromStroops(spent) / xlmFromStroops(cap)) * 100) : 0;
  const hot = pct >= 80;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 10.5, color: "#8A857B", marginBottom: 6 }}>
        <span>THIS WINDOW</span>
        <span style={{ color: hot ? "#C45D4A" : "#8A857B" }}>{formatXLM(spent)} / {formatXLM(cap)}</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: "rgba(236,231,221,0.07)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: hot ? "#C45D4A" : "#C9A86A", transition: "width .4s ease" }} />
      </div>
    </div>
  );
}

/** Shown on a card whose execution a guard is currently blocking. */
function BlockedNote({ reason }: { reason: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: "#C45D4A", fontFamily: MONO, border: "1px solid rgba(196,93,74,0.32)", borderRadius: 7, padding: "6px 10px" }}>
      ⏻ {reason}
    </span>
  );
}

function CancelButton({ id, busy, onCancel }: { id: number; busy: string | null; onCancel: (id: number) => void }) {
  return (
    <button onClick={() => onCancel(id)} disabled={!!busy} className="h-navtext" style={{ background: "transparent", border: "1px solid rgba(236,231,221,0.14)", color: "#8A857B", borderRadius: 8, padding: "9px 14px", fontFamily: SANS, fontSize: 13, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
      {busy === `cancel-${id}` ? "Cancelling…" : "Cancel"}
    </button>
  );
}

function ApprovalDots({ count, threshold, gold }: { count: number; threshold: number; gold?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {Array.from({ length: threshold }).map((_, i) => (
        <span key={i} style={{ width: 11, height: 11, borderRadius: "50%", background: i < count ? (gold ? "#C9A86A" : "#8A857B") : "transparent", border: i < count ? "none" : `1.5px solid ${gold ? "#5a564d" : "#46433c"}` }} />
      ))}
      <span style={{ fontSize: 13, color: "#8A857B", marginLeft: 4 }}>{count} / {threshold} approved</span>
    </div>
  );
}

type TxCardProps = {
  p: Proposal; threshold: number; busy: string | null; iApproved: boolean;
  st?: ProposalStatus; call?: CallSpec; blocker: string | null; canCancel: boolean; onCancel: (id: number) => void;
};

function TransparentTx({ p, threshold, busy, iApproved, st, call, blocker, canCancel, onCancel, onApprove, onExecute }: TxCardProps & { onApprove: (id: number) => void; onExecute: (id: number) => void }) {
  const ready = p.approval_count >= threshold;
  const cancelled = !!st?.cancelled;
  const closed = p.executed || cancelled;
  return (
    <div style={{ position: "relative", border: "1px solid rgba(201,168,106,0.28)", borderRadius: 14, background: "linear-gradient(180deg,#16150f,#121210)", padding: 22, overflow: "hidden", opacity: closed ? 0.78 : 1 }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "#C9A86A" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, color: "#C9A86A", letterSpacing: ".04em" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#C9A86A", boxShadow: "0 0 10px #C9A86A" }} />TRANSPARENT{call ? <CallBadge /> : st?.is_batch ? <BatchBadge /> : null}</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: "#8A857B" }}>proposal #{p.id}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18, marginBottom: 20 }}>
        <div><div style={{ fontSize: 11, color: "#8A857B", marginBottom: 6 }}>Proposed by</div><div style={{ fontFamily: MONO, fontSize: 14, color: "#ECE7DD" }}>{shortAddr(p.proposer)}</div></div>
        <div><div style={{ fontSize: 11, color: "#8A857B", marginBottom: 6 }}>{call ? "Contract" : "Recipient"}</div><div style={{ fontFamily: MONO, fontSize: 14, color: "#ECE7DD" }}>{call ? shortAddr(call.contract, 5, 4) : st?.is_batch ? "multiple" : shortAddr(p.target)}</div></div>
        {call
          ? <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: "#8A857B", marginBottom: 6 }}>Call</div><div style={{ fontFamily: MONO, fontSize: 15, color: "#ECE7DD" }}>{call.function}<span style={{ color: "#8A857B" }}>({call.args.length})</span></div></div>
          : <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: "#8A857B", marginBottom: 6 }}>{st?.is_batch ? "Batch total" : "Amount"}</div><div style={{ fontFamily: DISPLAY, fontSize: 22, color: "#ECE7DD" }}>{formatXLM(p.amount)} <span style={{ fontSize: 12, fontFamily: MONO, color: "#8A857B" }}>XLM</span></div></div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", paddingTop: 18, borderTop: "1px solid rgba(236,231,221,0.08)" }}>
        {p.executed
          ? <span style={{ fontSize: 13, color: "#7FB069", fontWeight: 600 }}>● Executed · settled on-chain</span>
          : cancelled
            ? <span style={{ fontSize: 13, color: "#8A857B", fontWeight: 600 }}>✕ Cancelled</span>
            : <ApprovalDots count={p.approval_count} threshold={threshold} gold />}
        {!closed && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {ready && blocker && <BlockedNote reason={blocker} />}
            {canCancel && <CancelButton id={p.id} busy={busy} onCancel={onCancel} />}
            {ready
              ? <button onClick={() => onExecute(p.id)} disabled={!!busy || !!blocker} className="h-goldbtn" title={blocker ?? undefined} style={{ background: "#C9A86A", color: "#0A0A0B", border: "none", borderRadius: 8, padding: "9px 18px", fontFamily: SANS, fontSize: 13, fontWeight: 600, cursor: blocker ? "not-allowed" : "pointer", opacity: busy || blocker ? 0.45 : 1 }}>{busy === `execute-${p.id}` ? "Executing…" : "Execute"}</button>
              : iApproved
                ? <span style={{ fontSize: 13, color: "#7FB069", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>✓ You approved · waiting</span>
                : <button onClick={() => onApprove(p.id)} disabled={!!busy} className="h-goldbtn" style={{ background: "#C9A86A", color: "#0A0A0B", border: "none", borderRadius: 8, padding: "9px 18px", fontFamily: SANS, fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>{busy === `approve-${p.id}` ? "Approving…" : "Approve"}</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function CallBadge() {
  return <span style={{ fontFamily: MONO, fontSize: 9, color: "#C9A86A", border: "1px solid rgba(201,168,106,0.4)", borderRadius: 4, padding: "1px 5px", marginLeft: 4 }}>CALL</span>;
}

function BatchBadge() {
  return <span style={{ fontFamily: MONO, fontSize: 9, color: "#ECE7DD", border: "1px solid rgba(236,231,221,0.24)", borderRadius: 4, padding: "1px 5px", marginLeft: 4 }}>BATCH</span>;
}

function PrivateTx({ p, threshold, busy, iApproved, st, call, blocker, canCancel, onCancel, onApproveZk, onExecute }: TxCardProps & { onApproveZk: (id: number) => void; onExecute: (id: number) => void }) {
  const ready = p.approval_count >= threshold;
  const cancelled = !!st?.cancelled;
  const closed = p.executed || cancelled;
  return (
    <div style={{ position: "relative", border: "1px solid rgba(236,231,221,0.10)", borderRadius: 14, background: "linear-gradient(180deg,#0f0f0f,#0c0c0d)", padding: 22, overflow: "hidden", opacity: closed ? 0.8 : 1 }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "#46433c" }} />
      <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(115deg,rgba(236,231,221,0.016) 0 2px,transparent 2px 9px)", pointerEvents: "none" }} />
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, color: "#8A857B", letterSpacing: ".04em" }}>🕶 ANONYMOUS APPROVALS{call ? <CallBadge /> : st?.is_batch ? <BatchBadge /> : null}</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: "#46433c" }}>proposal #{p.id}</span>
      </div>
      <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18, marginBottom: 20 }}>
        <div><div style={{ fontSize: 11, color: "#8A857B", marginBottom: 6 }}>Proposed by</div><div style={{ fontFamily: MONO, fontSize: 14, color: "#ECE7DD" }}>{shortAddr(p.proposer)}</div></div>
        <div><div style={{ fontSize: 11, color: "#8A857B", marginBottom: 6 }}>{call ? "Contract" : "Recipient"}</div><div style={{ fontFamily: MONO, fontSize: 14, color: "#ECE7DD" }}>{call ? shortAddr(call.contract, 5, 4) : st?.is_batch ? "multiple" : shortAddr(p.target)}</div></div>
        {call
          ? <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: "#8A857B", marginBottom: 6 }}>Call</div><div style={{ fontFamily: MONO, fontSize: 15, color: "#ECE7DD" }}>{call.function}<span style={{ color: "#8A857B" }}>({call.args.length})</span></div></div>
          : <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: "#8A857B", marginBottom: 6 }}>{st?.is_batch ? "Batch total" : "Amount"}</div><div style={{ fontFamily: DISPLAY, fontSize: 22, color: "#ECE7DD" }}>{formatXLM(p.amount)} <span style={{ fontSize: 12, fontFamily: MONO, color: "#8A857B" }}>XLM</span></div></div>}
      </div>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", paddingTop: 18, borderTop: "1px solid rgba(236,231,221,0.06)" }}>
        {p.executed
          ? <span style={{ fontSize: 12, color: "#8A857B", display: "inline-flex", alignItems: "center", gap: 8 }}>🔒 executed · the chain never learned who approved</span>
          : cancelled
            ? <span style={{ fontSize: 13, color: "#8A857B", fontWeight: 600 }}>✕ Cancelled</span>
            : <span style={{ fontSize: 13, color: "#8A857B" }}>🔒 {p.approval_count}/{threshold} — voter identities hidden</span>}
        {!closed && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {ready && blocker && <BlockedNote reason={blocker} />}
            {canCancel && <CancelButton id={p.id} busy={busy} onCancel={onCancel} />}
            {ready
              ? <button onClick={() => onExecute(p.id)} disabled={!!busy || !!blocker} className="h-ghost" title={blocker ?? undefined} style={{ background: "transparent", color: "#C9A86A", border: "1px solid rgba(201,168,106,0.45)", borderRadius: 8, padding: "9px 18px", fontFamily: SANS, fontSize: 13, fontWeight: 600, cursor: blocker ? "not-allowed" : "pointer", opacity: blocker ? 0.45 : 1 }}>{busy === `execute-${p.id}` ? "Executing…" : "Execute (ZK)"}</button>
              : iApproved
                ? <span style={{ fontSize: 13, color: "#7FB069", fontWeight: 600 }}>✓ You approved · waiting</span>
                : <button onClick={() => onApproveZk(p.id)} disabled={!!busy} className="h-ghost" style={{ background: "transparent", color: "#C9A86A", border: "1px solid rgba(201,168,106,0.45)", borderRadius: 8, padding: "9px 18px", fontFamily: SANS, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Approve (ZK)</button>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================ PROPOSE ============================ */
function Propose({ go, mode, setMode, submitPropose, submitBatch, submitCall, busy, balance, policy, allowed, spent, allowedContracts }: {
  go: (s: Screen) => void; mode: Mode; setMode: (m: Mode) => void;
  submitPropose: (target: string, amount: string) => void; submitBatch: (items: BatchItem[]) => void;
  submitCall: (contract: string, fn: string, args: CallArg[]) => void;
  busy: string | null; balance: bigint | null; policy: Policy; allowed: string[]; spent: bigint; allowedContracts: string[];
}) {
  const isPrivate = mode === "private";
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"single" | "batch" | "call">("single");
  const batchMode = kind === "batch";
  const [rows, setRows] = useState<{ target: string; amount: string }[]>([{ target: "", amount: "" }]);

  // contract-call form
  const [callTarget, setCallTarget] = useState("");
  const [callFn, setCallFn] = useState("");
  const [callArgs, setCallArgs] = useState<CallArg[]>([]);
  const setArgAt = (i: number, patch: Partial<CallArg>) =>
    setCallArgs((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const callTargetAllowed = allowedContracts.includes(callTarget.trim());
  const callReady =
    /^C[A-Z2-7]{55}$/.test(callTarget.trim()) &&
    /^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/.test(callFn.trim()) &&
    callArgs.every((a) => a.value.trim().length > 0);

  const validAddr = (a: string) => /^[GC][A-Z2-7]{55}$/.test(a.trim());
  const rowAmount = (s: string) => {
    const n = Number(String(s).replace(/,/g, "").trim());
    return isFinite(n) && n > 0 ? n : 0;
  };
  const batchTotalXlm = rows.reduce((s, r) => s + rowAmount(r.amount), 0);
  const totalXlm = batchMode ? batchTotalXlm : rowAmount(amount);
  const recipients = batchMode ? rows.map((r) => r.target.trim()).filter(Boolean) : [target.trim()].filter(Boolean);

  // the same guards the contract will enforce, surfaced before the wallet prompt
  const guardWarnings: string[] = [];
  if (policy.max_per_tx > 0n && totalXlm > xlmFromStroops(policy.max_per_tx)) {
    guardWarnings.push(`Over the per-transaction limit of ${formatXLM(policy.max_per_tx)} XLM.`);
  }
  if (policy.spending_cap > 0n && totalXlm > xlmFromStroops(policy.spending_cap - spent)) {
    guardWarnings.push(`Only ${formatXLM(policy.spending_cap - spent)} XLM left in this spending window.`);
  }
  if (policy.allowlist_only) {
    const blocked = recipients.filter((r) => validAddr(r) && !allowed.includes(r));
    if (blocked.length) guardWarnings.push(`${blocked.length === 1 ? "Recipient is" : `${blocked.length} recipients are`} not on the allowlist.`);
  }
  const timelockNote = policy.timelock_ledgers > 0 ? `Executable ${ledgersToHuman(policy.timelock_ledgers)} after proposing (time-lock).` : null;

  const batchReady = rows.length > 0 && rows.every((r) => validAddr(r.target) && rowAmount(r.amount) > 0);
  const setRowAt = (i: number, patch: Partial<{ target: string; amount: string }>) =>
    setRows((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const submit = () => {
    if (kind === "call") return submitCall(callTarget, callFn, callArgs);
    if (kind === "single") return submitPropose(target, amount);
    submitBatch(rows.map((r) => ({ target: r.target.trim(), amount: stroopsFromXlm(r.amount) })));
  };

  return (
    <div>
      <button onClick={() => go("vault")} className="h-navtext" style={{ background: "transparent", border: "none", color: "#8A857B", fontFamily: SANS, fontSize: 13, cursor: "pointer", marginBottom: 18, padding: 0 }}>← Orbital Treasury</button>
      <h1 style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 32, marginBottom: 8 }}>New transaction</h1>
      <p style={{ fontSize: 14, color: "#8A857B", marginBottom: 28 }}>Choose how much the chain is allowed to reveal — then propose for your co-signers to approve.</p>

      <div style={{ position: "relative", display: "flex", background: "#0d0d0e", border: "1px solid rgba(236,231,221,0.10)", borderRadius: 13, padding: 5, marginBottom: 28, maxWidth: 520 }}>
        <div style={{ position: "absolute", top: 5, bottom: 5, left: 5, width: "calc(50% - 5px)", borderRadius: 9, background: isPrivate ? "rgba(236,231,221,0.04)" : "rgba(201,168,106,0.12)", border: `1px solid ${isPrivate ? "rgba(236,231,221,0.16)" : "rgba(201,168,106,0.45)"}`, transition: "transform .32s cubic-bezier(.4,0,.2,1),background .32s,border-color .32s", transform: isPrivate ? "translateX(100%)" : "translateX(0)" }} />
        <button onClick={() => setMode("transparent")} style={{ position: "relative", zIndex: 2, flex: 1, background: "transparent", border: "none", cursor: "pointer", padding: 14, fontFamily: SANS, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, color: isPrivate ? "#8A857B" : "#C9A86A" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 600, whiteSpace: "nowrap" }}>◎ Transparent</span>
          <span style={{ fontSize: 11, color: "#8A857B" }}>Everything visible</span>
        </button>
        <button onClick={() => setMode("private")} style={{ position: "relative", zIndex: 2, flex: 1, background: "transparent", border: "none", cursor: "pointer", padding: 14, fontFamily: SANS, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, color: isPrivate ? "#ECE7DD" : "#8A857B" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 600, whiteSpace: "nowrap" }}>🕶 Anonymous approvals</span>
          <span style={{ fontSize: 11, color: "#8A857B" }}>Hides who approved</span>
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 28, alignItems: "start" }}>
        <div style={{ border: `1px solid ${isPrivate ? "rgba(236,231,221,0.1)" : "rgba(201,168,106,0.24)"}`, borderRadius: 15, background: isPrivate ? "#0d0d0d" : "linear-gradient(180deg,#15140f,#111110)", padding: 28, transition: "border-color .3s,background .3s" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 22 }}>
            {([["Single payment", "single"], ["Batch", "batch"], ["Contract call", "call"]] as const).map(([label, v]) => (
              <button key={v} onClick={() => setKind(v)} style={{ flex: 1, background: kind === v ? "rgba(201,168,106,0.12)" : "transparent", border: `1px solid ${kind === v ? "rgba(201,168,106,0.45)" : "rgba(236,231,221,0.10)"}`, color: kind === v ? "#C9A86A" : "#8A857B", borderRadius: 9, padding: "10px 12px", fontFamily: SANS, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{label}</button>
            ))}
          </div>

          {kind === "call" ? (
            <>
              <label style={{ display: "block", fontSize: 13, color: "#ECE7DD", fontWeight: 600, marginBottom: 6 }}>Contract</label>
              <p style={{ fontSize: 12.5, color: "#8A857B", marginBottom: 12, lineHeight: 1.55 }}>
                The vault calls it <span style={{ color: "#ECE7DD" }}>as itself</span> — a swap, a deposit, or moving an asset this vault wasn&apos;t created with. Only allowlisted contracts can be called.
              </p>
              <input value={callTarget} onChange={(e) => setCallTarget(e.target.value)} placeholder="C…" style={{ width: "100%", background: "#0d0d0e", border: `1px solid ${callTarget && !callTargetAllowed ? "rgba(196,93,74,0.5)" : "rgba(236,231,221,0.10)"}`, borderRadius: 10, padding: "13px 15px", color: "#ECE7DD", fontFamily: MONO, fontSize: 13, marginBottom: 8 }} />
              {allowedContracts.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "#C45D4A", marginBottom: 18 }}>
                  No contracts are allowlisted yet — add one under <span style={{ color: "#C9A86A" }}>Guards</span> before a call can be proposed.
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
                  {allowedContracts.map((c) => (
                    <button key={c} onClick={() => setCallTarget(c)} style={{ background: callTarget.trim() === c ? "rgba(201,168,106,0.12)" : "#0d0d0e", border: `1px solid ${callTarget.trim() === c ? "#C9A86A" : "rgba(236,231,221,0.12)"}`, color: callTarget.trim() === c ? "#C9A86A" : "#8A857B", borderRadius: 7, padding: "6px 10px", fontFamily: MONO, fontSize: 11.5, cursor: "pointer" }}>{shortContract(c)}</button>
                  ))}
                </div>
              )}

              <label style={{ display: "block", fontSize: 13, color: "#ECE7DD", fontWeight: 600, marginBottom: 10 }}>Function</label>
              <input value={callFn} onChange={(e) => setCallFn(e.target.value)} placeholder="transfer" style={{ width: "100%", background: "#0d0d0e", border: "1px solid rgba(236,231,221,0.10)", borderRadius: 10, padding: "13px 15px", color: "#ECE7DD", fontFamily: MONO, fontSize: 14, marginBottom: 22 }} />

              <label style={{ display: "block", fontSize: 13, color: "#ECE7DD", fontWeight: 600, marginBottom: 6 }}>Arguments</label>
              <p style={{ fontSize: 12.5, color: "#8A857B", marginBottom: 14, lineHeight: 1.55 }}>
                Soroban is typed, so each argument needs its type — a number alone doesn&apos;t say whether it&apos;s an <span style={{ fontFamily: MONO }}>i128</span> or a <span style={{ fontFamily: MONO }}>u32</span>. Order must match the function&apos;s signature.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
                {callArgs.map((a, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: "#5a564d", width: 16 }}>{i}</span>
                    <select value={a.type} onChange={(e) => setArgAt(i, { type: e.target.value as CallArgType })} style={{ background: "#0d0d0e", border: "1px solid rgba(236,231,221,0.10)", borderRadius: 9, padding: "11px 9px", color: "#C9A86A", fontFamily: MONO, fontSize: 12.5 }}>
                      {["address", "i128", "u32", "u64", "bool", "symbol", "string"].map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input value={a.value} onChange={(e) => setArgAt(i, { value: e.target.value })} placeholder={a.type === "address" ? "G… / C…" : a.type === "bool" ? "true" : "value"} style={{ flex: 1, background: "#0d0d0e", border: "1px solid rgba(236,231,221,0.10)", borderRadius: 9, padding: "11px 13px", color: "#ECE7DD", fontFamily: MONO, fontSize: 13 }} />
                    <button onClick={() => setCallArgs((xs) => xs.filter((_, j) => j !== i))} className="h-x" style={{ background: "transparent", border: "none", color: "#5a564d", cursor: "pointer", fontSize: 18, padding: "0 4px" }}>×</button>
                  </div>
                ))}
              </div>
              <button onClick={() => setCallArgs((xs) => [...xs, { type: "address", value: "" }])} className="h-addsigner" style={{ background: "transparent", border: "1px dashed rgba(236,231,221,0.18)", color: "#8A857B", fontFamily: SANS, fontSize: 13, padding: 10, width: "100%", borderRadius: 9, cursor: "pointer", marginBottom: 22 }}>+ Add argument</button>
            </>
          ) : kind === "single" ? (
            <>
              <label style={{ display: "block", fontSize: 13, color: "#ECE7DD", fontWeight: 600, marginBottom: 10 }}>Recipient address</label>
              <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="G…" style={{ width: "100%", background: "#0d0d0e", border: "1px solid rgba(236,231,221,0.10)", borderRadius: 10, padding: "13px 15px", color: "#ECE7DD", fontFamily: MONO, fontSize: 14, marginBottom: 22 }} />
              <label style={{ display: "block", fontSize: 13, color: "#ECE7DD", fontWeight: 600, marginBottom: 10 }}>Amount</label>
              <div style={{ display: "flex", alignItems: "center", background: "#0d0d0e", border: "1px solid rgba(236,231,221,0.10)", borderRadius: 10, padding: "0 15px", marginBottom: 22 }}>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" style={{ flex: 1, background: "transparent", border: "none", padding: "14px 0", color: "#ECE7DD", fontFamily: DISPLAY, fontSize: 22 }} />
                <span style={{ fontFamily: MONO, fontSize: 13, color: "#8A857B", borderLeft: "1px solid rgba(236,231,221,0.1)", paddingLeft: 14 }}>XLM</span>
              </div>
            </>
          ) : (
            <>
              <label style={{ display: "block", fontSize: 13, color: "#ECE7DD", fontWeight: 600, marginBottom: 6 }}>Payments</label>
              <p style={{ fontSize: 12.5, color: "#8A857B", marginBottom: 14, lineHeight: 1.5 }}>One approval round for all of them — they settle together or not at all. Up to 20 per batch.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
                {rows.map((r, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input value={r.target} onChange={(e) => setRowAt(i, { target: e.target.value })} placeholder="G…" style={{ flex: 1, background: "#0d0d0e", border: `1px solid ${r.target && !validAddr(r.target) ? "rgba(196,93,74,0.5)" : "rgba(236,231,221,0.10)"}`, borderRadius: 9, padding: "11px 13px", color: "#ECE7DD", fontFamily: MONO, fontSize: 13 }} />
                    <input value={r.amount} onChange={(e) => setRowAt(i, { amount: e.target.value })} placeholder="0.00" style={{ width: 110, background: "#0d0d0e", border: "1px solid rgba(236,231,221,0.10)", borderRadius: 9, padding: "11px 13px", color: "#ECE7DD", fontFamily: MONO, fontSize: 13 }} />
                    <button onClick={() => setRows((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : xs))} className="h-x" style={{ background: "transparent", border: "none", color: "#5a564d", cursor: "pointer", fontSize: 18, padding: "0 4px" }}>×</button>
                  </div>
                ))}
              </div>
              <button onClick={() => setRows((xs) => (xs.length < 20 ? [...xs, { target: "", amount: "" }] : xs))} className="h-addsigner" style={{ background: "transparent", border: "1px dashed rgba(236,231,221,0.18)", color: "#8A857B", fontFamily: SANS, fontSize: 13, padding: 10, width: "100%", borderRadius: 9, cursor: "pointer", marginBottom: 18 }}>+ Add payment</button>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderTop: "1px solid rgba(236,231,221,0.08)", paddingTop: 14, marginBottom: 22 }}>
                <span style={{ fontSize: 13, color: "#8A857B" }}>Batch total · {rows.length} payment{rows.length === 1 ? "" : "s"}</span>
                <span style={{ fontFamily: DISPLAY, fontSize: 24, color: "#ECE7DD" }}>{batchTotalXlm.toLocaleString(undefined, { maximumFractionDigits: 7 })} <span style={{ fontSize: 12, fontFamily: MONO, color: "#8A857B" }}>XLM</span></span>
              </div>
            </>
          )}

          {kind !== "call" && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: "#8A857B", marginBottom: 22 }}>
              <span>Vault balance · {balance != null ? formatXLM(balance) : "—"} XLM</span>
              {!batchMode && <span style={{ color: "#C9A86A", cursor: "pointer" }} onClick={() => balance != null && setAmount(formatXLM(balance).replace(/,/g, ""))}>Max</span>}
            </div>
          )}

          {/* a refusal and a heads-up are different things — never in the same box */}
          {kind === "call" && (
            <div style={{ border: "1px solid rgba(201,168,106,0.22)", borderRadius: 11, background: "#0c0c0d", padding: 16, marginBottom: 22 }}>
              <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".14em", color: "#C9A86A", marginBottom: 9 }}>HOW GUARDS APPLY HERE</div>
              <div style={{ fontSize: 12.5, color: "#8A857B", lineHeight: 1.65 }}>
                The threshold and the time-lock still apply. The amount guards don&apos;t — a call carries no amount the vault can read, so <span style={{ color: "#ECE7DD" }}>the allowlist is the guard</span>: it can only call contracts you approved.
              </div>
            </div>
          )}

          {kind !== "call" && guardWarnings.length > 0 && (
            <div style={{ border: "1px solid rgba(196,93,74,0.32)", borderRadius: 11, background: "#0c0c0d", padding: 16, marginBottom: 14 }}>
              <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".14em", color: "#C45D4A", marginBottom: 9 }}>GUARDS WILL REJECT THIS</div>
              {guardWarnings.map((w) => (
                <div key={w} style={{ fontSize: 12.5, color: "#ECE7DD", lineHeight: 1.6 }}>• {w}</div>
              ))}
            </div>
          )}
          {kind !== "call" && timelockNote && (
            <div style={{ display: "flex", gap: 10, border: "1px solid rgba(201,168,106,0.22)", borderRadius: 11, background: "#0c0c0d", padding: 14, marginBottom: 22 }}>
              <span style={{ color: "#C9A86A", lineHeight: 1.4 }}>⏻</span>
              <div style={{ fontSize: 12.5, color: "#8A857B", lineHeight: 1.55 }}>
                <span style={{ color: "#ECE7DD" }}>This will propose fine.</span> {timelockNote}
              </div>
            </div>
          )}
          {isPrivate && (
            <div className="vs-rise" style={{ display: "flex", gap: 12, border: "1px solid rgba(236,231,221,0.12)", borderRadius: 11, background: "#0c0c0d", padding: 16, marginBottom: 22 }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>🔒</span>
              <div>
                <div style={{ fontSize: 13, color: "#ECE7DD", fontWeight: 600, marginBottom: 5 }}>Approver identities will be hidden</div>
                <div style={{ fontSize: 12.5, color: "#8A857B", lineHeight: 1.55 }}>Co-signers see the amount and recipient — they are approving it — but each approval is a zero-knowledge proof, so the chain records only a nullifier and never <span style={{ color: "#ECE7DD" }}>who</span> signed. This hides the approvers, not the amount. To hide <span style={{ color: "#ECE7DD" }}>how much</span>, pay from the vault&apos;s hidden balance instead.</div>
              </div>
            </div>
          )}
          {(() => {
            // if we already know a guard will refuse this, don't offer a button
            // that looks live — the contract would reject it anyway
            const blocked = kind !== "call" && guardWarnings.length > 0;
            const disabled =
              busy === "propose" || blocked || (batchMode && !batchReady) || (kind === "call" && !callReady);
            const label = busy === "propose"
              ? "Proposing…"
              : blocked
                ? "Blocked by guards"
                : kind === "call"
                  ? `Propose call · ${callFn.trim() || "function"}()`
                  : batchMode
                    ? `Propose batch of ${rows.length} · sign with wallet`
                    : "Propose · sign with wallet";
            return (
              <button onClick={submit} disabled={disabled} className={blocked ? undefined : "h-goldbtn"} style={{ width: "100%", background: blocked ? "transparent" : "#C9A86A", color: blocked ? "#C45D4A" : "#0A0A0B", border: blocked ? "1px solid rgba(196,93,74,0.4)" : "none", fontFamily: SANS, fontWeight: 600, fontSize: 15, padding: 15, borderRadius: 11, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled && !blocked ? 0.5 : 1 }}>
                {label}
              </button>
            );
          })()}
        </div>

        <div style={{ position: "sticky", top: 96 }}>
          <div style={{ fontSize: 11, color: "#8A857B", fontFamily: MONO, letterSpacing: ".16em", marginBottom: 12 }}>HOW CO-SIGNERS WILL SEE IT</div>
          {!isPrivate ? (
            <div className="vs-rise" style={{ position: "relative", border: "1px solid rgba(201,168,106,0.3)", borderRadius: 14, background: "linear-gradient(180deg,#16150f,#121210)", padding: 22, overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,transparent,#C9A86A,transparent)" }} />
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, color: "#C9A86A", marginBottom: 18 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#C9A86A", boxShadow: "0 0 10px #C9A86A" }} />TRANSPARENT</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 6 }}>
                <Row label="Proposed by" value="You" />
                <Row label={kind === "call" ? "Contract" : "Recipient"} value={kind === "call" ? (callTarget ? shortAddr(callTarget, 5, 4) : "C…") : batchMode ? `${rows.length} recipients` : target ? shortAddr(target) : "G…"} mono />
                {kind === "call" ? (
                  <Row label="Call" value={`${callFn.trim() || "fn"}(${callArgs.length} args)`} mono />
                ) : (
                  <Row label={batchMode ? "Batch total" : "Amount"} value={`${(batchMode ? batchTotalXlm.toLocaleString(undefined, { maximumFractionDigits: 7 }) : amount) || "0.00"} XLM`} mono />
                )}
                <div style={{ height: 1, background: "rgba(236,231,221,0.08)" }} />
                <Row label="Approvals" value="visible to all" />
              </div>
            </div>
          ) : (
            <div className="vs-rise" style={{ position: "relative", border: "1px solid rgba(236,231,221,0.1)", borderRadius: 14, background: "linear-gradient(180deg,#0f0f0f,#0c0c0d)", padding: 22, overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(115deg,rgba(236,231,221,0.016) 0 2px,transparent 2px 9px)", pointerEvents: "none" }} />
              <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, color: "#8A857B", marginBottom: 18 }}>🕶 ANONYMOUS APPROVALS</span>
              <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 14, marginTop: 6 }}>
                <Row label="Proposed by" value="You" />
                <Row label={kind === "call" ? "Contract" : "Recipient"} value={kind === "call" ? (callTarget ? shortAddr(callTarget, 5, 4) : "C…") : batchMode ? `${rows.length} recipients` : target ? shortAddr(target) : "G…"} mono />
                {kind === "call" ? (
                  <Row label="Call" value={`${callFn.trim() || "fn"}(${callArgs.length} args)`} mono />
                ) : (
                  <Row label={batchMode ? "Batch total" : "Amount"} value={`${(batchMode ? batchTotalXlm.toLocaleString(undefined, { maximumFractionDigits: 7 }) : amount) || "0.00"} XLM`} mono />
                )}
                <div style={{ height: 1, background: "rgba(236,231,221,0.06)" }} />
                <Row label="Approvals" valueNode={<span style={{ color: "#8A857B" }}>🔒 voter identities hidden (ZK)</span>} />
              </div>
              <div style={{ position: "relative", marginTop: 16, display: "flex", alignItems: "center", gap: 8, fontFamily: MONO, fontSize: 10, color: "#8A857B" }}>
                <Pill>ZK · Groth16</Pill><Pill>nullifier-gated</Pill>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================ GUARDS ============================ */
/** Preset windows for the spending cap, in ledgers (~5s each). */
const CAP_WINDOWS: [string, number][] = [["1 hour", 720], ["6 hours", 4320], ["1 day", 17280], ["1 week", 120960]];
const TIMELOCK_PRESETS: [string, number][] = [["Off", 0], ["5 min", 60], ["1 hour", 720], ["1 day", 17280]];

function Guards({ go, wallet, config, policy, allowed, spent, busy, zkConfig, allowedContracts, version, onUpgrade, onSave, onAllowRecipient, onRegisterKey, onPublishSignerSet, myLeaf, commitments, onAllowContract }: {
  go: (s: Screen) => void; wallet: string | null; config: VaultConfig | null;
  policy: Policy; allowed: string[]; spent: bigint; busy: string | null; zkConfig: ZkConfig | null; allowedContracts: string[]; version: number | null;
  onUpgrade: () => void;
  onSave: (p: Policy) => void; onAllowRecipient: (target: string, allow: boolean) => void; onRegisterKey: () => void; onPublishSignerSet: (raw: string) => void; myLeaf: bigint | null; commitments: bigint[]; onAllowContract: (contract: string, allow: boolean) => void;
}) {
  const isOwner = !!wallet && wallet === config?.owner;
  const [maxPerTx, setMaxPerTx] = useState(policy.max_per_tx > 0n ? String(xlmFromStroops(policy.max_per_tx)) : "");
  const [cap, setCap] = useState(policy.spending_cap > 0n ? String(xlmFromStroops(policy.spending_cap)) : "");
  const [window, setWindow] = useState(policy.cap_window_ledgers || 17280);
  const [timelock, setTimelock] = useState(policy.timelock_ledgers);
  const [allowlistOnly, setAllowlistOnly] = useState(policy.allowlist_only);
  const [newRecipient, setNewRecipient] = useState("");
  const [newCallee, setNewCallee] = useState("");
  const [pastedLeaves, setPastedLeaves] = useState("");

  // the vault is the source of truth — resync whenever a fresh read lands
  useEffect(() => {
    setMaxPerTx(policy.max_per_tx > 0n ? String(xlmFromStroops(policy.max_per_tx)) : "");
    setCap(policy.spending_cap > 0n ? String(xlmFromStroops(policy.spending_cap)) : "");
    setWindow(policy.cap_window_ledgers || 17280);
    setTimelock(policy.timelock_ledgers);
    setAllowlistOnly(policy.allowlist_only);
  }, [policy]);

  const card: React.CSSProperties = { border: "1px solid rgba(236,231,221,0.08)", borderRadius: 15, background: "#121211", padding: 26, marginBottom: 18 };
  const input: React.CSSProperties = { width: "100%", background: "#0d0d0e", border: "1px solid rgba(236,231,221,0.10)", borderRadius: 9, padding: "12px 14px", color: "#ECE7DD", fontFamily: MONO, fontSize: 14 };
  const chip = (active: boolean): React.CSSProperties => ({
    background: active ? "rgba(201,168,106,0.12)" : "#0d0d0e",
    border: `1px solid ${active ? "#C9A86A" : "rgba(236,231,221,0.12)"}`,
    color: active ? "#C9A86A" : "#8A857B",
    borderRadius: 8, padding: "9px 14px", fontFamily: SANS, fontSize: 13, fontWeight: 600, cursor: "pointer",
  });

  let parseError = "";
  let next: Policy | null = null;
  try {
    next = {
      max_per_tx: maxPerTx.trim() ? stroopsFromXlm(maxPerTx) : 0n,
      spending_cap: cap.trim() ? stroopsFromXlm(cap) : 0n,
      cap_window_ledgers: window,
      timelock_ledgers: timelock,
      allowlist_only: allowlistOnly,
    };
  } catch (e: any) {
    parseError = e.message;
  }
  const dirty = !!next && (
    next.max_per_tx !== policy.max_per_tx ||
    next.spending_cap !== policy.spending_cap ||
    (next.spending_cap > 0n && next.cap_window_ledgers !== (policy.cap_window_ledgers || 17280)) ||
    next.timelock_ledgers !== policy.timelock_ledgers ||
    next.allowlist_only !== policy.allowlist_only
  );

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <button onClick={() => go("vault")} className="h-navtext" style={{ background: "transparent", border: "none", color: "#8A857B", fontFamily: SANS, fontSize: 13, cursor: "pointer", marginBottom: 20, padding: 0 }}>← Back to vault</button>
      <h1 style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 34, marginBottom: 8 }}>Guards</h1>
      <p style={{ fontSize: 14, color: "#8A857B", marginBottom: 12, lineHeight: 1.6 }}>
        Rules the contract enforces on every execution — on top of the m-of-n threshold. This is what a smart-contract vault can do that native multi-sig can't.
      </p>

      {!isOwner && (
        <div style={{ border: "1px solid rgba(236,231,221,0.12)", borderRadius: 11, background: "#0c0c0d", padding: 14, marginBottom: 22, fontSize: 13, color: "#8A857B" }}>
          Read-only — only the vault owner{config?.owner ? ` (${shortAddr(config.owner)})` : ""} can change guards.
        </div>
      )}

      {/* A vault keeps whatever code it was deployed with; pointing the factory
          at a newer build only affects vaults created after. So a fix reaches an
          existing vault through here, or not at all. */}
      {version === null ? (
        <div style={{ border: "1px solid rgba(196,93,74,0.3)", borderRadius: 11, background: "#0c0c0d", padding: 16, marginBottom: 22 }}>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".14em", color: "#C45D4A", marginBottom: 8 }}>OLDEST BUILD</div>
          <div style={{ fontSize: 13, color: "#8A857B", lineHeight: 1.6 }}>
            This vault predates versioning and has no upgrade entry point, so it cannot be moved forward — guards, contract calls and hidden amounts will never appear on it. Its funds are safe; create a new vault to use the current features.
          </div>
        </div>
      ) : (
        version < 4 && (
          <div style={{ border: "1px solid rgba(201,168,106,0.35)", borderRadius: 11, background: "linear-gradient(180deg,#16150f,#121210)", padding: 16, marginBottom: 22 }}>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".14em", color: "#C9A86A", marginBottom: 8 }}>OLDER BUILD · v{version}</div>
            <div style={{ fontSize: 13, color: "#ECE7DD", lineHeight: 1.6, marginBottom: 14 }}>
              This vault runs older code than new vaults are created with, so some features are missing or will fail when executed. Upgrading keeps its address, balance, signers and guards exactly as they are.
            </div>
            {isOwner ? (
              <button onClick={onUpgrade} disabled={busy === "upgrade"} className="h-goldbtn" style={{ width: "100%", background: "#C9A86A", color: "#0A0A0B", fontFamily: SANS, fontWeight: 600, fontSize: 14, padding: 13, border: "none", borderRadius: 10, cursor: "pointer", opacity: busy === "upgrade" ? 0.6 : 1 }}>
                {busy === "upgrade" ? "Upgrading…" : "Upgrade this vault"}
              </button>
            ) : (
              <div style={{ fontSize: 12.5, color: "#5a564d", fontStyle: "italic" }}>Only the owner can upgrade it.</div>
            )}
          </div>
        )
      )}

      <div style={card}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Per-transaction limit</div>
        <p style={{ fontSize: 13, color: "#8A857B", marginBottom: 14 }}>The largest single execution allowed. Leave empty for no limit. A batch is judged on its total.</p>
        <input value={maxPerTx} onChange={(e) => setMaxPerTx(e.target.value)} disabled={!isOwner} placeholder="No limit" style={input} />
      </div>

      <div style={card}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Spending cap</div>
        <p style={{ fontSize: 13, color: "#8A857B", marginBottom: 14 }}>A rolling budget: total executed within one window can't exceed this. Empty = uncapped.</p>
        <input value={cap} onChange={(e) => setCap(e.target.value)} disabled={!isOwner} placeholder="Uncapped" style={{ ...input, marginBottom: 14 }} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {CAP_WINDOWS.map(([label, v]) => (
            <button key={label} onClick={() => isOwner && setWindow(v)} disabled={!isOwner} style={chip(window === v)}>{label}</button>
          ))}
        </div>
        {policy.spending_cap > 0n && <CapMeter spent={spent} cap={policy.spending_cap} />}
      </div>

      <div style={card}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Time-lock</div>
        <p style={{ fontSize: 13, color: "#8A857B", marginBottom: 14 }}>A cooling-off period between proposing and executing — the window in which co-signers can cancel a bad transaction.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {TIMELOCK_PRESETS.map(([label, v]) => (
            <button key={label} onClick={() => isOwner && setTimelock(v)} disabled={!isOwner} style={chip(timelock === v)}>{label}</button>
          ))}
        </div>
      </div>

      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Recipient allowlist</div>
          <button onClick={() => isOwner && setAllowlistOnly(!allowlistOnly)} disabled={!isOwner} style={chip(allowlistOnly)}>{allowlistOnly ? "On" : "Off"}</button>
        </div>
        <p style={{ fontSize: 13, color: "#8A857B", marginBottom: 16 }}>When on, funds can only go to addresses on this list — proposals to anyone else are refused at propose time and again at execute.</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          {allowed.map((a) => (
            <div key={a} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0d0d0e", border: "1px solid rgba(236,231,221,0.08)", borderRadius: 9, padding: "10px 13px" }}>
              <span style={{ fontFamily: MONO, fontSize: 12.5, color: "#ECE7DD" }}>{shortAddr(a, 8, 6)}</span>
              {isOwner && (
                <button onClick={() => onAllowRecipient(a, false)} disabled={!!busy} className="h-x" style={{ background: "transparent", border: "none", color: "#5a564d", cursor: "pointer", fontSize: 13 }}>remove</button>
              )}
            </div>
          ))}
          {!allowed.length && <div style={{ fontSize: 13, color: "#5a564d", fontStyle: "italic" }}>No recipients allowed yet — turning the allowlist on now would block every payment.</div>}
        </div>

        {isOwner && (
          <div style={{ display: "flex", gap: 8 }}>
            <input value={newRecipient} onChange={(e) => setNewRecipient(e.target.value)} placeholder="G…" style={{ ...input, flex: 1 }} />
            <button
              onClick={() => { onAllowRecipient(newRecipient.trim(), true); setNewRecipient(""); }}
              disabled={!/^[GC][A-Z2-7]{55}$/.test(newRecipient.trim()) || !!busy}
              className="h-goldbtn"
              style={{ background: "#C9A86A", color: "#0A0A0B", border: "none", borderRadius: 9, padding: "0 18px", fontFamily: SANS, fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: /^[GC][A-Z2-7]{55}$/.test(newRecipient.trim()) ? 1 : 0.45 }}
            >Allow</button>
          </div>
        )}
      </div>

      <div style={card}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Callable contracts</div>
        <p style={{ fontSize: 13, color: "#8A857B", marginBottom: 16, lineHeight: 1.6 }}>
          Proposals can call these contracts — a DEX, a lending market, another token. Nothing outside the list is callable, and the list starts empty. This is the guard for calls: the amount limits can&apos;t apply, because a call carries no amount the vault can read.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          {allowedContracts.map((c) => (
            <div key={c} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0d0d0e", border: "1px solid rgba(236,231,221,0.08)", borderRadius: 9, padding: "10px 13px" }}>
              <span style={{ fontFamily: MONO, fontSize: 12.5, color: "#ECE7DD" }}>{shortAddr(c, 8, 6)}</span>
              {isOwner && (
                <button onClick={() => onAllowContract(c, false)} disabled={!!busy} className="h-x" style={{ background: "transparent", border: "none", color: "#5a564d", cursor: "pointer", fontSize: 13 }}>remove</button>
              )}
            </div>
          ))}
          {!allowedContracts.length && <div style={{ fontSize: 13, color: "#5a564d", fontStyle: "italic" }}>None — this vault cannot call any contract.</div>}
        </div>

        {isOwner && (
          <>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={newCallee} onChange={(e) => setNewCallee(e.target.value)} placeholder="C…" style={{ ...input, flex: 1 }} />
              <button
                onClick={() => { onAllowContract(newCallee.trim(), true); setNewCallee(""); }}
                disabled={!/^C[A-Z2-7]{55}$/.test(newCallee.trim()) || !!busy}
                className="h-goldbtn"
                style={{ background: "#C9A86A", color: "#0A0A0B", border: "none", borderRadius: 9, padding: "0 18px", fontFamily: SANS, fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: /^C[A-Z2-7]{55}$/.test(newCallee.trim()) ? 1 : 0.45 }}
              >Allow</button>
            </div>
            <p style={{ fontSize: 11.5, color: "#5a564d", marginTop: 10, fontFamily: MONO, lineHeight: 1.6 }}>
              The vault itself can never be added — one passing proposal would otherwise be able to lift every guard.
            </p>
          </>
        )}
      </div>

      <div style={{ ...card, borderColor: zkConfig ? "rgba(127,176,105,0.3)" : "rgba(236,231,221,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>On-chain proof verification</div>
          <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".12em", color: zkConfig ? "#7FB069" : "#C45D4A", border: `1px solid ${zkConfig ? "rgba(127,176,105,0.4)" : "rgba(196,93,74,0.35)"}`, borderRadius: 6, padding: "3px 8px" }}>
            {zkConfig ? "ENFORCED" : "NOT ENFORCED"}
          </span>
        </div>
        {zkConfig ? (
          <>
            <p style={{ fontSize: 13, color: "#8A857B", marginBottom: 16, lineHeight: 1.6 }}>
              Every ZK approval is verified by a Groth16 verifier contract, and its public inputs are pinned to this vault, this signer set and the specific proposal. A proof for another vault, or against a signer set you never published, is refused.
            </p>
            <PolicyRow label="Verifier" valueNode={<span style={{ fontFamily: MONO, fontSize: 12, color: "#ECE7DD" }}>{shortAddr(zkConfig.verifier, 6, 5)}</span>} />
            <PolicyRow label="Signer root" valueNode={<span style={{ fontFamily: MONO, fontSize: 11.5, color: "#8A857B" }}>0x{zkConfig.signer_root.toString(16).slice(0, 14)}…</span>} />
            <PolicyRow label="Published leaves" valueNode={<span style={{ fontFamily: MONO, fontSize: 12, color: "#ECE7DD" }}>{commitments.length}</span>} />
            <p style={{ fontSize: 11.5, color: "#5a564d", marginTop: 12, fontFamily: MONO, lineHeight: 1.6 }}>
              Leaves are published in a shuffled order. A list in signer order would let anyone match a nullifier back to the signer who produced it.
            </p>
          </>
        ) : (
          <p style={{ fontSize: 13, color: "#8A857B", marginBottom: 4, lineHeight: 1.6 }}>
            This vault records the nullifier of a ZK approval but does not check the proof. Publish a signer set below to turn on real verification.
          </p>
        )}
      </div>

      <div style={card}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Your signing key</div>
        <p style={{ fontSize: 13, color: "#8A857B", marginBottom: 16, lineHeight: 1.6 }}>
          Your approval key is derived from a wallet signature, so only you can produce it and nobody can guess your commitment. Derive it here and send the value to the vault owner — over any channel. The secret behind it never leaves this browser, and nothing is written on-chain.
        </p>
        <button onClick={onRegisterKey} disabled={busy === "register"} className="h-goldbtn" style={{ width: "100%", background: "transparent", color: "#C9A86A", border: "1px solid rgba(201,168,106,0.45)", fontFamily: SANS, fontWeight: 600, fontSize: 14, padding: 13, borderRadius: 10, cursor: "pointer", opacity: busy === "register" ? 0.6 : 1 }}>
          {busy === "register" ? "Check Freighter…" : "Derive my commitment"}
        </button>
        {myLeaf != null && (
          <div style={{ marginTop: 14, border: "1px solid rgba(127,176,105,0.3)", borderRadius: 10, background: "#0c0c0d", padding: 14 }}>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".14em", color: "#7FB069", marginBottom: 8 }}>YOUR COMMITMENT</div>
            <div style={{ fontFamily: MONO, fontSize: 11.5, color: "#ECE7DD", wordBreak: "break-all", lineHeight: 1.5 }}>{myLeaf.toString()}</div>
            <button onClick={() => navigator.clipboard?.writeText(myLeaf.toString())} className="h-copy" style={{ marginTop: 10, background: "transparent", border: "none", color: "#C9A86A", fontFamily: SANS, fontSize: 12.5, cursor: "pointer", padding: 0 }}>⧉ copy</button>
          </div>
        )}
      </div>

      {isOwner && (
        <div style={card}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Publish the signer set</div>
          <p style={{ fontSize: 13, color: "#8A857B", marginBottom: 14, lineHeight: 1.6 }}>
            Paste one commitment per signer, collected from each of them. They get shuffled before publishing, so the on-chain order says nothing about who is who — then the root is pinned and verification is live.
          </p>
          <textarea
            value={pastedLeaves}
            onChange={(e) => setPastedLeaves(e.target.value)}
            placeholder={"1234…\n5678…\n9012…"}
            rows={4}
            style={{ ...input, width: "100%", resize: "vertical", fontSize: 12, lineHeight: 1.5, marginBottom: 12 }}
          />
          <button
            onClick={() => onPublishSignerSet(pastedLeaves)}
            disabled={!pastedLeaves.trim() || busy === "zk"}
            className="h-goldbtn"
            style={{ width: "100%", background: "#C9A86A", color: "#0A0A0B", fontFamily: SANS, fontWeight: 600, fontSize: 14, padding: 13, border: "none", borderRadius: 10, cursor: "pointer", opacity: pastedLeaves.trim() && busy !== "zk" ? 1 : 0.45 }}
          >
            {busy === "zk" ? "Publishing…" : zkConfig ? "Republish signer set" : "Publish & enable verification"}
          </button>
          <p style={{ fontSize: 11.5, color: "#5a564d", marginTop: 10, fontFamily: MONO, lineHeight: 1.6 }}>
            Adding or removing a signer means republishing, or their proofs stop verifying.
          </p>
        </div>
      )}

      {isOwner && (
        <>
          {parseError && <div style={{ fontSize: 13, color: "#C45D4A", marginBottom: 12 }}>{parseError}</div>}
          <button
            onClick={() => next && onSave(next)}
            disabled={!dirty || !!parseError || busy === "policy"}
            className="h-goldbtn"
            style={{ width: "100%", background: "#C9A86A", color: "#0A0A0B", fontFamily: SANS, fontWeight: 600, fontSize: 15, padding: 15, border: "none", borderRadius: 11, cursor: dirty ? "pointer" : "not-allowed", opacity: dirty && !parseError ? 1 : 0.45 }}
          >
            {busy === "policy" ? "Saving · check Freighter…" : dirty ? "Save guards · sign with wallet" : "No changes to save"}
          </button>
          <p style={{ fontSize: 11.5, color: "#5a564d", textAlign: "center", marginTop: 12, fontFamily: MONO, lineHeight: 1.6 }}>
            Guards apply to pending proposals too — tightening a limit can block one that was already approved.
          </p>
        </>
      )}
    </div>
  );
}

/* ============================ PROOF OVERLAY ============================ */
function ProofOverlay({ stage }: { stage: number }) {
  const step = (idx: number) => {
    const done = stage > idx, active = stage === idx;
    if (done) return { bg: "rgba(127,176,105,0.08)", dot: "#7FB069", mark: "✓", text: "#ECE7DD" };
    if (active) return { bg: "rgba(201,168,106,0.08)", dot: "#C9A86A", mark: "·", text: "#ECE7DD" };
    return { bg: "transparent", dot: "#26241f", mark: `${idx + 1}`, text: "#5a564d" };
  };
  const steps = [
    { s: step(0), label: <>Computing witness</> },
    { s: step(1), label: <>Generating proof <span style={{ fontFamily: MONO, fontSize: 11, color: "#8A857B" }}>(Groth16)</span></> },
    { s: step(2), label: <>Submitting to chain</> },
  ];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(8,8,9,0.86)", backdropFilter: "blur(10px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="vs-rise" style={{ position: "relative", width: 480, border: "1px solid rgba(201,168,106,0.24)", borderRadius: 20, background: "linear-gradient(180deg,#141413,#0e0e0f)", padding: 40, overflow: "hidden", boxShadow: "0 40px 100px rgba(0,0,0,0.6)" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 60, background: "linear-gradient(180deg,rgba(201,168,106,0.06),transparent)", pointerEvents: "none" }} />
        <div style={{ width: 96, height: 96, margin: "0 auto 28px", position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "1px solid rgba(201,168,106,0.16)" }} />
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid transparent", borderTopColor: "#C9A86A", borderRightColor: "#C9A86A", animation: "vsSpin 1.1s linear infinite" }} />
          <div style={{ position: "absolute", inset: 14, borderRadius: "50%", border: "1px dashed rgba(201,168,106,0.3)", animation: "vsSpinR 3s linear infinite" }} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ width: 14, height: 14, borderRadius: 4, background: "#C9A86A", boxShadow: "0 0 20px rgba(201,168,106,0.7)" }} /></div>
        </div>
        <h3 style={{ textAlign: "center", fontFamily: DISPLAY, fontWeight: 500, fontSize: 23, marginBottom: 6 }}>Generating zero-knowledge proof</h3>
        <p style={{ textAlign: "center", fontSize: 13, color: "#8A857B", marginBottom: 28, lineHeight: 1.5 }}>This runs locally in your browser and may take a few seconds.<br />Please keep this tab open.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {steps.map((st, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 13, padding: "12px 14px", borderRadius: 10, background: st.s.bg }}>
              <span style={{ width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", fontSize: 12, fontWeight: 700, background: st.s.dot, color: "#0A0A0B" }}>{st.s.mark}</span>
              <span style={{ fontSize: 14, color: st.s.text }}>{st.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================ TOAST ============================ */
function Toast({ msg }: { msg: NonNullable<ToastMsg> }) {
  const ok = msg.tone === "ok";
  return (
    <div style={{ position: "fixed", bottom: 32, left: "50%", zIndex: 120, display: "flex", alignItems: "center", gap: 12, background: "#141413", border: `1px solid ${ok ? "rgba(201,168,106,0.32)" : "rgba(196,93,74,0.45)"}`, borderRadius: 12, padding: "14px 20px", boxShadow: "0 20px 50px rgba(0,0,0,0.5)", animation: "vsToast .4s cubic-bezier(.2,.7,.2,1) both", maxWidth: 460 }}>
      <span style={{ width: 26, height: 26, borderRadius: "50%", background: ok ? "rgba(127,176,105,0.15)" : "rgba(196,93,74,0.15)", border: `1px solid ${ok ? "rgba(127,176,105,0.5)" : "rgba(196,93,74,0.5)"}`, display: "flex", alignItems: "center", justifyContent: "center", color: ok ? "#7FB069" : "#C45D4A", fontSize: 13, flex: "none" }}>{ok ? "✓" : "!"}</span>
      <div>
        <div style={{ fontSize: 14, color: "#ECE7DD", fontWeight: 600 }}>{msg.title}</div>
        <div style={{ fontSize: 12, color: "#8A857B" }}>{msg.sub}</div>
      </div>
    </div>
  );
}
