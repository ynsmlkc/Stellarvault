// Stellar / Soroban configuration + helpers for Stellar Vault.

export const CONFIG = {
  factoryId: process.env.NEXT_PUBLIC_FACTORY_ID ?? "",
  demoVault: process.env.NEXT_PUBLIC_DEMO_VAULT ?? "",
  vaultId: process.env.NEXT_PUBLIC_VAULT_CONTRACT_ID ?? "",
  tokenId: process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID ?? "",
  /** Nethermind's verifier — explored in Faz 4, keyed to their circuit, unused. */
  verifierId: process.env.NEXT_PUBLIC_VERIFIER_CONTRACT_ID ?? "",
  /** Our Groth16 verifier, keyed to voteApproval.circom. */
  groth16VerifierId: process.env.NEXT_PUBLIC_GROTH16_VERIFIER_ID ?? "",
  /** Confidential token stack (OpenZeppelin), wrapping the native XLM SAC. */
  confidentialTokenId: process.env.NEXT_PUBLIC_CONFIDENTIAL_TOKEN_ID ?? "",
  confidentialVerifierId: process.env.NEXT_PUBLIC_CONFIDENTIAL_VERIFIER_ID ?? "",
  confidentialAuditorId: process.env.NEXT_PUBLIC_CONFIDENTIAL_AUDITOR_ID ?? "",
  /** Which auditor a new confidential account binds to. See .env.production. */
  confidentialAuditorIndex: Number(process.env.NEXT_PUBLIC_CONFIDENTIAL_AUDITOR_INDEX ?? "0"),
  /** The vault-instance WASM the factory currently serves — what an upgrade targets. */
  vaultWasmHash: process.env.NEXT_PUBLIC_VAULT_WASM_HASH ?? "",
  /** Ledger the confidential token was deployed at — where event replay starts. */
  confidentialFromLedger: Number(process.env.NEXT_PUBLIC_CONFIDENTIAL_FROM_LEDGER ?? "0"),
  network: process.env.NEXT_PUBLIC_NETWORK ?? "testnet",
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org",
};

export const NETWORK_PASSPHRASE =
  CONFIG.network === "mainnet"
    ? "Public Global Stellar Network ; September 2015"
    : "Test SDF Network ; September 2015";

export const EXPLORER = `https://stellar.expert/explorer/${CONFIG.network}`;

export function shortAddr(addr: string, lead = 4, tail = 4): string {
  if (!addr || addr.length <= lead + tail + 1) return addr;
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}

export function shortContract(id: string): string {
  if (!id) return "";
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

// 7-decimal stroops -> human XLM string with thousands separators.
export function formatXLM(stroops: bigint | number | string): string {
  const v = typeof stroops === "bigint" ? stroops : BigInt(Math.trunc(Number(stroops)));
  const whole = v / 10_000_000n;
  const frac = v % 10_000_000n;
  const fracStr = frac.toString().padStart(7, "0").slice(0, 2);
  return `${whole.toLocaleString("en-US")}.${fracStr}`;
}

/**
 * Every stroop of it, no grouping — for prefilling an input the user may save
 * back. `formatXLM` truncates to two decimals, so round-tripping a 1.005 cap
 * through it would silently rewrite the policy as 1.00. Output is always valid
 * input to `toStroops`.
 */
export function xlmExact(stroops: bigint): string {
  const neg = stroops < 0n;
  const v = neg ? -stroops : stroops;
  const frac = (v % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${v / 10_000_000n}${frac ? `.${frac}` : ""}`;
}

/**
 * Grouped for reading, but never hides a stroop.
 *
 * `formatXLM` cuts at two decimals, which is right for a balance and wrong for
 * a line item someone is about to approve: a 1-stroop payment renders as
 * "0.00" and looks like nothing.
 */
export function formatXLMExact(stroops: bigint): string {
  const neg = stroops < 0n;
  const v = neg ? -stroops : stroops;
  const frac = (v % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${neg ? "-" : ""}${(v / 10_000_000n).toLocaleString("en-US")}.${frac}`;
}

export const contractExplorerUrl = (id: string) => `${EXPLORER}/contract/${id}`;
export const txExplorerUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;

// ---- Freighter wallet (dynamically imported so SSR never touches it) ----
export type WalletState = {
  address: string;
  network: string;
};

export async function connectFreighter(): Promise<WalletState> {
  const freighter = await import("@stellar/freighter-api");
  const access = await freighter.requestAccess();
  if (access.error) throw new Error(access.error);
  const net = await freighter.getNetwork();
  return { address: access.address, network: net.network ?? CONFIG.network };
}

export async function getConnectedAddress(): Promise<string | null> {
  try {
    const freighter = await import("@stellar/freighter-api");
    const connected = await freighter.isConnected();
    if (!connected.isConnected) return null;
    const allowed = await freighter.isAllowed();
    if (!allowed.isAllowed) return null;
    const res = await freighter.getAddress();
    return res.address || null;
  } catch {
    return null;
  }
}

/**
 * Human amount string -> stroops.
 *
 * Done on the string rather than through `Number`, because `n * 1e7` loses
 * precision above ~9e8 XLM and this is money. Anything ambiguous is refused
 * instead of guessed: `"1,5"` is 1.5 to a Turkish reader and malformed to an
 * American one, and the app displays en-US, so it cannot be resolved safely.
 *
 * Throws with a message meant for the user.
 */
export function toStroops(input: string): bigint {
  const s = input.trim();
  if (!s) throw new Error("Enter an amount.");

  // en-US grouping is accepted because that is what the app itself prints.
  if (!/^\d{1,3}(,\d{3})*(\.\d+)?$/.test(s) && !/^\d+(\.\d+)?$/.test(s)) {
    throw new Error("Amounts look like 12.5 or 1,000.25 — use a dot for decimals.");
  }

  const [whole, frac = ""] = s.replace(/,/g, "").split(".");
  if (frac.length > 7) throw new Error("XLM has at most 7 decimal places.");

  const stroops = BigInt(whole) * 10_000_000n + BigInt(frac.padEnd(7, "0") || "0");
  if (stroops <= 0n) throw new Error("Enter an amount greater than zero.");
  return stroops;
}

/** Same, for the places that want a value or nothing rather than a throw. */
export function toStroopsSafe(input: string): bigint | null {
  try {
    return toStroops(input);
  } catch {
    return null;
  }
}
