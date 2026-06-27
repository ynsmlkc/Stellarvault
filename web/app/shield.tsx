"use client";

import { useCallback, useEffect, useState } from "react";
import { shortAddr, formatXLM, contractExplorerUrl, CONFIG } from "@/lib/stellar";
import { poolDeposit, poolWithdraw, getCommitments, getShieldBalance } from "@/lib/contract";
import {
  newNote,
  generateWithdrawProof,
  verifyWithdrawProof,
  loadNotes,
  saveNote,
  markNoteSpent,
  type Note,
} from "@/lib/shieldProver";

const DISPLAY = "'Newsreader',serif";
const SANS = "'Hanken Grotesk',sans-serif";
const MONO = "'JetBrains Mono',monospace";

function parseAmountToStroops(s: string): bigint {
  const n = Number(s.replace(/,/g, "").trim());
  if (!isFinite(n) || n <= 0) throw new Error("Enter a valid amount");
  return BigInt(Math.round(n * 1e7));
}
function cleanErr(e: any): string {
  if (typeof console !== "undefined") console.error("[Shield] failed:", e);
  const m = (e?.message || String(e)).replace(/^Error:\s*/, "");
  if (/getAccount|not found|404/i.test(m)) return "Account not funded on testnet.";
  if (/Transaction failed/i.test(m)) return "Rejected on-chain.";
  return m.length > 96 ? m.slice(0, 96) + "…" : m;
}

type StoredNote = Note & { spent?: boolean };
type Toast = { title: string; sub: string; tone: "ok" | "err" } | null;

