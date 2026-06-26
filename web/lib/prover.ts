// Browser-side ZK prover for voteApproval — real Groth16 over the deployed
// circuit. Generates an anonymous "a valid signer approved" proof whose
// nullifier prevents double-voting without revealing which signer.

const LEVELS = 4; // tree depth → up to 16 signers
const WASM = "/zk-wasm/voteApproval.wasm";
const ZKEY = "/zk-wasm/voteApproval_final.zkey";
const VK_URL = "/zk-wasm/voteApproval_vk.json";

let _poseidon: any = null;
async function poseidon() {
  if (!_poseidon) {
    const { buildPoseidon } = await import("circomlibjs");
    _poseidon = await buildPoseidon();
  }
  return _poseidon;
}

/** Poseidon hash of field elements → bigint. */
export async function H(inputs: (bigint | string | number)[]): Promise<bigint> {
  const p = await poseidon();
  return BigInt(p.F.toString(p(inputs.map((x) => p.F.e(x)))));
}

/** Deterministic field element from a string seed (e.g. a wallet signature). */
export async function secretFromSeed(seed: string): Promise<bigint> {
  const data = new TextEncoder().encode(seed);
  const digest = await crypto.subtle.digest("SHA-256", data);
  // reduce 256-bit digest into the field by hashing through Poseidon
  const hex = "0x" + Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return H([BigInt(hex) >> 8n]); // shift to stay < field prime, then domain-hash
}

export type Tree = { root: bigint; layers: bigint[][] };

/** Build a binary Poseidon Merkle tree from up to 16 leaves (pads with the last). */
export async function buildTree(leaves: bigint[]): Promise<Tree> {
  const size = 1 << LEVELS;
  const padded = leaves.slice(0, size);
  while (padded.length < size) padded.push(padded[padded.length - 1] ?? 0n);

  const layers: bigint[][] = [padded];
  let level = padded;
  while (level.length > 1) {
    const next: bigint[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(await H([level[i], level[i + 1]]));
    layers.push(next);
    level = next;
  }
  return { root: layers[LEVELS][0], layers };
}

function merklePath(layers: bigint[][], index: number) {
  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];
  let idx = index;
  for (let l = 0; l < LEVELS; l++) {
    const sib = idx % 2 === 0 ? idx + 1 : idx - 1;
    pathElements.push(layers[l][sib]);
    pathIndices.push(idx % 2);
    idx = Math.floor(idx / 2);
  }
  return { pathElements, pathIndices };
}

export type VoteProof = {
  proof: any;
  publicSignals: string[]; // [vaultId, txHash, signerRoot, nullifier]
  nullifier: bigint;
  root: bigint;
  ms: number;
};

/**
 * Generate a real anonymous-approval proof.
 * @param secrets   field-element secrets for ALL signers (so we can build the tree)
 * @param myIndex   which signer is proving (their secret is private)
 */
export async function generateVoteProof(params: {
  vaultId: bigint;
  txHash: bigint;
  secrets: bigint[];
  blindings: bigint[];
  myIndex: number;
}): Promise<VoteProof> {
  const snarkjs: any = await import("snarkjs");
  const { vaultId, txHash, secrets, blindings, myIndex } = params;

  const commitments: bigint[] = [];
  for (let i = 0; i < secrets.length; i++) {
    commitments.push(await H([secrets[i], vaultId, blindings[i]]));
  }
  const tree = await buildTree(commitments);
  const { pathElements, pathIndices } = merklePath(tree.layers, myIndex);

  const myCommit = commitments[myIndex];
  const nullifier = await H([myCommit, txHash]);

  const input = {
    vaultId: vaultId.toString(),
    txHash: txHash.toString(),
    signerRoot: tree.root.toString(),
    nullifier: nullifier.toString(),
    signerSecret: secrets[myIndex].toString(),
    blinding: blindings[myIndex].toString(),
    pathElements: pathElements.map((x) => x.toString()),
    pathIndices: pathIndices.map((x) => x.toString()),
  };

  const t0 = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  return { proof, publicSignals, nullifier, root: tree.root, ms: Date.now() - t0 };
}

/** Verify a proof in-browser with the embedded verification key (real Groth16). */
export async function verifyVoteProof(publicSignals: string[], proof: any): Promise<boolean> {
  const snarkjs: any = await import("snarkjs");
  const vk = await fetch(VK_URL).then((r) => r.json());
  return snarkjs.groth16.verify(vk, publicSignals, proof);
}
