// End-to-end check of the thing that can only fail in production: a proof
// generated exactly the way the browser generates it, verified by the vault
// contract on a live network.
//
// Everything upstream of this already passes — the circuit has its own tests,
// the verifier has its own, the vault has its own with a mock. What none of
// them cover is whether the browser's byte layout agrees with the host's. It is
// the one seam where being wrong looks like "every valid proof is rejected".
//
// Usage: node e2e-onchain.mjs <vaultAddress> <verifierAddress>

import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";
import { readFileSync } from "fs";
import { createHash } from "crypto";
import {
  rpc, TransactionBuilder, BASE_FEE, Contract, Address, Keypair,
  nativeToScVal, scValToNative, xdr, Networks,
} from "@stellar/stellar-sdk";

const [VAULT, VERIFIER] = process.argv.slice(2);
if (!VAULT || !VERIFIER) throw new Error("usage: node e2e-onchain.mjs <vault> <verifier>");

const RPC = "https://soroban-testnet.stellar.org";
const PASS = Networks.TESTNET;
const SECRET = process.env.DEPLOYER_SECRET;
if (!SECRET) throw new Error("set DEPLOYER_SECRET");

const kp = Keypair.fromSecret(SECRET);
const server = new rpc.Server(RPC);

const LEVELS = 4;
const poseidon = await buildPoseidon();
const F = poseidon.F;
const H = (arr) => BigInt(F.toString(poseidon(arr.map((x) => F.e(x)))));

/** Mirrors web/lib/prover.ts secretFromSeed. */
function seedDigest(seed) {
  const d = createHash("sha256").update(seed, "utf8").digest("hex");
  return BigInt("0x" + d) >> 8n;
}
const secretFromSeed = async (seed) => H([seedDigest(seed)]);

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

/* ---- byte packing, identical to web/lib/contract.ts ---- */
const fieldTo32 = (dec) => {
  let h = BigInt(dec).toString(16).padStart(64, "0");
  return Uint8Array.from(Buffer.from(h.slice(-64), "hex"));
};
function proofTo256(proof) {
  const parts = [
    proof.pi_a[0], proof.pi_a[1],
    proof.pi_b[0][1], proof.pi_b[0][0], proof.pi_b[1][1], proof.pi_b[1][0], // c1 before c0
    proof.pi_c[0], proof.pi_c[1],
  ];
  const out = new Uint8Array(256);
  parts.forEach((p, i) => out.set(fieldTo32(p), i * 32));
  return out;
}

/* ---- chain plumbing ---- */
const u64 = (n) => nativeToScVal(BigInt(n), { type: "u64" });
const u256 = (n) => nativeToScVal(BigInt(n), { type: "u256" });
const addr = (a) => new Address(a).toScVal();
const entry = (k, v) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k), val: v });

async function send(contractId, method, args) {
  const account = await server.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, { fee: "1000000", networkPassphrase: PASS })
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
  if (res.status !== "SUCCESS") throw new Error(`${method} failed: ${res.status} ${JSON.stringify(res.resultXdr ?? "")}`);
  return res.returnValue ? scValToNative(res.returnValue) : null;
}

async function read(contractId, method, args = []) {
  const account = await server.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return sim.result?.retval ? scValToNative(sim.result.retval) : null;
}

/* ---- run ---- */
const me = kp.publicKey();
const cfg = await read(VAULT, "get_config");
const signers = cfg.signers;
console.log(`vault    : ${VAULT}`);
console.log(`signers  : ${signers.length}`);

// domain id + signer root, derived exactly as the frontend does
const vaultId = await secretFromSeed(VAULT);
const commitments = [];
for (let i = 0; i < signers.length; i++) {
  commitments.push(await H([await secretFromSeed(signers[i]), vaultId, BigInt(i + 1)]));
}
const tree = await buildTree(commitments);
console.log(`vaultId  : 0x${vaultId.toString(16).slice(0, 16)}…`);
console.log(`root     : 0x${tree.root.toString(16).slice(0, 16)}…`);

if (!(await read(VAULT, "get_zk_config"))) {
  console.log("\n→ set_zk_config …");
  await send(VAULT, "set_zk_config", [addr(VERIFIER), u256(vaultId), u256(tree.root)]);
}
console.log("zk config: enforced");

// a proposal to approve
console.log("\n→ propose …");
const txId = await send(VAULT, "propose", [
  addr(me), addr(me), nativeToScVal(1000000n, { type: "i128" }), nativeToScVal(true),
]);
console.log(`proposal : #${txId}`);

// the proof — txHash IS the proposal id, which the contract will check
const myIndex = signers.indexOf(me);
const { pathElements, pathIndices } = merklePath(tree.layers, myIndex);
const nullifier = await H([commitments[myIndex], BigInt(txId)]);

console.log("\n→ generating Groth16 proof …");
const t0 = Date.now();
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  {
    vaultId: vaultId.toString(),
    txHash: BigInt(txId).toString(),
    signerRoot: tree.root.toString(),
    nullifier: nullifier.toString(),
    signerSecret: (await secretFromSeed(signers[myIndex])).toString(),
    blinding: BigInt(myIndex + 1).toString(),
    pathElements: pathElements.map(String),
    pathIndices: pathIndices.map(String),
  },
  "build/voteApproval_js/voteApproval.wasm",
  "build/voteApproval_final.zkey"
);
console.log(`proof    : ${Date.now() - t0}ms, snarkjs says ${await snarkjs.groth16.verify(
  JSON.parse(readFileSync("build/voteApproval_vk.json")), publicSignals, proof)}`);

const zkApproval = xdr.ScVal.scvMap([
  entry("nullifier", u256(publicSignals[3])),
  entry("proof", nativeToScVal(Buffer.from(proofTo256(proof)))),
  entry("public_inputs", xdr.ScVal.scvVec(publicSignals.map((s) => nativeToScVal(Buffer.from(fieldTo32(s)))))),
]);

console.log("\n→ approve_zk (verified on-chain) …");
await send(VAULT, "approve_zk", [u64(txId), addr(me), zkApproval]);
const p = await read(VAULT, "get_proposal", [u64(txId)]);
console.log(`approvals: ${p.approval_count}`);
if (Number(p.approval_count) !== 1) throw new Error("approval was not counted");

// negative: the same proof aimed at a different proposal must be refused
console.log("\n→ replay the proof onto a different proposal (must fail) …");
const other = await send(VAULT, "propose", [
  addr(me), addr(me), nativeToScVal(1000000n, { type: "i128" }), nativeToScVal(true),
]);
try {
  await send(VAULT, "approve_zk", [u64(other), addr(me), zkApproval]);
  throw new Error("REPLAY SUCCEEDED — the txId binding is not working");
} catch (e) {
  if (String(e).includes("REPLAY SUCCEEDED")) throw e;
  console.log("   refused ✓");
}

console.log("\nEND-TO-END OK — the browser's proof verifies on-chain.");
process.exit(0);
