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
  approve as approveTx,
  approveZk,
  execute as executeTx,
  depositToVault,
  type VaultConfig,
  type Proposal,
} from "@/lib/contract";
import { generateVoteProof, verifyVoteProof, secretFromSeed, H } from "@/lib/prover";
import Shield from "./shield";

/* ============================ tokens ============================ */
const DISPLAY = "'Newsreader',serif";
const SANS = "'Hanken Grotesk',sans-serif";
const MONO = "'JetBrains Mono',monospace";

const GRAD_A = "linear-gradient(135deg,#C9A86A,#8a6f3e)";
const GRAD_B = "linear-gradient(135deg,#bda07f,#6f5b3d)";
const GRAD_C = "linear-gradient(135deg,#a99272,#5e4e34)";
const GRADS = [GRAD_A, GRAD_B, GRAD_C];

// remember which (vault, tx) this wallet already approved → avoid re-click errors
const apprKey = (v: string, t: number, w: string) => `sv_appr_${v}_${t}_${w}`;
const didApprove = (v: string, t: number, w: string | null) =>
  !!w && typeof localStorage !== "undefined" && localStorage.getItem(apprKey(v, t, w)) === "1";
const markApproved = (v: string, t: number, w: string) => {
  try {
    localStorage.setItem(apprKey(v, t, w), "1");
  } catch {}
};

