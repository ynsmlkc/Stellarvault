// Soroban contract bindings for the Stellar Vault — reads (simulation) and
// writes (Freighter-signed). Mirrors the flow proven on CLI in Faz 1.

import {
  rpc,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  Address,
  Account,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { CONFIG, NETWORK_PASSPHRASE } from "./stellar";

const server = new rpc.Server(CONFIG.rpcUrl, { allowHttp: CONFIG.rpcUrl.startsWith("http://") });

// Any well-formed account works as the source for read-only simulation.
const READ_SOURCE = "GAEAII4H4RJOMCMJTVKUH5ZEJVAVT5CRFSRMMUZPNJG6BCYL7X2BOBUH";

/* ---------------- ScVal helpers ---------------- */
const u64 = (n: number | bigint) => nativeToScVal(BigInt(n), { type: "u64" });
const u32 = (n: number) => nativeToScVal(n, { type: "u32" });
const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });
const addr = (a: string) => new Address(a).toScVal();
const bool = (b: boolean) => nativeToScVal(b);
const str = (s: string) => nativeToScVal(s, { type: "string" });
const addrVec = (xs: string[]) => xdr.ScVal.scvVec(xs.map((a) => new Address(a).toScVal()));

/* ---------------- types ---------------- */
export type VaultConfig = {
  owner: string;
  name: string;
  threshold: number;
  signer_count: number;
  signers: string[];
};

export type Proposal = {
  id: number;
  target: string;
  amount: bigint;
  proposer: string;
  private_mode: boolean;
  approval_count: number;
  executed: boolean;
  created_at: number;
};

/* ---------------- reads (simulate only) ---------------- */
async function simulate(contractId: string, method: string, args: xdr.ScVal[]): Promise<any> {
  const source = new Account(READ_SOURCE, "0");
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  if (!sim.result?.retval) throw new Error("no retval");
  return scValToNative(sim.result.retval);
}

export async function getVault(vaultId: number): Promise<VaultConfig> {
  const v = await simulate(CONFIG.vaultId, "get_vault", [u64(vaultId)]);
  return {
    owner: v.owner,
    name: v.name,
    threshold: Number(v.threshold),
    signer_count: Number(v.signer_count),
    signers: v.signers,
  };
}

/** Per-vault balance (each vault has its own, like a Safe). */
export async function getVaultBalance(vaultId: number): Promise<bigint> {
  const bal = await simulate(CONFIG.vaultId, "get_vault_balance", [u64(vaultId)]);
  return BigInt(bal);
}

/** Total XLM held by the vault contract across all vaults (for the landing stat). */
export async function getContractBalance(): Promise<bigint> {
  const bal = await simulate(CONFIG.tokenId, "balance", [addr(CONFIG.vaultId)]);
  return BigInt(bal);
}

export async function getProposal(vaultId: number, txId: number): Promise<Proposal> {
  const p = await simulate(CONFIG.vaultId, "get_proposal_fn", [u64(vaultId), u64(txId)]);
  return {
    id: Number(p.id),
    target: p.target,
    amount: BigInt(p.amount),
    proposer: p.proposer,
    private_mode: p.private_mode,
    approval_count: Number(p.approval_count),
    executed: p.executed,
    created_at: Number(p.created_at),
  };
}

export async function getProposals(vaultId: number, max = 16): Promise<Proposal[]> {
  const out: Proposal[] = [];
  for (let i = 0; i < max; i++) {
    try {
      out.push(await getProposal(vaultId, i));
    } catch {
      break; // first missing tx_id ends the list
    }
  }
  return out;
}

