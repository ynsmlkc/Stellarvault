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
const u256 = (n: bigint) => nativeToScVal(n, { type: "u256" });
/** One field of a struct. Soroban expects struct fields in symbol order. */
const entry = (k: string, v: xdr.ScVal) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v });

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

/** Owner-configurable spending guards. 0 / false = that guard is off. */
export type Policy = {
  max_per_tx: bigint;
  spending_cap: bigint;
  cap_window_ledgers: number;
  timelock_ledgers: number;
  allowlist_only: boolean;
};

export const OPEN_POLICY: Policy = {
  max_per_tx: 0n,
  spending_cap: 0n,
  cap_window_ledgers: 0,
  timelock_ledgers: 0,
  allowlist_only: false,
};

/** Guard state of one proposal — one read, everything the card needs. */
export type ProposalStatus = {
  cancelled: boolean;
  executed: boolean;
  approval_count: number;
  threshold: number;
  unlock_ledger: number;
  current_ledger: number;
  is_batch: boolean;
  amount: bigint;
};

export type BatchItem = { target: string; amount: bigint };

/**
 * A vault's on-chain proof settings. `vault_id` and `signer_root` are the
 * public inputs the vault pins down, so a proof for another vault — or against
 * a signer set the owner never published — is refused.
 */
export type ZkConfig = { verifier: string; vault_id: bigint; signer_root: bigint };

/**
 * An argument to a contract call. Soroban is typed, so the caller has to say
 * what each value *is* — there is no inferring `i128` from a string of digits.
 */
export type CallArgType = "address" | "i128" | "u32" | "u64" | "bool" | "symbol" | "string";
export type CallArg = { type: CallArgType; value: string };

/** The call a proposal will make, once it passes. */
export type CallSpec = { contract: string; function: string; args: unknown[] };

/** Encode one typed argument. Throws on malformed input rather than guessing. */
function argToScVal(a: CallArg): xdr.ScVal {
  const v = a.value.trim();
  switch (a.type) {
    case "address":
      return addr(v);
    case "i128":
      return i128(BigInt(v));
    case "u32":
      return u32(Number(v));
    case "u64":
      return u64(BigInt(v));
    case "bool":
      return bool(v === "true" || v === "1");
    case "symbol":
      return xdr.ScVal.scvSymbol(v);
    case "string":
      return str(v);
  }
}

/* ---------------- contract errors ---------------- */
/** Mirrors `Error` in vault-instance/src/lib.rs — keep the codes in sync. */
const VAULT_ERRORS: Record<number, string> = {
  1: "A vault needs at least one signer.",
  2: "Invalid threshold for this signer set.",
  3: "That wallet is not a signer of this vault.",
  4: "Only the proposer or the vault owner can cancel this.",
  5: "Proposal not found.",
  6: "This proposal was already executed.",
  7: "This proposal was cancelled.",
  8: "You already approved this proposal.",
  9: "Amount must be greater than zero.",
  10: "Not enough approvals yet.",
  11: "The vault doesn't hold enough to cover this.",
  12: "This approval was already counted (nullifier used).",
  13: "The ZK proof was empty.",
  14: "Blocked by the per-transaction limit.",
  15: "Blocked by the spending cap for this window.",
  16: "Time-lock is still active — this can't execute yet.",
  17: "Recipient is not on the allowlist.",
  18: "The allowlist is full (50 max).",
  19: "Invalid policy — limits cannot be negative.",
  20: "That address is already a signer.",
  21: "That address is not a signer.",
  22: "A batch needs at least one payment.",
  23: "A batch can hold at most 20 payments.",
  24: "The proof was rejected on-chain — it isn't a valid signer approval.",
  25: "This proof doesn't match this vault and proposal.",
  26: "The proof was malformed (expected 256 bytes).",
  27: "That contract is not on this vault's call allowlist.",
  28: "A vault can never call itself — that would let one proposal lift every guard.",
  29: "The call allowlist is full (50 max).",
  30: "Turn on on-chain verification before approving anonymously.",
  31: "That contract may not act on the vault's behalf — allowlist it first.",
};

/**
 * Turn a raw host error into something a human can act on. Soroban surfaces
 * contract errors as `Error(Contract, #14)` buried in the message, so the code
 * is all we get back — this maps it to the guard that actually fired.
 */
