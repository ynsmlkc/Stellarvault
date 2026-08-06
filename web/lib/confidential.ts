/**
 * Confidential balances for a vault, on OpenZeppelin's confidential token.
 *
 * The vault's public balance is what the guards police; this is the other half —
 * a balance held as a Pedersen commitment, where amounts never appear on-chain.
 * A confidential payment is not a new kind of vault operation: it is an ordinary
 * proposal that calls the token contract, so the threshold, time-lock,
 * cancellation and call allowlist govern it exactly as they govern a transfer.
 * That is why none of this needed a contract change — see
 * `spike/confidential-token/`.
 *
 * # The key, and what it can and cannot do
 *
 * Spending needs a Grumpkin key to build the proof, and a contract cannot hold a
 * secret — so a person does. It is derived here from a wallet signature over a
 * fixed per-vault message, the same shape as the vault's ZK signer key.
 *
 * That key alone moves nothing. `confidential_transfer(from = vault, …)`
 * requires the VAULT to authorise, and the vault only authorises what its
 * signers approved. It is a proving and viewing key, not a spending key. The
 * cost is that whoever can propose can also read the vault's confidential
 * balance — for a treasury whose signers are its co-owners, that is usually fine,
 * but it is a real difference from the public path.
 *
 * # The auditor
 *
 * Every transfer also emits a ciphertext to a registered auditor key, by design:
 * this is confidential *and* auditable, which is the point for regulated users.
 * The channel cannot be switched off here. Our own deployment holds that key.
 *
 * # Maturity
 *
 * Upstream is an unaudited developer preview on a feature branch of
 * OpenZeppelin's `stellar-contracts`. Testnet only.
 */

import { CONFIG, NETWORK_PASSPHRASE } from "./stellar";

/** Circuit artifacts, served from public/ so the browser prover can fetch them. */
const CIRCUITS = {
  register: "/ctd/circuits/register.json",
  transfer: "/ctd/circuits/transfer.json",
  withdraw: "/ctd/circuits/withdraw.json",
} as const;

export type ConfidentialBalance = { spendable: bigint; receiving: bigint };

/** Loaded lazily: the SDK drags in bb.js and noir, which are large. */
async function sdk() {
  const [mod, { ensureBrowserBackend }] = await Promise.all([
    import("@ctd/sdk"),
    import("./bb-loader"),
  ]);
  ensureBrowserBackend();
  return mod as any;
}

let circuitCache: Record<string, unknown> = {};
async function circuit(name: keyof typeof CIRCUITS) {
  circuitCache[name] ??= await fetch(CIRCUITS[name]).then((r) => r.json());
  return circuitCache[name];
}

function client(m: any) {
  return new m.ChainClient({
    rpcUrl: CONFIG.rpcUrl,
    networkPassphrase: NETWORK_PASSPHRASE,
    contracts: {
      token: CONFIG.confidentialTokenId,
      verifier: CONFIG.confidentialVerifierId,
      auditor: CONFIG.confidentialAuditorId,
    },
  });
}

/**
 * The vault's Grumpkin key, from a wallet signature.
 *
 * Ed25519 is deterministic, so this regenerates on demand and is never stored.
 * The signature is 512 bits and a Grumpkin scalar must be below the field
 * modulus, so it is reduced rather than truncated.
 */
export async function vaultConfidentialKey(vaultAddress: string): Promise<any> {
  const m = await sdk();
  const freighter = await import("@stellar/freighter-api");
  const message = `Stellar Vault — confidential key v1\nVault: ${vaultAddress}\n\nSigning this derives the vault's confidential viewing key. It never leaves this device.`;
  const res: any = await freighter.signMessage(message);
  if (res?.error) throw new Error(String(res.error));

  const sig: unknown = res?.signedMessage ?? res;
  const bytes =
    typeof sig === "string"
      ? new TextEncoder().encode(sig)
      : sig instanceof Uint8Array
        ? sig
        : new Uint8Array(Object.values(sig as Record<string, number>));

  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const scalar = (BigInt("0x" + hex) % (m.FR_MODULUS - 1n)) + 1n;
  return m.deriveKeys(scalar, m.addressToField(CONFIG.confidentialTokenId));
}