/* ---------------- writes (Freighter-signed) ---------------- */
async function invoke(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  source: string
): Promise<{ hash: string; returnValue: any }> {
  const freighter = await import("@stellar/freighter-api");
  const account = await server.getAccount(source);
  const contract = new Contract(contractId);
  const built = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(built);
  const signed = await freighter.signTransaction(prepared.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
    address: source,
  });
  if ((signed as any).error) throw new Error((signed as any).error);

  const signedTx = TransactionBuilder.fromXDR(signed.signedTxXdr, NETWORK_PASSPHRASE);
  const sent = await server.sendTransaction(signedTx);
  if (sent.status === "ERROR") throw new Error("Transaction submission failed");

  // poll for completion
  let attempts = 0;
  let res = await server.getTransaction(sent.hash);
  while (res.status === rpc.Api.GetTransactionStatus.NOT_FOUND && attempts < 30) {
    await new Promise((r) => setTimeout(r, 1000));
    res = await server.getTransaction(sent.hash);
    attempts++;
  }
  if (res.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction failed: ${res.status}`);
  }
  const returnValue =
    res.status === rpc.Api.GetTransactionStatus.SUCCESS && (res as any).returnValue
      ? scValToNative((res as any).returnValue)
      : undefined;
  return { hash: sent.hash, returnValue };
}

/** Creates a vault and returns the new vault id (u64) from the contract. */
export async function createVault(owner: string, name: string, signers: string[], threshold: number): Promise<number> {
  const { returnValue } = await invoke(
    CONFIG.vaultId,
    "create_vault",
    [addr(owner), str(name), addrVec(signers), u32(threshold)],
    owner
  );
  return Number(returnValue ?? 0);
}

export const setToken = (caller: string) =>
  invoke(CONFIG.vaultId, "set_token", [addr(caller), addr(CONFIG.tokenId)], caller);

export const proposeTransaction = (
  vaultId: number,
  proposer: string,
  target: string,
  amountStroops: bigint,
  privateMode: boolean
) =>
  invoke(
    CONFIG.vaultId,
    "propose_transaction",
    [u64(vaultId), addr(proposer), addr(target), i128(amountStroops), bool(privateMode)],
    proposer
  );

export const approve = (vaultId: number, txId: number, signer: string) =>
  invoke(CONFIG.vaultId, "approve", [u64(vaultId), u64(txId), addr(signer)], signer);

/* ---- ZK approval (private mode) ---- */
function fieldTo32(dec: string): Uint8Array {
  let h = BigInt(dec).toString(16);
  h = h.length > 64 ? h.slice(-64) : h.padStart(64, "0");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function proofTo256(proof: any): Uint8Array {
  const parts = [
    proof.pi_a[0], proof.pi_a[1],
    proof.pi_b[0][0], proof.pi_b[0][1], proof.pi_b[1][0], proof.pi_b[1][1],
    proof.pi_c[0], proof.pi_c[1],
  ];
  const out = new Uint8Array(256);
  parts.forEach((p, i) => out.set(fieldTo32(p), i * 32));
  return out;
}

/** Submit a real Groth16 proof + nullifier to approve_zk (identity hidden on-chain). */
export function approveZk(vaultId: number, txId: number, signer: string, proof: any, publicSignals: string[]) {
  const entry = (k: string, v: xdr.ScVal) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v });
  const zkApproval = xdr.ScVal.scvMap([
    entry("nullifier", nativeToScVal(BigInt(publicSignals[3]), { type: "u256" })),
    entry("proof", nativeToScVal(proofTo256(proof))),
    entry("public_inputs", xdr.ScVal.scvVec(publicSignals.map((s) => nativeToScVal(fieldTo32(s))))),
    entry("tx_id", u64(txId)),
  ]);
  return invoke(CONFIG.vaultId, "approve_zk", [u64(vaultId), u64(txId), addr(signer), zkApproval], signer);
}

export const execute = (vaultId: number, txId: number, executor: string) =>
  invoke(CONFIG.vaultId, "execute", [u64(vaultId), u64(txId), addr(executor)], executor);

/** Deposit XLM into a specific vault's own balance. */
export const depositToVault = (vaultId: number, from: string, amountStroops: bigint) =>
  invoke(CONFIG.vaultId, "deposit", [u64(vaultId), addr(from), i128(amountStroops)], from);

/* ---------------- shield pool (confidential transfer) ---------------- */
const u256 = (n: bigint) => nativeToScVal(n, { type: "u256" });

/** Deposit `amount` into the shield pool, registering a note `commitment`. */
export const poolDeposit = (from: string, amountStroops: bigint, commitment: bigint) =>
  invoke(CONFIG.shieldPoolId, "deposit", [addr(from), i128(amountStroops), u256(commitment)], from);

/** Confidential withdraw: spend a note (Groth16 proof) to `recipient`. */
export const poolWithdraw = (
  signer: string,
  proof: any,
  root: bigint,
  nullifierHash: bigint,
  recipient: string,
  amountStroops: bigint
) =>
  invoke(
    CONFIG.shieldPoolId,
    "withdraw",
    [nativeToScVal(proofTo256(proof)), u256(root), u256(nullifierHash), addr(recipient), i128(amountStroops)],
    signer
  );

/** All deposited commitments — the frontend rebuilds the Merkle tree from these. */
export async function getCommitments(): Promise<bigint[]> {
  const list = await simulate(CONFIG.shieldPoolId, "get_commitments", []);
  return (list ?? []).map((x: any) => BigInt(x));
}

export async function isSpent(nullifierHash: bigint): Promise<boolean> {
  return simulate(CONFIG.shieldPoolId, "is_spent", [u256(nullifierHash)]);
}

export async function getShieldBalance(): Promise<bigint> {
  return BigInt(await simulate(CONFIG.tokenId, "balance", [addr(CONFIG.shieldPoolId)]));
}
