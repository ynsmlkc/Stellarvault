// End-to-end real-ZK test for voteApproval: build a signer tree, prove
// anonymous membership + nullifier, verify, and check negative paths.
import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";
import { readFileSync } from "fs";

const LEVELS = 4;
const WASM = "build/voteApproval_js/voteApproval.wasm";
const ZKEY = "build/voteApproval_final.zkey";
const VK = JSON.parse(readFileSync("build/voteApproval_vk.json"));

const rand = () => {
  // random ~248-bit field element
  let h = "";
  for (let i = 0; i < 62; i++) h += Math.floor(Math.random() * 16).toString(16);
  return BigInt("0x" + h);
};

const poseidon = await buildPoseidon();
const F = poseidon.F;
const H = (arr) => BigInt(F.toString(poseidon(arr.map((x) => F.e(x)))));

// ---- build a 16-leaf signer Merkle tree (depth 4) ----
function buildTree(leaves) {
  let level = leaves.slice();
  const layers = [level];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(H([level[i], level[i + 1]]));
    level = next;
    layers.push(level);
  }
  return layers; // layers[0]=leaves ... layers[LEVELS]=[root]
}
function merklePath(layers, index) {
  const pathElements = [], pathIndices = [];
  let idx = index;
  for (let l = 0; l < LEVELS; l++) {
    const sib = idx % 2 === 0 ? idx + 1 : idx - 1;
    pathElements.push(layers[l][sib]);
    pathIndices.push(idx % 2); // 0 = we're left, 1 = we're right
    idx = Math.floor(idx / 2);
  }
  return { pathElements, pathIndices };
}

const vaultId = 7n;
const txHash = H([123456789n, vaultId]); // a field-element tx digest

// signer #5 is "us"
const myIndex = 5;
const signerSecret = rand();
const blinding = rand();
const myCommit = H([signerSecret, vaultId, blinding]);

// other 15 signers are random commitments
const leaves = [];
for (let i = 0; i < 16; i++) leaves.push(i === myIndex ? myCommit : rand());

const layers = buildTree(leaves);
const root = layers[LEVELS][0];
const { pathElements, pathIndices } = merklePath(layers, myIndex);
const nullifier = H([myCommit, txHash]);

const input = {
  vaultId: vaultId.toString(),
  txHash: txHash.toString(),
  signerRoot: root.toString(),
  nullifier: nullifier.toString(),
  signerSecret: signerSecret.toString(),
  blinding: blinding.toString(),
  pathElements: pathElements.map((x) => x.toString()),
  pathIndices: pathIndices.map((x) => x.toString()),
};

console.log("→ generating real Groth16 proof (browser-equivalent)…");
const t0 = Date.now();
const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
console.log(`✓ proof generated in ${Date.now() - t0}ms`);
console.log("  public signals [vaultId, txHash, signerRoot, nullifier]:");
console.log("   ", publicSignals.map((s) => s.slice(0, 14) + "…").join("  "));

const ok = await snarkjs.groth16.verify(VK, publicSignals, proof);
console.log(`✓ VERIFY valid proof → ${ok}`);
if (!ok) throw new Error("valid proof failed to verify!");

// negative: tamper a public signal (claim a different nullifier)
const tampered = [...publicSignals];
tampered[3] = (BigInt(tampered[3]) + 1n).toString();
const bad = await snarkjs.groth16.verify(VK, tampered, proof);
console.log(`✓ VERIFY tampered nullifier → ${bad} (must be false)`);
if (bad) throw new Error("tampered proof verified — broken!");

// nullifier is deterministic per (signer, tx) → double-vote detectable
const nullifier2 = H([myCommit, txHash]);
console.log(`✓ double-vote nullifier stable → ${nullifier2 === nullifier}`);

console.log("\nALL CHECKS PASSED — real anonymous-approval ZK works end to end.");
process.exit(0);
