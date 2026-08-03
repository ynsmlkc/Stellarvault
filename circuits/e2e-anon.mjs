// Proves the two claims that only a live network can settle:
//
//   1. the signer key really comes from a wallet signature, so a published
//      commitment cannot be recomputed from public data, and
//   2. a valid proof can be submitted by a wallet that is NOT a signer —
//      which is what makes relaying possible at all.
//
// Usage: DEPLOYER_SECRET=… STRANGER_SECRET=… node e2e-anon.mjs <vault> <verifier>

import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";
import { readFileSync } from "fs";
import { createHash } from "crypto";
import {
  rpc, TransactionBuilder, BASE_FEE, Contract, Address, Keypair,
  nativeToScVal, scValToNative, xdr, Networks,
} from "@stellar/stellar-sdk";

const [VAULT, VERIFIER] = process.argv.slice(2);
const server = new rpc.Server("https://soroban-testnet.stellar.org");
const PASS = Networks.TESTNET;

const owner = Keypair.fromSecret(process.env.DEPLOYER_SECRET);
const stranger = Keypair.fromSecret(process.env.STRANGER_SECRET);

const LEVELS = 4;
const poseidon = await buildPoseidon();
const F = poseidon.F;
const H = (a) => BigInt(F.toString(poseidon(a.map((x) => F.e(x)))));
const field = (buf) => BigInt("0x" + createHash("sha256").update(buf).digest("hex")) >> 8n;

// mirrors web/lib/prover.ts
const keyMessage = (v) =>
  `Stellar Vault — signer key v1\nVault: ${v}\n\nSigning this derives your private approval key. It never leaves this device.`;
function signerKey(kp, vault) {
  const base = field(kp.sign(Buffer.from(keyMessage(vault), "utf8")));
  return { secret: H([base]), blinding: H([base, 1n]) };
}
const secretFromSeed = (seed) => H([field(Buffer.from(seed, "utf8"))]);

async function buildTree(leaves) {
  const size = 1 << LEVELS;
  const padded = leaves.slice(0, size);
  while (padded.length < size) padded.push(padded[padded.length - 1] ?? 0n);
  const layers = [padded];
  let level = padded;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(H([level[i], level[i + 1]]));
    layers.push(next);
    level = next;
  }
  return { root: layers[LEVELS][0], layers };
}
function merklePath(layers, index) {
  const pathElements = [], pathIndices = [];
  let idx = index;
  for (let l = 0; l < LEVELS; l++) {
    pathElements.push(layers[l][idx % 2 === 0 ? idx + 1 : idx - 1]);
    pathIndices.push(idx % 2);
    idx = Math.floor(idx / 2);
  }
  return { pathElements, pathIndices };
}

const fieldTo32 = (dec) => Uint8Array.from(Buffer.from(BigInt(dec).toString(16).padStart(64, "0").slice(-64), "hex"));
function proofTo256(p) {
  const parts = [p.pi_a[0], p.pi_a[1], p.pi_b[0][1], p.pi_b[0][0], p.pi_b[1][1], p.pi_b[1][0], p.pi_c[0], p.pi_c[1]];
  const out = new Uint8Array(256);
  parts.forEach((x, i) => out.set(fieldTo32(x), i * 32));
  return out;
}

const u64 = (n) => nativeToScVal(BigInt(n), { type: "u64" });
const u256 = (n) => nativeToScVal(BigInt(n), { type: "u256" });
const addr = (a) => new Address(a).toScVal();
const entry = (k, v) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v });

async function send(kp, contractId, method, args) {
  const account = await server.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, { fee: "2000000", networkPassphrase: PASS })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(60)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(kp);
  const sent = await server.sendTransaction(prepared);
  let res = await server.getTransaction(sent.hash);
  for (let i = 0; i < 60 && res.status === "NOT_FOUND"; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    res = await server.getTransaction(sent.hash);
  }
  if (res.status !== "SUCCESS") throw new Error(`${method}: ${res.status}`);
  return { value: res.returnValue ? scValToNative(res.returnValue) : null, hash: sent.hash };
}
async function read(contractId, method, args = []) {
  const account = await server.getAccount(owner.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return sim.result?.retval ? scValToNative(sim.result.retval) : null;
}

// ---- publish the signer set using signature-derived commitments ----
const cfg = await read(VAULT, "get_config");
console.log(`vault   : ${VAULT}`);
console.log(`signers : ${cfg.signers.length}  (stranger ${stranger.publicKey().slice(0, 8)}… is NOT one)`);

const vaultId = secretFromSeed(VAULT);
const mine = signerKey(owner, VAULT);
const myCommit = H([mine.secret, vaultId, mine.blinding]);

// what an attacker could compute from the address alone, the old way
const guess = H([secretFromSeed(owner.publicKey()), vaultId, 1n]);
console.log(`\ncommitment from signature : ${myCommit.toString().slice(0, 24)}…`);
console.log(`guess from public address : ${guess.toString().slice(0, 24)}…`);
console.log(guess === myCommit ? "  MATCH — still broken" : "  no match — not derivable from public data");

const leaves = [myCommit];
const tree = await buildTree(leaves);
console.log("\n→ publishing signer set …");
await send(owner, VAULT, "set_signer_commitments", [xdr.ScVal.scvVec(leaves.map(u256))]);
await send(owner, VAULT, "set_zk_config", [addr(VERIFIER), u256(vaultId), u256(tree.root)]);

// ---- propose, then have the STRANGER submit the approval ----
console.log("→ propose …");
const { value: txId } = await send(owner, VAULT, "propose", [
  addr(owner.publicKey()), addr(owner.publicKey()), nativeToScVal(1000000n, { type: "i128" }), nativeToScVal(true),
]);
console.log(`proposal: #${txId}`);

const { pathElements, pathIndices } = merklePath(tree.layers, 0);
const nullifier = H([myCommit, BigInt(txId)]);
console.log("\n→ generating proof (as the signer, locally) …");
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  {
    vaultId: vaultId.toString(),
    txHash: BigInt(txId).toString(),
    signerRoot: tree.root.toString(),
    nullifier: nullifier.toString(),
    signerSecret: mine.secret.toString(),
    blinding: mine.blinding.toString(),
    pathElements: pathElements.map(String),
    pathIndices: pathIndices.map(String),
  },
  "build/voteApproval_js/voteApproval.wasm",
  "build/voteApproval_final.zkey"
);
console.log(`snarkjs verifies: ${await snarkjs.groth16.verify(
  JSON.parse(readFileSync("build/voteApproval_vk.json")), publicSignals, proof)}`);

const zkApproval = xdr.ScVal.scvMap([
  entry("nullifier", u256(publicSignals[3])),
  entry("proof", nativeToScVal(Buffer.from(proofTo256(proof)))),
  entry("public_inputs", xdr.ScVal.scvVec(publicSignals.map((s) => nativeToScVal(Buffer.from(fieldTo32(s)))))),
]);

console.log("\n→ STRANGER submits it (approve_zk_anon) …");
const { hash } = await send(stranger, VAULT, "approve_zk_anon", [u64(txId), zkApproval]);
const p = await read(VAULT, "get_proposal", [u64(txId)]);
console.log(`approvals now : ${p.approval_count}`);
console.log(`tx source     : ${stranger.publicKey()}`);
console.log(`               ^ this is who the ledger records — not the approver`);
if (Number(p.approval_count) !== 1) throw new Error("approval was not counted");

console.log("\nOK — a non-signer carried a valid approval, and the chain names only the carrier.");
process.exit(0);
