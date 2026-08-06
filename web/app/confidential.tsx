"use client";

/**
 * The vault's confidential balance, on OpenZeppelin's confidential token.
 *
 * Every action here is an ordinary vault proposal that happens to call the token
 * contract, so the threshold, time-lock and cancellation govern it exactly as
 * they govern a transfer. Nothing in the vault contract knows this screen
 * exists — see `spike/confidential-token/`.
 *
 * # What this screen hides from the user, on purpose
 *
 * The token keeps two balances: incoming payments land in `receiving`, and only
 * `spendable` can be sent. That split is not cosmetic — if incoming funds
 * changed the balance you were proving against, anyone could stop you spending
 * by sending dust while you prove. But it is *the token's* problem, not the
 * treasurer's, so this screen shows one number and calls the fold "settle"
 * rather than making anyone learn the word merge.
 */

import { useCallback, useEffect, useState } from "react";
import { CONFIG, shortAddr, formatXLM, contractExplorerUrl } from "@/lib/stellar";
import { proposeCallRaw, allowContract, getAllowedContracts, describeError } from "@/lib/contract";
import {
  vaultConfidentialKey,
  readConfidentialBalance,
  isRegistered as checkRegistered,
  buildRegisterArgs,
  buildDepositArgs,
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
  /** The vault's public XLM — what can still be moved into the hidden side. */
  publicBalance: bigint | null;
  fromLedger: number;
  onBack: () => void;
  onProposed: (what: string) => void;
  onError: (msg: string) => void;
  onGoToVault: () => void;
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
const gold: React.CSSProperties = {
  width: "100%",
  background: "#C9A86A",
  color: "#0A0A0B",
  border: "none",
  fontFamily: SANS,
  fontWeight: 600,
  fontSize: 14,
  padding: 13,
  borderRadius: 10,
  cursor: "pointer",
};

const toStroops = (s: string): bigint => {
  const n = Number(String(s).replace(/,/g, "").trim());
  if (!isFinite(n) || n <= 0) throw new Error("Enter a valid amount.");
  return BigInt(Math.round(n * 1e7));
};

export default function Confidential({
  wallet, vaultAddress, publicBalance, fromLedger, onBack, onProposed, onError, onGoToVault,
}: Props) {
  const [keys, setKeys] = useState<any>(null);
  const [balance, setBalance] = useState<ConfidentialBalance | null>(null);
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastProposal, setLastProposal] = useState<string | null>(null);

  const [depositAmount, setDepositAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    checkRegistered(vaultAddress).then(setRegistered).catch(() => setRegistered(false));
  }, [vaultAddress]);

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

  const unlock = () =>
    run("unlock", async () => {
      const k = await vaultConfidentialKey(vaultAddress);
      setKeys(k);
      setBalance(await readConfidentialBalance(vaultAddress, k, fromLedger));
    });

  const refresh = useCallback(async () => {
    setRegistered(await checkRegistered(vaultAddress));
    if (keys) setBalance(await readConfidentialBalance(vaultAddress, keys, fromLedger));
  }, [keys, vaultAddress, fromLedger]);

  /**
   * Nothing here executes. Each button files a proposal the vault's signers
   * still have to approve — the same rule as any other spend, which is the
   * point, but easy to miss when a button says "Send".
   */
  const propose = (label: string, human: string, fn: string, build: () => Promise<any[]>) =>
    run(label, async () => {
      if (!wallet) throw new Error("Connect a wallet first.");
      const allowed = await getAllowedContracts(vaultAddress);
      if (!allowed.includes(CONFIG.confidentialTokenId)) {
        await allowContract(vaultAddress, wallet, CONFIG.confidentialTokenId);
      }
      await proposeCallRaw(vaultAddress, wallet, CONFIG.confidentialTokenId, fn, await build());
      setLastProposal(human);
      onProposed(human);
    });

  const spendable = balance?.spendable ?? 0n;
  const settling = balance?.receiving ?? 0n;
  const total = spendable + settling;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <button onClick={onBack} className="h-navtext" style={{ background: "transparent", border: "none", color: "#8A857B", fontFamily: SANS, fontSize: 13, cursor: "pointer", marginBottom: 20, padding: 0 }}>← Back to vault</button>
      <h1 style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 34, marginBottom: 8 }}>Hidden amounts</h1>
      <p style={{ fontSize: 14, color: "#8A857B", marginBottom: 22, lineHeight: 1.6 }}>
        A second balance for this vault where amounts never appear on-chain. It holds real XLM — moved in from the vault&apos;s public balance, and withdrawable back to it. This hides <span style={{ color: "#ECE7DD" }}>how much</span>; to hide <span style={{ color: "#ECE7DD" }}>who approved</span>, choose anonymous approvals when proposing.
      </p>

      {lastProposal && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, border: "1px solid rgba(201,168,106,0.35)", borderRadius: 12, background: "linear-gradient(180deg,#16150f,#121210)", padding: "16px 18px", marginBottom: 18 }}>
          <div style={{ fontSize: 13, color: "#ECE7DD", lineHeight: 1.55 }}>
            <b>{lastProposal}</b> is waiting for approval — nothing has moved yet. Approve and execute it in the vault, like any other proposal.
          </div>
          <button onClick={onGoToVault} className="h-goldbtn" style={{ ...gold, width: "auto", whiteSpace: "nowrap", padding: "10px 16px" }}>Go to vault →</button>
        </div>
      )}

      {/* ---------------- balance ---------------- */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Hidden balance</div>
          <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".12em", color: keys ? "#7FB069" : "#8A857B", border: `1px solid ${keys ? "rgba(127,176,105,0.4)" : "rgba(236,231,221,0.14)"}`, borderRadius: 6, padding: "3px 8px" }}>
            {keys ? "UNLOCKED" : "LOCKED"}
          </span>
        </div>

        {balance ? (
          <>
            <div style={{ fontFamily: DISPLAY, fontSize: 38, color: "#ECE7DD", margin: "10px 0 2px" }}>
              {formatXLM(total)} <span style={{ fontSize: 15, fontFamily: MONO, color: "#8A857B" }}>XLM</span>
            </div>
            {settling > 0n ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12, borderTop: "1px solid rgba(236,231,221,0.06)", paddingTop: 12 }}>
                <div style={{ fontSize: 12.5, color: "#8A857B", lineHeight: 1.5 }}>
                  {formatXLM(settling)} XLM just arrived and can&apos;t be sent until it settles. Incoming funds are held apart so nobody can disturb a payment you&apos;re signing.
                </div>
                <button
                  onClick={() => propose("settle", "Settling incoming funds", "merge", () => buildMergeArgs(vaultAddress))}
                  disabled={!!busy}
                  style={{ background: "transparent", color: "#C9A86A", border: "1px solid rgba(201,168,106,0.45)", borderRadius: 9, padding: "9px 14px", fontFamily: SANS, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                >{busy === "settle" ? "…" : "Settle"}</button>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "#8A857B" }}>Ready to send.</div>
            )}
            <button onClick={() => run("refresh", refresh)} className="h-navtext" style={{ marginTop: 12, background: "transparent", border: "none", color: "#5a564d", fontFamily: SANS, fontSize: 12, cursor: "pointer", padding: 0 }}>↻ refresh</button>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: "#8A857B", margin: "10px 0 16px", lineHeight: 1.6 }}>
              Reading this balance needs the vault&apos;s viewing key, derived from a wallet signature — a signature, not a transaction, so there is no fee. It can read and prove, but not spend: moving funds still needs the vault&apos;s threshold.
            </p>
            <button onClick={unlock} disabled={!!busy || !wallet} style={{ ...gold, background: "transparent", color: "#C9A86A", border: "1px solid rgba(201,168,106,0.45)", opacity: busy === "unlock" ? 0.6 : 1 }}>
              {busy === "unlock" ? "Check Freighter…" : "Unlock with wallet signature"}
            </button>
          </>
        )}
      </div>

      {/* ---------------- step 1: register ---------------- */}
      {registered === false && (
        <div style={{ ...card, borderColor: "rgba(201,168,106,0.3)" }}>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".14em", color: "#C9A86A", marginBottom: 8 }}>ONE-TIME SETUP</div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Publish the vault&apos;s confidential key</div>
          <p style={{ fontSize: 13, color: "#8A857B", marginBottom: 16, lineHeight: 1.6 }}>
            Until this is done the vault has no confidential account at all, so funds have nowhere to land: a sender encrypts the amount to your key, and there is no key on file. Done once per vault.
          </p>
          <button
            onClick={() => keys && propose("register", "Confidential setup", "register", () => buildRegisterArgs(vaultAddress, keys))}
            disabled={!!busy || !keys}
            style={{ ...gold, opacity: keys && !busy ? 1 : 0.45, cursor: keys ? "pointer" : "not-allowed" }}
          >
            {busy === "register" ? "Proving in browser…" : keys ? "Propose setup" : "Unlock first"}
          </button>
        </div>
      )}

      {/* ---------------- step 2: fund it ---------------- */}
      <div style={{ ...card, opacity: registered ? 1 : 0.45 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Move XLM in</div>
        <p style={{ fontSize: 13, color: "#8A857B", marginBottom: 14, lineHeight: 1.6 }}>
          From the vault&apos;s public balance{publicBalance != null ? ` (${formatXLM(publicBalance)} XLM)` : ""} into the hidden one. The amount is public going in — it only becomes hidden once inside.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder="0.00 XLM" disabled={!registered} style={{ ...input, flex: 1 }} />
          <button
            onClick={() => propose("deposit", "Moving XLM into the hidden balance", "deposit", () => buildDepositArgs(vaultAddress, toStroops(depositAmount)))}
            disabled={!!busy || !registered || !depositAmount.trim()}
            style={{ ...gold, width: "auto", padding: "0 20px", opacity: registered && depositAmount.trim() && !busy ? 1 : 0.45 }}
          >{busy === "deposit" ? "…" : "Move in"}</button>
        </div>
      </div>

      {/* ---------------- step 3: send ---------------- */}
      <div style={{ ...card, opacity: registered ? 1 : 0.45 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Send confidentially</div>
        <p style={{ fontSize: 13, color: "#8A857B", marginBottom: 14, lineHeight: 1.6 }}>
          The recipient needs a confidential account of their own — the amount is encrypted to their key. The proof is generated in this browser and takes a few seconds.
        </p>
        <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="G… recipient" disabled={!registered} style={{ ...input, marginBottom: 10 }} />
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00 XLM" disabled={!registered} style={{ ...input, marginBottom: 14 }} />
        <button
          onClick={() =>
            keys &&
            propose("transfer", "Confidential payment", "confidential_transfer", () =>
              buildTransferArgs(vaultAddress, recipient.trim(), toStroops(amount), keys, fromLedger)
            )
          }
          disabled={!!busy || !registered || !keys || !recipient.trim() || !amount.trim()}
          style={{ ...gold, opacity: registered && keys && recipient.trim() && amount.trim() && !busy ? 1 : 0.45 }}
        >
          {busy === "transfer" ? "Proving in browser…" : "Propose confidential payment"}
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
