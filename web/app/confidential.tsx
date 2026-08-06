"use client";

/**
 * The vault's confidential balance, on OpenZeppelin's confidential token.
 *
 * Every action here is an ordinary vault proposal that happens to call the token
 * contract, so the threshold, time-lock and cancellation govern it exactly as
 * they govern a transfer. Nothing about the vault contract knows this screen
 * exists — see `spike/confidential-token/`.
 */

import { useState } from "react";
import { CONFIG, shortAddr, contractExplorerUrl } from "@/lib/stellar";
import { proposeCallRaw, allowContract, getAllowedContracts, describeError } from "@/lib/contract";
import {
  vaultConfidentialKey,
  readConfidentialBalance,
  buildRegisterArgs,
  buildMergeArgs,
  buildTransferArgs,
  type ConfidentialBalance,
} from "@/lib/confidential";

const DISPLAY = "'Newsreader',serif";
const SANS = "'Hanken Grotesk',sans-serif";
const MONO = "'JetBrains Mono',monospace";

type Props = {
  wallet: string | null;
  vaultAddress: string;
  /** Ledger to replay confidential events from — the token's deploy ledger. */
  fromLedger: number;
  onBack: () => void;
  onProposed: (fn: string) => void;
  onError: (msg: string) => void;
};

const card: React.CSSProperties = {
  border: "1px solid rgba(236,231,221,0.08)",
  borderRadius: 15,
  background: "#121211",
  padding: 26,
  marginBottom: 18,
};
const input: React.CSSProperties = {
  width: "100%",
  background: "#0d0d0e",
  border: "1px solid rgba(236,231,221,0.10)",
  borderRadius: 9,
  padding: "12px 14px",
  color: "#ECE7DD",
  fontFamily: MONO,
  fontSize: 13,
};

