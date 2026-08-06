// Can a Stellar Vault hold and move a CONFIDENTIAL balance?
//
// The question is whether the vault's arbitrary-call feature composes with
// OpenZeppelin's confidential token. If it does, confidential treasury payments
// need no new vault code at all: a private payment is just a proposal that
// calls `confidential_transfer`, and the multi-sig threshold governs it like
// any other proposal.
//
// Note on the trust model: the proof is built off-chain by whoever proposes
// (they hold the vault's Grumpkin key), but it moves nothing on its own —
// `confidential_transfer` requires the VAULT to authorise, and the vault only
// authorises what its signers approved. The Grumpkin key is a proving/viewing
// key, not a spending key.
//
// Usage: OWNER_SECRET=… VAULT=C… pnpm --filter @ctd/sdk exec tsx ../../scripts/vault-ct-spike.ts

import { Keypair, xdr, Address, TransactionBuilder, Contract, rpc, scValToNative } from "@stellar/stellar-sdk";
import { ChainClient, keypairSigner } from "../packages/sdk/src/chain/client.js";
import { deriveKeys, type KeyPair } from "../packages/sdk/src/crypto/keys.js";
import { addressToField } from "../packages/sdk/src/crypto/address.js";
import { FR_MODULUS } from "../packages/sdk/src/crypto/constants.js";
import { type Point } from "../packages/sdk/src/crypto/grumpkin.js";
import { buildRegisterWitness } from "../packages/sdk/src/witness/register.js";
import { buildTransferWitness } from "../packages/sdk/src/witness/transfer.js";
import { encodeRegisterData, encodeTransferData } from "../packages/sdk/src/chain/payload.js";
import { CircuitProver } from "../packages/sdk/src/proving/prover.js";
import { StateEngine, MemoryStore } from "../packages/sdk/src/state/index.js";
import { loadDeployment, RPC_URL, PASSPHRASE } from "./_shared.js";
import { loadCircuit } from "../packages/sdk/src/proving/artifacts.js";

const VAULT = process.env.VAULT!;
const owner = Keypair.fromSecret(process.env.OWNER_SECRET!);
const AUDITOR_ID = 0;
const DEPOSIT = 1000n;
const TRANSFER = 400n;

const dep = loadDeployment();
const CT = dep.contracts.token;
const client = new ChainClient({
  rpcUrl: RPC_URL,
  networkPassphrase: PASSPHRASE,
  contracts: { token: dep.contracts.token, verifier: dep.contracts.verifier, auditor: dep.contracts.auditor },
});
const ownerSigner = keypairSigner(owner.secret(), PASSPHRASE);
const server = new rpc.Server(RPC_URL);

/** Invoke our own vault. It is not part of the confidential-token SDK. */
async function vaultCall(method: string, args: xdr.ScVal[]): Promise<any> {
  const account = await server.getAccount(owner.publicKey());
  const tx = new TransactionBuilder(account, { fee: "10000000", networkPassphrase: PASSPHRASE })
    .addOperation(new Contract(VAULT).call(method, ...args))
    .setTimeout(90)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(owner);
  const sent = await server.sendTransaction(prepared);
  let res = await server.getTransaction(sent.hash);
  for (let i = 0; i < 90 && res.status === "NOT_FOUND"; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    res = await server.getTransaction(sent.hash);
  }
  if (res.status !== "SUCCESS") throw new Error(`vault.${method}: ${res.status}`);
  return (res as any).returnValue ? scValToNative((res as any).returnValue) : null;
}

const u64 = (n: bigint | number) => xdr.ScVal.scvU64(new xdr.Uint64(BigInt(n)));

/** The whole integration: a confidential-token op travels as a vault proposal. */
const entry = (k: string, v: xdr.ScVal) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v });

const callSpec = (contract: string, fn: string, args: xdr.ScVal[]) =>
  xdr.ScVal.scvMap([
    entry("args", xdr.ScVal.scvVec(args)),
    entry("contract", new Address(contract).toScVal()),
    entry("function", xdr.ScVal.scvSymbol(fn)),
  ]);

async function proposeApproveExecute(fn: string, args: xdr.ScVal[], auth: xdr.ScVal[] = []): Promise<void> {
  const txId = await vaultCall("propose_call", [
    new Address(owner.publicKey()).toScVal(),
    new Address(CT).toScVal(),
    xdr.ScVal.scvSymbol(fn),
    xdr.ScVal.scvVec(args),
    xdr.ScVal.scvVec(auth),
    xdr.ScVal.scvBool(false),
  ]);
  const id = BigInt(txId);
  await vaultCall("approve", [u64(id), new Address(owner.publicKey()).toScVal()]);
  await vaultCall("execute", [u64(id), new Address(owner.publicKey()).toScVal()]);
  console.log(`  proposal #${id} executed → ${fn}()`);
}