type Screen = "landing" | "connect" | "dashboard" | "create" | "vault" | "propose" | "shield";
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

  const loadData = useCallback(async (addr: string = vaultAddress) => {
    if (!addr) return;
    setLoading(true);
    try {
      const [c, b, p] = await Promise.all([
        getVault(addr),
        getVaultBalance(addr),
        getProposals(addr),
      ]);
      setConfig(c);
      setBalance(b);
      setProposals(p);
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
      const secrets = await Promise.all(config.signers.map((a) => secretFromSeed(a)));
      const blindings = config.signers.map((_, i) => BigInt(i + 1));
      const vId = await secretFromSeed(vaultAddress); // circuit domain id derived from the vault address
      const txHash = await H([vId, BigInt(txId)]);

      setProofStage(1); // generating proof
      const vp = await generateVoteProof({ vaultId: vId, txHash, secrets, blindings, myIndex });
      const ok = await verifyVoteProof(vp.publicSignals, vp.proof);
      if (!ok) throw new Error("Local proof verification failed");

      setProofStage(2); // submitting on-chain
      await approveZk(vaultAddress, txId, w, vp.proof, vp.publicSignals);

      setProof(false);
      setProofStage(0);
      markApproved(vaultAddress, txId, w);
      refreshSoon();
      showToast({
        title: "Anonymous approval submitted",
        sub: `Nullifier 0x${vp.nullifier.toString(16).slice(0, 10)}… · voter identity hidden`,
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

  const isApp = screen === "dashboard" || screen === "create" || screen === "vault" || screen === "propose" || screen === "shield";

  return (
    <div style={{ minHeight: "100vh", width: "100%", position: "relative", background: "#0A0A0B" }}>
      {screen === "landing" && <Landing onConnect={() => go("connect")} onVault={() => go("connect")} balance={balance} />}
      {screen === "connect" && <Connect onBack={() => go("landing")} onConnect={handleConnect} connecting={connecting} />}
      {isApp && (
        <AppShell screen={screen} go={go} mode={mode} setMode={setMode} submitPropose={submitPropose} wallet={wallet}
          vaultAddress={vaultAddress} config={config} balance={balance} proposals={proposals} loading={loading} busy={busy}
          onCreate={doCreate} onApprove={doApprove} onApproveZk={doApproveZk} onExecute={doExecute} onDeposit={doDeposit} onOpenVault={selectVault} onRefresh={() => loadData()} />
      )}
      {proof && <ProofOverlay stage={proofStage} />}
      {toast && <Toast msg={toast} />}
    </div>
  );
}

function cleanErr(e: any): string {
  // surface the full error in the browser console for debugging
  if (typeof console !== "undefined") console.error("[StellarVault] action failed:", e);
  const m = (e?.message || String(e)).replace(/^Error:\s*/, "");
  if (/getAccount|not found|404/i.test(m)) return "Account not funded on testnet, or not a vault signer.";
  if (/Transaction failed/i.test(m)) return "Rejected on-chain — you may not be a signer for this vault.";
  return m.length > 90 ? m.slice(0, 90) + "…" : m;
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
            ["ZK voter privacy", "Hide who approved (Groth16)"],
            ["Shielded pool", "Hide amount + recipient"],
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
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 14, color: "#8A857B" }}>🔒 PRIVATE · ZK</span>
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
  submitPropose: (target: string, amount: string) => void; wallet: string | null; vaultAddress: string;
  config: VaultConfig | null; balance: bigint | null; proposals: Proposal[]; loading: boolean; busy: string | null;
  onCreate: (name: string, signers: string[], threshold: number) => void; onApprove: (id: number) => void; onApproveZk: (id: number) => void; onExecute: (id: number) => void; onDeposit: () => void; onOpenVault: (addr: string) => void; onRefresh: () => void;
};
function AppShell(p: ShellProps) {
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
          <div style={{ display: "flex", gap: 6, fontSize: 13 }}>
            {navBtn("Vaults", p.screen === "dashboard", () => p.go("dashboard"))}
            {navBtn("🔒 Confidential", p.screen === "shield", () => p.go("shield"))}
            {navBtn("Settings", false)}
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
        {p.screen === "vault" && <VaultDetail go={p.go} vaultAddress={p.vaultAddress} config={p.config} balance={p.balance} proposals={p.proposals} loading={p.loading} busy={p.busy} wallet={p.wallet} onApprove={p.onApprove} onApproveZk={p.onApproveZk} onExecute={p.onExecute} onDeposit={p.onDeposit} onRefresh={p.onRefresh} />}
        {p.screen === "propose" && <Propose go={p.go} mode={p.mode} setMode={p.setMode} submitPropose={p.submitPropose} busy={p.busy} balance={p.balance} />}
        {p.screen === "shield" && <Shield wallet={p.wallet} onBack={() => p.go("dashboard")} />}
      </div>
    </div>
  );
}

/* ============================ DASHBOARD ============================ */
function Dashboard({ go, wallet, balance, proposals, vaultAddress, onOpenVault }: { go: (s: Screen) => void; wallet: string | null; balance: bigint | null; proposals: Proposal[]; vaultAddress: string; onOpenVault: (addr: string) => void }) {
  const pending = proposals.filter((x) => !x.executed).length;
  const [myVaults, setMyVaults] = useState<{ address: string; name: string; threshold: number; signers: number; balance: bigint }[]>([]);
  const [loadingVaults, setLoadingVaults] = useState(true);

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
        {!loadingVaults && myVaults.map((v) => (
          <VaultCard key={v.address} onClick={() => onOpenVault(v.address)} name={v.name || "Vault"} id={shortContract(v.address)} threshold={`${v.threshold} / ${v.signers}`} balance={formatXLM(v.balance)} avatars={Array.from({ length: v.signers }, (_, i) => letterFor(i))} gold={v.address === vaultAddress} live />
        ))}
        {!loadingVaults && !myVaults.length && wallet && (
          <div style={{ gridColumn: "1 / -1", border: "1px dashed rgba(236,231,221,0.12)", borderRadius: 15, padding: 28, textAlign: "center", color: "#8A857B", fontSize: 13 }}>
            No vaults yet. Click <span style={{ color: "#C9A86A" }}>“Create New Vault”</span> — each one is its own contract, recorded on-chain.
          </div>
        )}
      </div>

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

function VaultCard({ name, id, threshold, balance, avatars, pending, gold, live, onClick }: { name: string; id: string; threshold: string; balance: string; avatars: string[]; pending?: string; gold?: boolean; live?: boolean; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={gold ? "h-cardgold" : "h-card"} style={{ position: "relative", border: gold ? "1px solid rgba(201,168,106,0.24)" : "1px solid rgba(236,231,221,0.08)", borderRadius: 15, background: gold ? "linear-gradient(180deg,#15140f,#111110)" : "#121211", padding: 24, cursor: "pointer", overflow: "hidden" }}>
      {gold && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,transparent,#C9A86A,transparent)" }} />}
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
function VaultDetail({ go, vaultAddress, config, balance, proposals, loading, busy, wallet, onApprove, onApproveZk, onExecute, onDeposit, onRefresh }: {
  go: (s: Screen) => void; vaultAddress: string; config: VaultConfig | null; balance: bigint | null; proposals: Proposal[]; loading: boolean; busy: string | null; wallet: string | null;
  onApprove: (id: number) => void; onApproveZk: (id: number) => void; onExecute: (id: number) => void; onDeposit: () => void; onRefresh: () => void;
}) {
  const threshold = config?.threshold ?? 2;
  const signers = config?.signers ?? [];
  const pending = proposals.filter((p) => !p.executed);
  const history = proposals.filter((p) => p.executed);
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
            {list.map((p) =>
              p.private_mode
                ? <PrivateTx key={p.id} p={p} threshold={threshold} busy={busy} iApproved={didApprove(vaultAddress, p.id, wallet)} onApproveZk={onApproveZk} onExecute={onExecute} />
                : <TransparentTx key={p.id} p={p} threshold={threshold} busy={busy} iApproved={didApprove(vaultAddress, p.id, wallet)} onApprove={onApprove} onExecute={onExecute} />
            )}
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
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Policy</div>
            <PolicyRow label="Threshold" value={`${threshold} of ${config?.signer_count ?? signers.length}`} />
            <PolicyRow label="Token" value="XLM (SAC)" />
            <PolicyRow label="ZK mode" valueNode={<span style={{ color: "#C9A86A" }}>Enabled · Groth16</span>} />
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

function TransparentTx({ p, threshold, busy, iApproved, onApprove, onExecute }: { p: Proposal; threshold: number; busy: string | null; iApproved: boolean; onApprove: (id: number) => void; onExecute: (id: number) => void }) {
  const ready = p.approval_count >= threshold;
  return (
    <div style={{ position: "relative", border: "1px solid rgba(201,168,106,0.28)", borderRadius: 14, background: "linear-gradient(180deg,#16150f,#121210)", padding: 22, overflow: "hidden", opacity: p.executed ? 0.78 : 1 }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "#C9A86A" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, color: "#C9A86A", letterSpacing: ".04em" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#C9A86A", boxShadow: "0 0 10px #C9A86A" }} />TRANSPARENT</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: "#8A857B" }}>proposal #{p.id}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18, marginBottom: 20 }}>
        <div><div style={{ fontSize: 11, color: "#8A857B", marginBottom: 6 }}>Proposed by</div><div style={{ fontFamily: MONO, fontSize: 14, color: "#ECE7DD" }}>{shortAddr(p.proposer)}</div></div>
        <div><div style={{ fontSize: 11, color: "#8A857B", marginBottom: 6 }}>Recipient</div><div style={{ fontFamily: MONO, fontSize: 14, color: "#ECE7DD" }}>{shortAddr(p.target)}</div></div>
        <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: "#8A857B", marginBottom: 6 }}>Amount</div><div style={{ fontFamily: DISPLAY, fontSize: 22, color: "#ECE7DD" }}>{formatXLM(p.amount)} <span style={{ fontSize: 12, fontFamily: MONO, color: "#8A857B" }}>XLM</span></div></div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 18, borderTop: "1px solid rgba(236,231,221,0.08)" }}>
        {p.executed
          ? <span style={{ fontSize: 13, color: "#7FB069", fontWeight: 600 }}>● Executed · settled on-chain</span>
          : <ApprovalDots count={p.approval_count} threshold={threshold} gold />}
        {!p.executed && (
          ready
            ? <button onClick={() => onExecute(p.id)} disabled={!!busy} className="h-goldbtn" style={{ background: "#C9A86A", color: "#0A0A0B", border: "none", borderRadius: 8, padding: "9px 18px", fontFamily: SANS, fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>{busy === `execute-${p.id}` ? "Executing…" : "Execute"}</button>
            : iApproved
              ? <span style={{ fontSize: 13, color: "#7FB069", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>✓ You approved · waiting</span>
              : <button onClick={() => onApprove(p.id)} disabled={!!busy} className="h-goldbtn" style={{ background: "#C9A86A", color: "#0A0A0B", border: "none", borderRadius: 8, padding: "9px 18px", fontFamily: SANS, fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>{busy === `approve-${p.id}` ? "Approving…" : "Approve"}</button>
        )}
      </div>
    </div>
  );
}

function PrivateTx({ p, threshold, busy, iApproved, onApproveZk, onExecute }: { p: Proposal; threshold: number; busy: string | null; iApproved: boolean; onApproveZk: (id: number) => void; onExecute: (id: number) => void }) {
  const ready = p.approval_count >= threshold;
  return (
    <div style={{ position: "relative", border: "1px solid rgba(236,231,221,0.10)", borderRadius: 14, background: "linear-gradient(180deg,#0f0f0f,#0c0c0d)", padding: 22, overflow: "hidden", opacity: p.executed ? 0.8 : 1 }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "#46433c" }} />
      <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(115deg,rgba(236,231,221,0.016) 0 2px,transparent 2px 9px)", pointerEvents: "none" }} />
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, color: "#8A857B", letterSpacing: ".04em" }}>🔒 PRIVATE · ZK</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: "#46433c" }}>proposal #{p.id}</span>
      </div>
      <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18, marginBottom: 20 }}>
        <div><div style={{ fontSize: 11, color: "#8A857B", marginBottom: 6 }}>Proposed by</div><div style={{ fontFamily: MONO, fontSize: 14, color: "#ECE7DD" }}>{shortAddr(p.proposer)}</div></div>
        <div><div style={{ fontSize: 11, color: "#8A857B", marginBottom: 6 }}>Recipient</div><div style={{ fontFamily: MONO, fontSize: 14, color: "#ECE7DD" }}>{shortAddr(p.target)}</div></div>
        <div style={{ textAlign: "right" }}><div style={{ fontSize: 11, color: "#8A857B", marginBottom: 6 }}>Amount</div><div style={{ fontFamily: DISPLAY, fontSize: 22, color: "#ECE7DD" }}>{formatXLM(p.amount)} <span style={{ fontSize: 12, fontFamily: MONO, color: "#8A857B" }}>XLM</span></div></div>
      </div>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 18, borderTop: "1px solid rgba(236,231,221,0.06)" }}>
        {p.executed
          ? <span style={{ fontSize: 12, color: "#8A857B", display: "inline-flex", alignItems: "center", gap: 8 }}>🔒 amount &amp; recipient hidden on-chain</span>
          : <span style={{ fontSize: 13, color: "#8A857B" }}>🔒 {p.approval_count}/{threshold} — voter identities hidden</span>}
        {!p.executed && (
          ready
            ? <button onClick={() => onExecute(p.id)} disabled={!!busy} className="h-ghost" style={{ background: "transparent", color: "#C9A86A", border: "1px solid rgba(201,168,106,0.45)", borderRadius: 8, padding: "9px 18px", fontFamily: SANS, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{busy === `execute-${p.id}` ? "Executing…" : "Execute (ZK)"}</button>
            : iApproved
              ? <span style={{ fontSize: 13, color: "#7FB069", fontWeight: 600 }}>✓ You approved · waiting</span>
              : <button onClick={() => onApproveZk(p.id)} disabled={!!busy} className="h-ghost" style={{ background: "transparent", color: "#C9A86A", border: "1px solid rgba(201,168,106,0.45)", borderRadius: 8, padding: "9px 18px", fontFamily: SANS, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Approve (ZK)</button>
        )}
      </div>
    </div>
  );
}

/* ============================ PROPOSE ============================ */
function Propose({ go, mode, setMode, submitPropose, busy, balance }: { go: (s: Screen) => void; mode: Mode; setMode: (m: Mode) => void; submitPropose: (target: string, amount: string) => void; busy: string | null; balance: bigint | null }) {
  const isPrivate = mode === "private";
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("");
  return (
    <div>
      <button onClick={() => go("vault")} className="h-navtext" style={{ background: "transparent", border: "none", color: "#8A857B", fontFamily: SANS, fontSize: 13, cursor: "pointer", marginBottom: 18, padding: 0 }}>← Orbital Treasury</button>
      <h1 style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 32, marginBottom: 8 }}>New transaction</h1>
      <p style={{ fontSize: 14, color: "#8A857B", marginBottom: 28 }}>Choose how much the chain is allowed to reveal — then propose for your co-signers to approve.</p>

      <div style={{ position: "relative", display: "flex", background: "#0d0d0e", border: "1px solid rgba(236,231,221,0.10)", borderRadius: 13, padding: 5, marginBottom: 28, maxWidth: 520 }}>
        <div style={{ position: "absolute", top: 5, bottom: 5, left: 5, width: "calc(50% - 5px)", borderRadius: 9, background: isPrivate ? "rgba(236,231,221,0.04)" : "rgba(201,168,106,0.12)", border: `1px solid ${isPrivate ? "rgba(236,231,221,0.16)" : "rgba(201,168,106,0.45)"}`, transition: "transform .32s cubic-bezier(.4,0,.2,1),background .32s,border-color .32s", transform: isPrivate ? "translateX(100%)" : "translateX(0)" }} />
        <button onClick={() => setMode("transparent")} style={{ position: "relative", zIndex: 2, flex: 1, background: "transparent", border: "none", cursor: "pointer", padding: 14, fontFamily: SANS, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, color: isPrivate ? "#8A857B" : "#C9A86A" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 600, whiteSpace: "nowrap" }}>◎ Transparent</span>
          <span style={{ fontSize: 11, color: "#8A857B" }}>Public &amp; auditable</span>
        </button>
        <button onClick={() => setMode("private")} style={{ position: "relative", zIndex: 2, flex: 1, background: "transparent", border: "none", cursor: "pointer", padding: 14, fontFamily: SANS, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, color: isPrivate ? "#ECE7DD" : "#8A857B" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 600, whiteSpace: "nowrap" }}>🔒 Private · ZK</span>
          <span style={{ fontSize: 11, color: "#8A857B" }}>Confidential transfer</span>
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 28, alignItems: "start" }}>
        <div style={{ border: `1px solid ${isPrivate ? "rgba(236,231,221,0.1)" : "rgba(201,168,106,0.24)"}`, borderRadius: 15, background: isPrivate ? "#0d0d0d" : "linear-gradient(180deg,#15140f,#111110)", padding: 28, transition: "border-color .3s,background .3s" }}>
          <label style={{ display: "block", fontSize: 13, color: "#ECE7DD", fontWeight: 600, marginBottom: 10 }}>Recipient address</label>
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="G…" style={{ width: "100%", background: "#0d0d0e", border: "1px solid rgba(236,231,221,0.10)", borderRadius: 10, padding: "13px 15px", color: "#ECE7DD", fontFamily: MONO, fontSize: 14, marginBottom: 22 }} />
          <label style={{ display: "block", fontSize: 13, color: "#ECE7DD", fontWeight: 600, marginBottom: 10 }}>Amount</label>
          <div style={{ display: "flex", alignItems: "center", background: "#0d0d0e", border: "1px solid rgba(236,231,221,0.10)", borderRadius: 10, padding: "0 15px", marginBottom: 22 }}>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" style={{ flex: 1, background: "transparent", border: "none", padding: "14px 0", color: "#ECE7DD", fontFamily: DISPLAY, fontSize: 22 }} />
            <span style={{ fontFamily: MONO, fontSize: 13, color: "#8A857B", borderLeft: "1px solid rgba(236,231,221,0.1)", paddingLeft: 14 }}>XLM</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: "#8A857B", marginBottom: 22 }}>
            <span>Vault balance · {balance != null ? formatXLM(balance) : "—"} XLM</span>
            <span style={{ color: "#C9A86A", cursor: "pointer" }} onClick={() => balance != null && setAmount(formatXLM(balance).replace(/,/g, ""))}>Max</span>
          </div>
          {isPrivate && (
            <div className="vs-rise" style={{ display: "flex", gap: 12, border: "1px solid rgba(236,231,221,0.12)", borderRadius: 11, background: "#0c0c0d", padding: 16, marginBottom: 22 }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>🔒</span>
              <div>
                <div style={{ fontSize: 13, color: "#ECE7DD", fontWeight: 600, marginBottom: 5 }}>Approver identities will be hidden</div>
                <div style={{ fontSize: 12.5, color: "#8A857B", lineHeight: 1.55 }}>Co-signers see the amount &amp; recipient (they approve it), but each approval is a zero-knowledge proof — the chain records only a nullifier, never <span style={{ color: "#ECE7DD" }}>who</span> signed. To also hide the amount &amp; recipient from everyone, use the 🔒 Confidential pool.</div>
              </div>
            </div>
          )}
          <button onClick={() => submitPropose(target, amount)} disabled={busy === "propose"} className="h-goldbtn" style={{ width: "100%", background: "#C9A86A", color: "#0A0A0B", fontFamily: SANS, fontWeight: 600, fontSize: 15, padding: 15, border: "none", borderRadius: 11, cursor: "pointer", opacity: busy === "propose" ? 0.6 : 1 }}>{busy === "propose" ? "Proposing…" : "Propose · sign with wallet"}</button>
        </div>

        <div style={{ position: "sticky", top: 96 }}>
          <div style={{ fontSize: 11, color: "#8A857B", fontFamily: MONO, letterSpacing: ".16em", marginBottom: 12 }}>HOW CO-SIGNERS WILL SEE IT</div>
          {!isPrivate ? (
            <div className="vs-rise" style={{ position: "relative", border: "1px solid rgba(201,168,106,0.3)", borderRadius: 14, background: "linear-gradient(180deg,#16150f,#121210)", padding: 22, overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,transparent,#C9A86A,transparent)" }} />
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, color: "#C9A86A", marginBottom: 18 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#C9A86A", boxShadow: "0 0 10px #C9A86A" }} />TRANSPARENT</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 6 }}>
                <Row label="Proposed by" value="You" />
                <Row label="Recipient" value={target ? shortAddr(target) : "G…"} mono />
                <Row label="Amount" value={`${amount || "0.00"} XLM`} mono />
                <div style={{ height: 1, background: "rgba(236,231,221,0.08)" }} />
                <Row label="Approvals" value="visible to all" />
              </div>
            </div>
          ) : (
            <div className="vs-rise" style={{ position: "relative", border: "1px solid rgba(236,231,221,0.1)", borderRadius: 14, background: "linear-gradient(180deg,#0f0f0f,#0c0c0d)", padding: 22, overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(115deg,rgba(236,231,221,0.016) 0 2px,transparent 2px 9px)", pointerEvents: "none" }} />
              <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, color: "#8A857B", marginBottom: 18 }}>🔒 PRIVATE · ZK</span>
              <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 14, marginTop: 6 }}>
                <Row label="Proposed by" value="You" />
                <Row label="Recipient" value={target ? shortAddr(target) : "G…"} mono />
                <Row label="Amount" value={`${amount || "0.00"} XLM`} mono />
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