export default function Confidential({ wallet, vaultAddress, fromLedger, onBack, onProposed, onError }: Props) {
  const [keys, setKeys] = useState<any>(null);
  const [balance, setBalance] = useState<ConfidentialBalance | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e: any) {
      console.error("[Confidential] failed:", e);
      onError(describeError(e));
    } finally {
      setBusy(null);
    }
  };

  /** Derive the vault's viewing key and replay its balance from events. */
  const unlock = () =>
    run("unlock", async () => {
      const k = await vaultConfidentialKey(vaultAddress);
      setKeys(k);
      setBalance(await readConfidentialBalance(vaultAddress, k, fromLedger));
    });

  /** Every op goes out as a proposal; nothing settles until the threshold does. */
  const propose = (label: string, fn: string, build: () => Promise<any[]>) =>
    run(label, async () => {
      if (!wallet) throw new Error("Connect a wallet first.");
      const allowed = await getAllowedContracts(vaultAddress);
      if (!allowed.includes(CONFIG.confidentialTokenId)) {
        await allowContract(vaultAddress, wallet, CONFIG.confidentialTokenId);
      }
      await proposeCallRaw(vaultAddress, wallet, CONFIG.confidentialTokenId, fn, await build());
      onProposed(fn);
    });

  const fmt = (v: bigint) => (Number(v) / 1e7).toLocaleString(undefined, { maximumFractionDigits: 7 });

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <button onClick={onBack} className="h-navtext" style={{ background: "transparent", border: "none", color: "#8A857B", fontFamily: SANS, fontSize: 13, cursor: "pointer", marginBottom: 20, padding: 0 }}>← Back to vault</button>
      <h1 style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 34, marginBottom: 8 }}>Hidden amounts</h1>
      <p style={{ fontSize: 14, color: "#8A857B", marginBottom: 22, lineHeight: 1.6 }}>
        {"A second balance for this vault, held as a commitment, so amounts never appear on-chain. It wraps real XLM: what goes in comes back out. This hides "}<span style={{ color: "#ECE7DD" }}>how much</span> — to hide <span style={{ color: "#ECE7DD" }}>who approved</span>, use anonymous approvals when proposing. Each action below is an ordinary proposal, so the threshold and time-lock apply.
      </p>

      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Balance</div>
          <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".12em", color: keys ? "#7FB069" : "#8A857B", border: `1px solid ${keys ? "rgba(127,176,105,0.4)" : "rgba(236,231,221,0.14)"}`, borderRadius: 6, padding: "3px 8px" }}>
            {keys ? "UNLOCKED" : "LOCKED"}
          </span>
        </div>
        {balance ? (
          <>
            <div style={{ fontFamily: DISPLAY, fontSize: 34, color: "#ECE7DD", margin: "12px 0 4px" }}>
              {fmt(balance.spendable)} <span style={{ fontSize: 14, fontFamily: MONO, color: "#8A857B" }}>XLM spendable</span>
            </div>
            <div style={{ fontSize: 13, color: "#8A857B" }}>
              {fmt(balance.receiving)} XLM waiting in receiving — merge to make it spendable.
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: "#8A857B", margin: "10px 0 16px", lineHeight: 1.6 }}>
              Reading the balance needs the vault&apos;s viewing key, derived from a wallet signature. It is a viewing and proving key, not a spending key — moving funds still needs the vault&apos;s threshold.
            </p>
            <button onClick={unlock} disabled={!!busy || !wallet} className="h-goldbtn" style={{ width: "100%", background: "transparent", color: "#C9A86A", border: "1px solid rgba(201,168,106,0.45)", fontFamily: SANS, fontWeight: 600, fontSize: 14, padding: 13, borderRadius: 10, cursor: "pointer", opacity: busy === "unlock" ? 0.6 : 1 }}>
              {busy === "unlock" ? "Check Freighter…" : "Unlock with wallet signature"}
            </button>
          </>
        )}
      </div>

      <div style={card}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Set up</div>
        <p style={{ fontSize: 13, color: "#8A857B", marginBottom: 14, lineHeight: 1.6 }}>
          Registering binds the vault&apos;s confidential keys to the token contract. Needed once, before it can hold anything.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => keys && propose("register", "register", () => buildRegisterArgs(vaultAddress, keys))}
            disabled={!!busy || !keys}
            style={{ flex: 1, background: "transparent", color: keys ? "#ECE7DD" : "#5a564d", border: "1px solid rgba(236,231,221,0.16)", borderRadius: 10, padding: 12, fontFamily: SANS, fontSize: 13.5, fontWeight: 600, cursor: keys ? "pointer" : "not-allowed" }}
          >{busy === "register" ? "Proving…" : "Propose register"}</button>
          <button
            onClick={() => propose("merge", "merge", () => buildMergeArgs(vaultAddress))}
            disabled={!!busy}
            style={{ flex: 1, background: "transparent", color: "#ECE7DD", border: "1px solid rgba(236,231,221,0.16)", borderRadius: 10, padding: 12, fontFamily: SANS, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
          >{busy === "merge" ? "Proposing…" : "Propose merge"}</button>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Send confidentially</div>
        <p style={{ fontSize: 13, color: "#8A857B", marginBottom: 14, lineHeight: 1.6 }}>
          The recipient must already have a confidential account — the amount is encrypted to their key. Proving happens in this browser and takes a few seconds.
        </p>
        <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="G… recipient" style={{ ...input, marginBottom: 10 }} />
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00 XLM" style={{ ...input, marginBottom: 14 }} />
        <button
          onClick={() =>
            keys &&
            propose("transfer", "confidential_transfer", () =>
              buildTransferArgs(
                vaultAddress,
                recipient.trim(),
                BigInt(Math.round(Number(amount.replace(/,/g, "")) * 1e7)),
                keys,
                fromLedger
              )
            )
          }
          disabled={!!busy || !keys || !recipient.trim() || !amount.trim()}
          className="h-goldbtn"
          style={{ width: "100%", background: "#C9A86A", color: "#0A0A0B", border: "none", fontFamily: SANS, fontWeight: 600, fontSize: 14, padding: 13, borderRadius: 10, cursor: "pointer", opacity: keys && recipient.trim() && amount.trim() && !busy ? 1 : 0.45 }}
        >
          {busy === "transfer" ? "Proving in browser…" : "Propose confidential transfer"}
        </button>
      </div>

      <div style={{ ...card, marginBottom: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".14em", color: "#8A857B", marginBottom: 10 }}>WHAT IS AND ISN&apos;T HIDDEN</div>
        <div style={{ fontSize: 12.5, color: "#8A857B", lineHeight: 1.7 }}>
          Amounts are hidden from everyone on-chain. Sender and recipient addresses stay public — this hides <span style={{ color: "#ECE7DD" }}>how much</span>, not <span style={{ color: "#ECE7DD" }}>who</span>. Every transfer also emits a ciphertext to a registered auditor, by design: confidential and auditable.
        </div>
        <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 11, color: "#5a564d" }}>
          token{" "}
          <a href={contractExplorerUrl(CONFIG.confidentialTokenId)} target="_blank" rel="noreferrer" style={{ color: "#C9A86A", textDecoration: "none" }}>
            {shortAddr(CONFIG.confidentialTokenId, 6, 5)} ↗
          </a>
          {"  ·  unaudited developer preview, testnet only"}
        </div>
      </div>
    </div>
  );
}