export function describeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const m = raw.match(/Error\(Contract,\s*#(\d+)\)/);
  if (m) {
    const known = VAULT_ERRORS[Number(m[1])];
    if (known) return known;
    return `Contract rejected this (code ${m[1]}).`;
  }
  return raw;
}

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

// Each vault is its OWN contract (Safe-style). `vaultAddr` is the instance address.

/** Reads on a freshly-deployed instance can lag the RPC — retry a few times. */
async function simulateRetry(contractId: string, method: string, args: xdr.ScVal[], tries = 6): Promise<any> {
  let last: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await simulate(contractId, method, args);
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
  throw last;
}

export async function getVault(vaultAddr: string): Promise<VaultConfig> {
  const v = await simulateRetry(vaultAddr, "get_config", []);
  return {
    owner: v.owner,
    name: v.name,
    threshold: Number(v.threshold),
    signer_count: Number(v.signer_count),
    signers: v.signers,
  };
}

/** Per-vault balance — native (the instance's own token balance, like a Safe). */
export async function getVaultBalance(vaultAddr: string): Promise<bigint> {
  return BigInt(await simulate(vaultAddr, "get_balance", []));
}

export async function getProposal(vaultAddr: string, txId: number): Promise<Proposal> {
  const p = await simulate(vaultAddr, "get_proposal", [u64(txId)]);
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

export async function getProposals(vaultAddr: string, max = 16): Promise<Proposal[]> {
  const out: Proposal[] = [];
  for (let i = 0; i < max; i++) {
    try {
      out.push(await getProposal(vaultAddr, i));
    } catch {
      break;
    }
  }
  return out;
}

/** Guard state for a proposal. Falls back gracefully on a pre-guards vault. */
export async function getStatus(vaultAddr: string, txId: number): Promise<ProposalStatus | null> {
  try {
    const s = await simulate(vaultAddr, "get_status", [u64(txId)]);
    return {
      cancelled: s.cancelled,
      executed: s.executed,
      approval_count: Number(s.approval_count),
      threshold: Number(s.threshold),
      unlock_ledger: Number(s.unlock_ledger),
      current_ledger: Number(s.current_ledger),
      is_batch: s.is_batch,
      amount: BigInt(s.amount),
    };
  } catch {
    return null; // v1 vault — no get_status entry point
  }
}

export async function getBatch(vaultAddr: string, txId: number): Promise<BatchItem[]> {
  try {
    const items = await simulate(vaultAddr, "get_batch", [u64(txId)]);
    return (items ?? []).map((i: any) => ({ target: i.target, amount: BigInt(i.amount) }));
  } catch {
    return [];
  }
}

/**
 * Contract code version: 2 = guards available, null = a vault deployed before
 * guards existed (it has no `version` entry point) and needs `upgrade()`.
 */
export async function getVersion(vaultAddr: string): Promise<number | null> {
  try {
    return Number(await simulate(vaultAddr, "version", []));
  } catch {
    return null;
  }
}

export async function getPolicy(vaultAddr: string): Promise<Policy> {
  try {
    const p = await simulate(vaultAddr, "get_policy", []);
    return {
      max_per_tx: BigInt(p.max_per_tx),
      spending_cap: BigInt(p.spending_cap),
      cap_window_ledgers: Number(p.cap_window_ledgers),
      timelock_ledgers: Number(p.timelock_ledgers),
      allowlist_only: p.allowlist_only,
    };
  } catch {
    return OPEN_POLICY; // v1 vault — no guards, nothing restricted
  }
}

export async function getAllowed(vaultAddr: string): Promise<string[]> {
  try {
    return (await simulate(vaultAddr, "get_allowed", [])) ?? [];
  } catch {
    return [];
  }
}

/**
 * The vault's on-chain ZK settings, or null when it does not verify proofs.
 * Null is the honest answer for every vault deployed before enforcement
 * existed — the UI says so rather than implying the proofs are checked.
 */
export async function getZkConfig(vaultAddr: string): Promise<ZkConfig | null> {
  try {
    const c = await simulate(vaultAddr, "get_zk_config", []);
    if (!c) return null;
    return {
      verifier: c.verifier,
      vault_id: BigInt(c.vault_id),
      signer_root: BigInt(c.signer_root),
    };
  } catch {
    return null; // pre-enforcement vault: no such entry point
  }
}

/** The published (shuffled) Merkle leaves a prover needs to build its path. */
export async function getSignerCommitments(vaultAddr: string): Promise<bigint[]> {
  try {
    return ((await simulate(vaultAddr, "get_signer_commitments", [])) ?? []).map((x: any) => BigInt(x));
  } catch {
    return [];
  }
}

export const setSignerCommitments = (vaultAddr: string, owner: string, commitments: bigint[]) =>
  invoke(vaultAddr, "set_signer_commitments", [xdr.ScVal.scvVec(commitments.map(u256))], owner);

/**
 * Point this vault at newer code. Owner-gated, and the only way an existing
 * vault ever gets a fix: `factory.set_wasm` decides what NEW vaults are born
 * with and leaves everything already deployed exactly where it was.
 */
export const upgradeVault = (vaultAddr: string, owner: string, wasmHash: string) =>
  invoke(
    vaultAddr,
    "upgrade",
    [nativeToScVal(Buffer.from(wasmHash, "hex"), { type: "bytes" })],
    owner
  );

export const setZkConfig = (
  vaultAddr: string,
  owner: string,
  verifier: string,
  vaultId: bigint,
  signerRoot: bigint
) => invoke(vaultAddr, "set_zk_config", [addr(verifier), u256(vaultId), u256(signerRoot)], owner);

/** Amount already spent in the vault's current cap window. */
export async function getSpentInWindow(vaultAddr: string): Promise<bigint> {
  try {
    return BigInt(await simulate(vaultAddr, "spent_in_window", []));
  } catch {
    return 0n;
  }
}

/** Vault addresses this owner created (factory's on-chain registry). */
export async function getMyVaults(owner: string): Promise<string[]> {
  try {
    const list = await simulate(CONFIG.factoryId, "get_vaults", [addr(owner)]);
    return (list ?? []) as string[];
  } catch {
    return [];
  }
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

  // prepareTransaction (simulation) can fail transiently on a freshly-active
  // contract / RPC lag — retry a few times BEFORE asking the wallet to sign.
  let prepared: any;
  let prepErr: any;
  for (let i = 0; i < 4; i++) {
    try {
      prepared = await server.prepareTransaction(built);
      break;
    } catch (e) {
      prepErr = e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (!prepared) throw prepErr;

  const signed = await freighter.signTransaction(prepared.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
    address: source,
  });
  if ((signed as any).error) throw new Error((signed as any).error);

  const signedTx = TransactionBuilder.fromXDR(signed.signedTxXdr, NETWORK_PASSPHRASE);

  // send, retrying transient "try again later" / network blips a couple times
  let sent = await server.sendTransaction(signedTx);
  for (let i = 0; i < 3 && (sent.status === "TRY_AGAIN_LATER" || (sent.status as string) === "ERROR"); i++) {
    await new Promise((r) => setTimeout(r, 2500));
    sent = await server.sendTransaction(signedTx);
  }
  if (sent.status === "ERROR") throw new Error("Network rejected the transaction — try again.");

  // poll until included — testnet RPC can lag, so give it up to ~75s
  let attempts = 0;
  let res = await server.getTransaction(sent.hash);
  while (res.status === rpc.Api.GetTransactionStatus.NOT_FOUND && attempts < 75) {
    await new Promise((r) => setTimeout(r, 1000));
    res = await server.getTransaction(sent.hash);
    attempts++;
  }
  if (res.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    throw new Error("Still confirming — it may have gone through. Hit ↻ refresh in a moment.");
  }
  if (res.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction failed on-chain: ${res.status}`);
  }
  const returnValue =
    res.status === rpc.Api.GetTransactionStatus.SUCCESS && (res as any).returnValue
      ? scValToNative((res as any).returnValue)
      : undefined;
  return { hash: sent.hash, returnValue };
}

/** Deploy a fresh vault via the factory; returns the new vault's address. */
export async function createVault(owner: string, name: string, signers: string[], threshold: number): Promise<string> {
  const { returnValue } = await invoke(
    CONFIG.factoryId,
    "create_vault",
    [addr(owner), str(name), addrVec(signers), u32(threshold)],
    owner
  );
  return String(returnValue);
}

export const proposeTransaction = (
  vaultAddr: string,
  proposer: string,
  target: string,
  amountStroops: bigint,
  privateMode: boolean
) =>
  invoke(vaultAddr, "propose", [addr(proposer), addr(target), i128(amountStroops), bool(privateMode)], proposer);

export const approve = (vaultAddr: string, txId: number, signer: string) =>
  invoke(vaultAddr, "approve", [u64(txId), addr(signer)], signer);

/* ---- ZK approval (private mode) ---- */
function fieldTo32(dec: string): Uint8Array {
  let h = BigInt(dec).toString(16);
  h = h.length > 64 ? h.slice(-64) : h.padStart(64, "0");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
/**
 * Pack a snarkjs proof into the 256 bytes the BN254 host functions expect:
 * `a (64) || b (128) || c (64)`.
 *
 * The G2 element is the trap. snarkjs stores each Fp2 coordinate as
 * `[c0, c1]` — real part first — while the host wants `be(c1) || be(c0)`,
 * imaginary part first. Emitting them in snarkjs order builds a verifier that
 * silently rejects every valid proof, which is a miserable thing to debug.
 */
function proofTo256(proof: any): Uint8Array {
  const parts = [
    proof.pi_a[0], proof.pi_a[1],
    // b: x_c1, x_c0, y_c1, y_c0  (each snarkjs pair reversed)
    proof.pi_b[0][1], proof.pi_b[0][0], proof.pi_b[1][1], proof.pi_b[1][0],
    proof.pi_c[0], proof.pi_c[1],
  ];
  const out = new Uint8Array(256);
  parts.forEach((p, i) => out.set(fieldTo32(p), i * 32));
  return out;
}

/** Submit a real Groth16 proof + nullifier to the instance's approve_zk (identity hidden). */
export function approveZk(vaultAddr: string, txId: number, signer: string, proof: any, publicSignals: string[]) {
  // vault-instance ZKApproval = { nullifier, proof, public_inputs } (keys sorted)
  const zkApproval = xdr.ScVal.scvMap([
    entry("nullifier", nativeToScVal(BigInt(publicSignals[3]), { type: "u256" })),
    entry("proof", nativeToScVal(proofTo256(proof))),
    entry("public_inputs", xdr.ScVal.scvVec(publicSignals.map((s) => nativeToScVal(fieldTo32(s))))),
  ]);
  return invoke(vaultAddr, "approve_zk", [u64(txId), addr(signer), zkApproval], signer);
}

/**
 * Submit a ZK approval with no identifying wallet: the proof is the
 * authorization. Requires the vault to verify proofs on-chain.
 *
 * `submitter` still pays the fee and signs the envelope, so it is whoever
 * relays this — pass a wallet other than the approver's for the anonymity to
 * mean anything.
 */
export function approveZkAnon(vaultAddr: string, txId: number, submitter: string, proof: any, publicSignals: string[]) {
  const zkApproval = xdr.ScVal.scvMap([
    entry("nullifier", nativeToScVal(BigInt(publicSignals[3]), { type: "u256" })),
    entry("proof", nativeToScVal(proofTo256(proof))),
    entry("public_inputs", xdr.ScVal.scvVec(publicSignals.map((s) => nativeToScVal(fieldTo32(s))))),
  ]);
  return invoke(vaultAddr, "approve_zk_anon", [u64(txId), zkApproval], submitter);
}

export const execute = (vaultAddr: string, txId: number, executor: string) =>
  invoke(vaultAddr, "execute", [u64(txId), addr(executor)], executor);

export const cancel = (vaultAddr: string, txId: number, caller: string) =>
  invoke(vaultAddr, "cancel", [u64(txId), addr(caller)], caller);

/* ---------------- guards (owner-only writes) ---------------- */
/** Struct fields must be emitted in symbol order, hence the alphabetical keys. */
const policyScVal = (p: Policy) =>
  xdr.ScVal.scvMap([
    entry("allowlist_only", bool(p.allowlist_only)),
    entry("cap_window_ledgers", u32(p.cap_window_ledgers)),
    entry("max_per_tx", i128(p.max_per_tx)),
    entry("spending_cap", i128(p.spending_cap)),
    entry("timelock_ledgers", u32(p.timelock_ledgers)),
  ]);

const batchScVal = (items: BatchItem[]) =>
  xdr.ScVal.scvVec(
    items.map((it) => xdr.ScVal.scvMap([entry("amount", i128(it.amount)), entry("target", addr(it.target))]))
  );

export const setPolicy = (vaultAddr: string, owner: string, policy: Policy) =>
  invoke(vaultAddr, "set_policy", [policyScVal(policy)], owner);

export const allowRecipient = (vaultAddr: string, owner: string, target: string) =>
  invoke(vaultAddr, "allow_recipient", [addr(target)], owner);

export const revokeRecipient = (vaultAddr: string, owner: string, target: string) =>
  invoke(vaultAddr, "revoke_recipient", [addr(target)], owner);

/* ---------------- arbitrary contract calls ---------------- */

/** The call a proposal makes, or null when it is an ordinary transfer. */
export async function getCall(vaultAddr: string, txId: number): Promise<CallSpec | null> {
  try {
    const c = await simulate(vaultAddr, "get_call", [u64(txId)]);
    if (!c) return null;
    return { contract: c.contract, function: c.function, args: c.args ?? [] };
  } catch {
    return null; // pre-v3 vault, or an ordinary transfer
  }
}

/** Contracts this vault is permitted to call. Empty means calls are off. */
export async function getAllowedContracts(vaultAddr: string): Promise<string[]> {
  try {
    return (await simulate(vaultAddr, "get_allowed_contracts", [])) ?? [];
  } catch {
    return [];
  }
}

export const proposeCall = (
  vaultAddr: string,
  proposer: string,
  contract: string,
  fn: string,
  args: CallArg[],
  privateMode: boolean
) =>
  invoke(
    vaultAddr,
    "propose_call",
    [
      addr(proposer),
      addr(contract),
      xdr.ScVal.scvSymbol(fn),
      xdr.ScVal.scvVec(args.map(argToScVal)),
      xdr.ScVal.scvVec([]),
      bool(privateMode),
    ],
    proposer
  );

/**
 * Propose a call whose arguments are already ScVals.
 *
 * `proposeCall` takes typed CallArgs because a human is filling in a form.
 * Callers that build their own payloads — a ZK proof envelope, say — have
 * nothing to type and would only lose fidelity round-tripping through strings.
 */
export type SubCall = { contract: string; function: string; args: xdr.ScVal[] };

const callSpecScVal = (c: SubCall) =>
  xdr.ScVal.scvMap([
    entry("args", xdr.ScVal.scvVec(c.args)),
    entry("contract", addr(c.contract)),
    entry("function", xdr.ScVal.scvSymbol(c.function)),
  ]);

export const proposeCallRaw = (
  vaultAddr: string,
  proposer: string,
  contract: string,
  fn: string,
  args: xdr.ScVal[],
  /** Calls the callee makes back out as the vault, which it must pre-authorise. */
  auth: SubCall[] = [],
  privateMode = false
) =>
  invoke(
    vaultAddr,
    "propose_call",
    [
      addr(proposer),
      addr(contract),
      xdr.ScVal.scvSymbol(fn),
      xdr.ScVal.scvVec(args),
      xdr.ScVal.scvVec(auth.map(callSpecScVal)),
      bool(privateMode),
    ],
    proposer
  );

export const allowContract = (vaultAddr: string, owner: string, contract: string) =>
  invoke(vaultAddr, "allow_contract", [addr(contract)], owner);

export const revokeContract = (vaultAddr: string, owner: string, contract: string) =>
  invoke(vaultAddr, "revoke_contract", [addr(contract)], owner);

/** Batch (multi-call): N payments approved once and executed atomically. */
export const proposeBatch = (
  vaultAddr: string,
  proposer: string,
  items: BatchItem[],
  privateMode: boolean
) => invoke(vaultAddr, "propose_batch", [addr(proposer), batchScVal(items), bool(privateMode)], proposer);

/** Deposit = a plain token transfer to the vault's own address (Safe-style). */
export const depositToVault = (vaultAddr: string, from: string, amountStroops: bigint) =>
  invoke(CONFIG.tokenId, "transfer", [addr(from), addr(vaultAddr), i128(amountStroops)], from);

/**
 * `register` on the confidential token, signed by a plain wallet for itself.
 *
 * The vault path routes the same call through a proposal because a vault can
 * only act by threshold. A wallet is its own authority, so this is one ordinary
 * transaction — and it is what makes that wallet payable confidentially.
 */
export const registerConfidentialAccount = (wallet: string, args: xdr.ScVal[]) =>
  invoke(CONFIG.confidentialTokenId, "register", args, wallet);

/** `merge` on the confidential token, for a wallet's own account. */
export const confidentialMergeSelf = (wallet: string, args: xdr.ScVal[]) =>
  invoke(CONFIG.confidentialTokenId, "merge", args, wallet);

/** `withdraw` on the confidential token, for a wallet's own account. */
export const confidentialWithdrawSelf = (wallet: string, args: xdr.ScVal[]) =>
  invoke(CONFIG.confidentialTokenId, "withdraw", args, wallet);
