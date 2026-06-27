// Stellar / Soroban configuration + helpers for Stellar Vault.

export const CONFIG = {
  vaultId: process.env.NEXT_PUBLIC_VAULT_CONTRACT_ID ?? "",
  tokenId: process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID ?? "",
  poolId: process.env.NEXT_PUBLIC_POOL_CONTRACT_ID ?? "",
  shieldPoolId: process.env.NEXT_PUBLIC_SHIELD_POOL_ID ?? "",
  verifierId: process.env.NEXT_PUBLIC_VERIFIER_CONTRACT_ID ?? "",
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