export default function Shield({ wallet, onBack }: { wallet: string | null; onBack: () => void }) {
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [notes, setNotes] = useState<StoredNote[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [commitments, setCommitments] = useState<bigint[]>([]);
  const [poolBal, setPoolBal] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stage, setStage] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const refresh = useCallback(async () => {
    if (wallet) setNotes(loadNotes(wallet));
    try {
      setCommitments(await getCommitments());
      setPoolBal(await getShieldBalance());
    } catch {}
  }, [wallet]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const showToast = (t: Toast) => {
    setToast(t);
    setTimeout(() => setToast(null), 6500);
  };

  const doDeposit = async () => {
    if (!wallet) return showToast({ title: "Connect a wallet first", sub: "Authorize Freighter to deposit.", tone: "err" });
    let stroops: bigint;
    try {
      stroops = parseAmountToStroops(amount);
    } catch (e: any) {
      return showToast({ title: "Invalid amount", sub: e.message, tone: "err" });
    }
    setBusy("deposit");
    try {
      const note = await newNote(stroops);
      await poolDeposit(wallet, stroops, BigInt(note.commitment));
      saveNote(wallet, note);
      setAmount("");
      await refresh();
      showToast({ title: `Deposited ${formatXLM(stroops)} XLM`, sub: "A private note was created in the pool.", tone: "ok" });
    } catch (e: any) {
      showToast({ title: "Deposit failed", sub: cleanErr(e), tone: "err" });
    } finally {
      setBusy(null);
    }
  };

  const doSend = async () => {
    if (!wallet) return showToast({ title: "Connect a wallet first", sub: "", tone: "err" });
    const note = notes.find((n) => n.commitment === selected);
    if (!note) return showToast({ title: "Pick a note", sub: "Select a private note to send.", tone: "err" });
    if (!recipient.trim()) return showToast({ title: "Enter a recipient", sub: "Who receives the confidential transfer?", tone: "err" });
    setStage(0);
    try {
      const live = await getCommitments();
      setStage(1);
      const wp = await generateWithdrawProof({ note, commitments: live, recipientAddr: recipient.trim() });
      const ok = await verifyWithdrawProof(wp.publicSignals, wp.proof);
      if (!ok) throw new Error("Local proof verification failed");
      setStage(2);
      await poolWithdraw(wallet, wp.proof, wp.root, wp.nullifierHash, recipient.trim(), BigInt(note.amount));
      markNoteSpent(wallet, note.commitment);
      setStage(null);
      setSelected(null);
      setRecipient("");
      await refresh();
      showToast({
        title: "Confidential transfer sent",
        sub: `${formatXLM(BigInt(note.amount))} XLM · nullifier 0x${wp.nullifierHash.toString(16).slice(0, 10)}… · unlinkable`,
        tone: "ok",
      });
    } catch (e: any) {
      setStage(null);
      showToast({ title: "Confidential send failed", sub: cleanErr(e), tone: "err" });
    }
  };

  const unspent = notes.filter((n) => !n.spent);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <button onClick={onBack} className="h-navtext" style={{ background: "transparent", border: "none", color: "#8A857B", fontFamily: SANS, fontSize: 13, cursor: "pointer", marginBottom: 20, padding: 0 }}>← Back</button>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginBottom: 28 }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: ".18em", color: "#C9A86A", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
            🔒 CONFIDENTIAL POOL · ZK
          </div>
          <h1 style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 36, letterSpacing: "-0.01em" }}>Shielded transfers</h1>
          <p style={{ fontSize: 14, color: "#8A857B", marginTop: 8, maxWidth: 560, lineHeight: 1.55 }}>
            Deposit into the pool, then send confidentially. A zero-knowledge proof severs the on-chain link between
            deposit and recipient — only commitments and nullifiers ever touch the chain.
          </p>
        </div>
        <div style={{ textAlign: "right", border: "1px solid rgba(201,168,106,0.24)", borderRadius: 13, background: "linear-gradient(180deg,#16150f,#121210)", padding: "16px 22px" }}>
          <div style={{ fontSize: 12, color: "#8A857B", marginBottom: 4 }}>Pool balance</div>
          <div style={{ fontFamily: DISPLAY, fontSize: 30 }}>{poolBal != null ? formatXLM(poolBal) : "…"} <span style={{ fontSize: 14, fontFamily: MONO, color: "#8A857B" }}>XLM</span></div>
          <a href={contractExplorerUrl(CONFIG.shieldPoolId)} target="_blank" rel="noreferrer" className="h-copy" style={{ fontFamily: MONO, fontSize: 10, color: "#C9A86A", textDecoration: "none" }}>↗ {shortAddr(CONFIG.shieldPoolId, 6, 4)}</a>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, alignItems: "start" }}>
        {/* deposit */}
        <div style={{ border: "1px solid rgba(236,231,221,0.08)", borderRadius: 15, background: "#121211", padding: 26 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>1 · Deposit a note</div>
          <p style={{ fontSize: 13, color: "#8A857B", marginBottom: 18 }}>Move XLM into the shielded pool. A secret note is created locally.</p>
          <div style={{ display: "flex", alignItems: "center", background: "#0d0d0e", border: "1px solid rgba(236,231,221,0.10)", borderRadius: 10, padding: "0 15px", marginBottom: 16 }}>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" style={{ flex: 1, background: "transparent", border: "none", padding: "14px 0", color: "#ECE7DD", fontFamily: DISPLAY, fontSize: 22 }} />
            <span style={{ fontFamily: MONO, fontSize: 13, color: "#8A857B", borderLeft: "1px solid rgba(236,231,221,0.1)", paddingLeft: 14 }}>XLM</span>
          </div>
          <button onClick={doDeposit} disabled={busy === "deposit"} className="h-goldbtn" style={{ width: "100%", background: "#C9A86A", color: "#0A0A0B", fontFamily: SANS, fontWeight: 600, fontSize: 15, padding: 14, border: "none", borderRadius: 11, cursor: "pointer", opacity: busy === "deposit" ? 0.6 : 1 }}>
            {busy === "deposit" ? "Depositing…" : "Deposit · sign with wallet"}
          </button>
        </div>

        {/* send */}
        <div style={{ border: `1px solid ${selected ? "rgba(201,168,106,0.3)" : "rgba(236,231,221,0.08)"}`, borderRadius: 15, background: selected ? "linear-gradient(180deg,#15140f,#111110)" : "#121211", padding: 26, transition: "border-color .3s,background .3s" }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>2 · Send confidentially</div>
          <p style={{ fontSize: 13, color: "#8A857B", marginBottom: 18 }}>Pick a note, choose a recipient. The link stays hidden.</p>
          <label style={{ display: "block", fontSize: 12, color: "#8A857B", marginBottom: 8 }}>Recipient address</label>
          <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="G…" style={{ width: "100%", background: "#0d0d0e", border: "1px solid rgba(236,231,221,0.10)", borderRadius: 10, padding: "12px 14px", color: "#ECE7DD", fontFamily: MONO, fontSize: 13, marginBottom: 16 }} />
          <button onClick={doSend} disabled={stage !== null || !selected} className="h-ghost" style={{ width: "100%", background: "transparent", color: "#C9A86A", border: "1px solid rgba(201,168,106,0.45)", fontFamily: SANS, fontWeight: 600, fontSize: 15, padding: 14, borderRadius: 11, cursor: selected ? "pointer" : "not-allowed", opacity: selected ? 1 : 0.5 }}>
            {stage !== null ? "Proving…" : "Send confidentially · ZK"}
          </button>
        </div>
      </div>

      {/* notes */}
      <div style={{ marginTop: 26 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>Your private notes <span style={{ fontFamily: MONO, fontSize: 12, color: "#8A857B" }}>({unspent.length} spendable)</span></div>
        {!notes.length && (
          <div style={{ border: "1px dashed rgba(236,231,221,0.12)", borderRadius: 14, padding: 28, textAlign: "center", color: "#8A857B", fontSize: 13 }}>No notes yet. Deposit to create one.</div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 14 }}>
          {notes.map((n) => {
            const sel = n.commitment === selected;
            const onChain = commitments.some((c) => c === BigInt(n.commitment));
            return (
              <div key={n.commitment} onClick={() => !n.spent && setSelected(sel ? null : n.commitment)} style={{ position: "relative", border: `1px solid ${sel ? "rgba(201,168,106,0.5)" : "rgba(236,231,221,0.10)"}`, borderRadius: 13, background: n.spent ? "#0e0e0e" : "linear-gradient(180deg,#101010,#0c0c0d)", padding: 18, cursor: n.spent ? "default" : "pointer", opacity: n.spent ? 0.5 : 1, overflow: "hidden" }}>
                <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(115deg,rgba(236,231,221,0.016) 0 2px,transparent 2px 9px)", pointerEvents: "none" }} />
                <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: "#8A857B" }}>🔒 NOTE</span>
                  {n.spent ? <span style={{ fontFamily: MONO, fontSize: 10, color: "#8A857B" }}>spent</span>
                    : onChain ? <span style={{ fontFamily: MONO, fontSize: 9, color: "#7FB069", border: "1px solid rgba(127,176,105,0.4)", borderRadius: 4, padding: "1px 5px" }}>ON-CHAIN</span>
                      : <span style={{ fontFamily: MONO, fontSize: 9, color: "#8A857B" }}>local</span>}
                </div>
                <div style={{ position: "relative", fontFamily: DISPLAY, fontSize: 24 }}>{formatXLM(BigInt(n.amount))} <span style={{ fontSize: 12, fontFamily: MONO, color: "#8A857B" }}>XLM</span></div>
                <div style={{ position: "relative", fontFamily: MONO, fontSize: 10, color: "#5a564d", marginTop: 8 }}>commit 0x{BigInt(n.commitment).toString(16).slice(0, 12)}…</div>
                {sel && <div style={{ position: "relative", marginTop: 10, fontSize: 11, color: "#C9A86A" }}>✓ selected to send</div>}
              </div>
            );
          })}
        </div>
      </div>

      {stage !== null && <ProofOverlay stage={stage} />}
      {toast && <ToastView msg={toast} />}
    </div>
  );
}

function ProofOverlay({ stage }: { stage: number }) {
  const step = (idx: number) => {
    const done = stage > idx, active = stage === idx;
    if (done) return { bg: "rgba(127,176,105,0.08)", dot: "#7FB069", mark: "✓", text: "#ECE7DD" };
    if (active) return { bg: "rgba(201,168,106,0.08)", dot: "#C9A86A", mark: "·", text: "#ECE7DD" };
    return { bg: "transparent", dot: "#26241f", mark: `${idx + 1}`, text: "#5a564d" };
  };
  const steps = [
    { s: step(0), label: <>Reading pool commitments</> },
    { s: step(1), label: <>Generating proof <span style={{ fontFamily: MONO, fontSize: 11, color: "#8A857B" }}>(Groth16)</span></> },
    { s: step(2), label: <>Submitting confidential withdraw</> },
  ];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(8,8,9,0.86)", backdropFilter: "blur(10px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="vs-rise" style={{ width: 480, border: "1px solid rgba(201,168,106,0.24)", borderRadius: 20, background: "linear-gradient(180deg,#141413,#0e0e0f)", padding: 40, boxShadow: "0 40px 100px rgba(0,0,0,0.6)" }}>
        <div style={{ width: 96, height: 96, margin: "0 auto 28px", position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid transparent", borderTopColor: "#C9A86A", borderRightColor: "#C9A86A", animation: "vsSpin 1.1s linear infinite" }} />
          <div style={{ position: "absolute", inset: 14, borderRadius: "50%", border: "1px dashed rgba(201,168,106,0.3)", animation: "vsSpinR 3s linear infinite" }} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ width: 14, height: 14, borderRadius: 4, background: "#C9A86A", boxShadow: "0 0 20px rgba(201,168,106,0.7)" }} /></div>
        </div>
        <h3 style={{ textAlign: "center", fontFamily: DISPLAY, fontWeight: 500, fontSize: 23, marginBottom: 6 }}>Sealing your transfer</h3>
        <p style={{ textAlign: "center", fontSize: 13, color: "#8A857B", marginBottom: 28 }}>Generating a zero-knowledge proof locally. Keep this tab open.</p>
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

function ToastView({ msg }: { msg: NonNullable<Toast> }) {
  const ok = msg.tone === "ok";
  return (
    <div style={{ position: "fixed", bottom: 32, left: "50%", zIndex: 120, display: "flex", alignItems: "center", gap: 12, background: "#141413", border: `1px solid ${ok ? "rgba(201,168,106,0.32)" : "rgba(196,93,74,0.45)"}`, borderRadius: 12, padding: "14px 20px", boxShadow: "0 20px 50px rgba(0,0,0,0.5)", animation: "vsToast .4s cubic-bezier(.2,.7,.2,1) both", maxWidth: 480 }}>
      <span style={{ width: 26, height: 26, borderRadius: "50%", background: ok ? "rgba(127,176,105,0.15)" : "rgba(196,93,74,0.15)", border: `1px solid ${ok ? "rgba(127,176,105,0.5)" : "rgba(196,93,74,0.5)"}`, display: "flex", alignItems: "center", justifyContent: "center", color: ok ? "#7FB069" : "#C45D4A", fontSize: 13, flex: "none" }}>{ok ? "✓" : "!"}</span>
      <div>
        <div style={{ fontSize: 14, color: "#ECE7DD", fontWeight: 600 }}>{msg.title}</div>
        <div style={{ fontSize: 12, color: "#8A857B" }}>{msg.sub}</div>
      </div>
    </div>
  );
}
