// Emits the voteApproval verification key, plus one real proof and its public
// signals, in the exact byte layout the Soroban BN254 host functions expect.
//
// Serialization (Ethereum-compatible, per soroban-sdk's Bn254G2Affine docs):
//   G1  = be32(x) || be32(y)                                    (64 bytes)
//   G2  = be32(x_c1) || be32(x_c0) || be32(y_c1) || be32(y_c0)  (128 bytes)
//   Fr  = be32(scalar)                                          (32 bytes)
//
// snarkjs stores G2 coordinates as [c0, c1] — real part first — so each pair is
// reversed here. Getting that backwards is the single most likely way to build
// a verifier that rejects every valid proof, which is why this file exists
// rather than the conversion being inlined in Rust.

import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";
import { readFileSync, writeFileSync } from "fs";

const LEVELS = 4;
const WASM = "build/voteApproval_js/voteApproval.wasm";
const ZKEY = "build/voteApproval_final.zkey";
const VK = JSON.parse(readFileSync("build/voteApproval_vk.json"));

// BN254 base field modulus — needed to negate a G1 point.
const P = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

const be32 = (v) => BigInt(v).toString(16).padStart(64, "0");
const g1 = ([x, y]) => be32(x) + be32(y);
const g1neg = ([x, y]) => be32(x) + be32((P - (BigInt(y) % P)) % P);
const g2 = ([[x0, x1], [y0, y1]]) => be32(x1) + be32(x0) + be32(y1) + be32(y0);

const poseidon = await buildPoseidon();
const F = poseidon.F;
const H = (arr) => BigInt(F.toString(poseidon(arr.map((x) => F.e(x)))));

const rand = () => {
  let h = "";
  for (let i = 0; i < 62; i++) h += Math.floor(Math.random() * 16).toString(16);
  return BigInt("0x" + h);
};

function buildTree(leaves) {
  let level = leaves.slice();
  const layers = [level];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(H([level[i], level[i + 1]]));
    level = next;
    layers.push(level);
  }
  return layers;
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

// --- one real proof, same shape the browser prover produces ---
const vaultId = 7n;
const txHash = H([123456789n, vaultId]);
const myIndex = 5;
const signerSecret = rand();
const blinding = rand();
const myCommit = H([signerSecret, vaultId, blinding]);

const leaves = [];
for (let i = 0; i < 16; i++) leaves.push(i === myIndex ? myCommit : rand());
const layers = buildTree(leaves);
const root = layers[LEVELS][0];
const { pathElements, pathIndices } = merklePath(layers, myIndex);
const nullifier = H([myCommit, txHash]);

const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  {
    vaultId: vaultId.toString(),
    txHash: txHash.toString(),
    signerRoot: root.toString(),
    nullifier: nullifier.toString(),
    signerSecret: signerSecret.toString(),
    blinding: blinding.toString(),
    pathElements: pathElements.map(String),
    pathIndices: pathIndices.map(String),
  },
  WASM,
  ZKEY
);

if (!(await snarkjs.groth16.verify(VK, publicSignals, proof))) {
  throw new Error("snarkjs rejected its own proof — refusing to emit fixtures");
}

const out = {
  note: "byte layout: G1 = x||y, G2 = x_c1||x_c0||y_c1||y_c0, all big-endian 32-byte limbs",
  vk: {
    alpha_1: g1(VK.vk_alpha_1),
    beta_2: g2(VK.vk_beta_2),
    gamma_2: g2(VK.vk_gamma_2),
    delta_2: g2(VK.vk_delta_2),
    ic: VK.IC.map(g1),
  },
  proof: {
    a: g1(proof.pi_a),
    a_neg: g1neg(proof.pi_a), // the verifier pairs -A with B
    b: g2(proof.pi_b),
    c: g1(proof.pi_c),
  },
  publicSignals: publicSignals.map((s) => be32(s)),
  publicSignalsDecimal: publicSignals,
};

writeFileSync("build/groth16_fixture.json", JSON.stringify(out, null, 2));
console.log("nPublic       :", VK.nPublic, "| IC points:", VK.IC.length);
console.log("proof.a       :", out.proof.a.slice(0, 32) + "…");
console.log("proof.b       :", out.proof.b.slice(0, 32) + "…");
console.log("public signals:", publicSignals.map((s) => s.slice(0, 12) + "…").join(" "));
console.log("\nwrote build/groth16_fixture.json");
process.exit(0);