async function main() {
  const addrF = addressToField(CT);
  const kAud: Point = await client.auditorKey(AUDITOR_ID);

  // The vault's Grumpkin key, derived from the owner's Stellar signature over a
  // fixed message — the same shape as the vault's ZK signer key.
  // The signature is 512 bits; a Grumpkin scalar must be < FR_MODULUS.
  const scalarFrom = (sig: Uint8Array) =>
    (BigInt("0x" + Buffer.from(sig).toString("hex")) % (FR_MODULUS - 1n)) + 1n;
  const seed = owner.sign(Buffer.from(`Stellar Vault — confidential key v1\nVault: ${VAULT}`, "utf8"));
  const vaultKeys: KeyPair = deriveKeys(scalarFrom(seed), addrF);

  console.log(`vault : ${VAULT}`);
  console.log(`token : ${CT}\n`);

  console.log("[allowlist] letting the vault call the confidential token …");
  await vaultCall("allow_contract", [new Address(CT).toScVal()]);

  console.log("\n[register] the VAULT becomes a confidential account …");
  if (await client.isRegistered(VAULT)) {
    console.log("  already registered — skipping");
  } else {
    const w = buildRegisterWitness(vaultKeys);
    const { proof } = await new CircuitProver(loadCircuit("register")).prove(w.inputs);
    await proposeApproveExecute("register", [
      new Address(VAULT).toScVal(),
      xdr.ScVal.scvU32(AUDITOR_ID),
      encodeRegisterData(w, proof),
    ]);
  }

  console.log("\n[deposit] the VAULT funds its own confidential balance …");
  // The claim under test: deposit(from = vault) makes the token call the
  // underlying SAC's transfer(from = vault, …) one level below the vault's own
  // call, so the vault must pre-authorise it or the host refuses with
  // Error(Auth, InvalidAction) however the proposal was approved.
  const i128 = (v: bigint) =>
    xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: new xdr.Int64(0n), lo: new xdr.Uint64(v) }));
  await vaultCall("allow_contract", [new Address(dep.contracts.underlying).toScVal()]);
  await proposeApproveExecute(
    "deposit",
    [new Address(VAULT).toScVal(), new Address(VAULT).toScVal(), i128(DEPOSIT)],
    [callSpec(dep.contracts.underlying, "transfer", [
      new Address(VAULT).toScVal(),
      new Address(CT).toScVal(),
      i128(DEPOSIT),
    ])]
  );
  console.log(`  deposited ${DEPOSIT} through the vault`);

  console.log("\n[merge] folding receiving → spendable, as a proposal …");
  await proposeApproveExecute("merge", [new Address(VAULT).toScVal()]);

  const engine = new StateEngine({
    client, store: new MemoryStore(), keys: vaultKeys,
    address: VAULT, fromLedger: dep.deployedAtLedger,
  });
  {
    const s = await engine.sync();
    console.log(`  vault spendable = ${s.spendable.v}`);
  }

  console.log("\n[confidential_transfer] the vault pays privately, under its threshold …");
  const recipient = Keypair.random();
  await fetch(`https://friendbot.stellar.org/?addr=${recipient.publicKey()}`);
  const recipientSigner = keypairSigner(recipient.secret(), PASSPHRASE);
  const recipientKeys = deriveKeys(scalarFrom(recipient.sign(Buffer.from("ctd", "utf8"))), addrF);
  {
    const w = buildRegisterWitness(recipientKeys);
    const { proof } = await new CircuitProver(loadCircuit("register")).prove(w.inputs);
    await client.invoke(CT, "register", [
      new Address(recipient.publicKey()).toScVal(),
      xdr.ScVal.scvU32(AUDITOR_ID),
      encodeRegisterData(w, proof),
    ], recipientSigner);
    console.log(`  recipient ${recipient.publicKey().slice(0, 8)}… registered`);
  }
  {
    const s = await engine.current();
    const w = buildTransferWitness({
      keys: vaultKeys, v: s.spendable.v, r: s.spendable.r, amount: TRANSFER,
      pvkB: recipientKeys.PVK, kAudR: kAud, kAudS: kAud,
    });
    const { proof } = await new CircuitProver(loadCircuit("transfer")).prove(w.inputs);
    await proposeApproveExecute("confidential_transfer", [
      new Address(VAULT).toScVal(),
      new Address(recipient.publicKey()).toScVal(),
      encodeTransferData(w, proof),
    ]);
  }
  {
    const s = await engine.sync();
    console.log(`  vault spendable = ${s.spendable.v} (was ${DEPOSIT})`);
    if (s.spendable.v !== DEPOSIT - TRANSFER) throw new Error(`expected ${DEPOSIT - TRANSFER}, got ${s.spendable.v}`);
  }

  console.log("\nOK — the vault holds a confidential balance and pays from it under its own threshold.");
  console.log("No vault contract changes were needed: this rides on propose_call.");
  process.exit(0);

}

main().catch((e) => { console.error(e); process.exit(1); });