/** Read the vault's confidential balance by replaying events with its key. */
export async function readConfidentialBalance(
  vaultAddress: string,
  keys: any,
  fromLedger: number
): Promise<ConfidentialBalance> {
  const m = await sdk();
  const engine = new m.StateEngine({
    client: client(m),
    store: new m.MemoryStore(),
    keys,
    address: vaultAddress,
    fromLedger,
  });
  const s = await engine.sync();
  return { spendable: s.spendable.v, receiving: s.receiving.v };
}

/** Args for `register` — the vault becoming a confidential account. */
export async function buildRegisterArgs(vaultAddress: string, keys: any): Promise<any[]> {
  const m = await sdk();
  const { Address, xdr } = await import("@stellar/stellar-sdk");
  const w = m.buildRegisterWitness(keys);
  const { proof } = await new m.CircuitProver(await circuit("register")).prove(w.inputs);
  return [
    new Address(vaultAddress).toScVal(),
    xdr.ScVal.scvU32(0), // auditor id
    m.encodeRegisterData(w, proof),
  ];
}

/** Has this vault published its confidential keys yet? */
export async function isRegistered(vaultAddress: string): Promise<boolean> {
  const m = await sdk();
  return client(m).isRegistered(vaultAddress);
}

/**
 * Args for `deposit` — the vault's own public XLM into its confidential
 * receiving balance. Both sides are the vault: it pays, and it receives.
 *
 * No proof: the amount is public on the way in, and only becomes hidden once it
 * is inside a commitment.
 */
export async function buildDepositArgs(vaultAddress: string, amount: bigint): Promise<any[]> {
  const { Address, nativeToScVal } = await import("@stellar/stellar-sdk");
  return [
    new Address(vaultAddress).toScVal(),
    new Address(vaultAddress).toScVal(),
    nativeToScVal(amount, { type: "i128" }),
  ];
}

/** Args for `merge` — folding receiving into spendable. No proof needed. */
export async function buildMergeArgs(vaultAddress: string): Promise<any[]> {
  const { Address } = await import("@stellar/stellar-sdk");
  return [new Address(vaultAddress).toScVal()];
}

/**
 * Args for `confidential_transfer`. The recipient must already be registered,
 * otherwise there is no key to encrypt the amount to.
 */
export async function buildTransferArgs(
  vaultAddress: string,
  recipient: string,
  amount: bigint,
  keys: any,
  fromLedger: number
): Promise<any[]> {
  const m = await sdk();
  const { Address } = await import("@stellar/stellar-sdk");
  const c = client(m);

  const engine = new m.StateEngine({
    client: c, store: new m.MemoryStore(), keys, address: vaultAddress, fromLedger,
  });
  const s = await engine.sync();
  if (s.spendable.v < amount) {
    throw new Error(`Confidential balance is ${s.spendable.v}, need ${amount}.`);
  }

  // The recipient's viewing key comes from their on-chain account record; the
  // amount is encrypted to it, so an unregistered recipient cannot be paid.
  const to = await c.confidentialBalance(recipient);
  if (!to) throw new Error("The recipient hasn't registered a confidential account yet.");

  // Sender and recipient may sit under different auditors — each channel is
  // encrypted to its own.
  const [kAudR, kAudS] = await Promise.all([c.auditorKey(to.auditorId), c.auditorKey(0)]);

  const w = m.buildTransferWitness({
    keys, v: s.spendable.v, r: s.spendable.r, amount,
    pvkB: to.viewingPublicKey, kAudR, kAudS,
  });
  const { proof } = await new m.CircuitProver(await circuit("transfer")).prove(w.inputs);
  return [
    new Address(vaultAddress).toScVal(),
    new Address(recipient).toScVal(),
    m.encodeTransferData(w, proof),
  ];
}
