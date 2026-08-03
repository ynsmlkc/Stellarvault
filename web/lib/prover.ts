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

/**
 * The message a signer signs to derive their signing key for a vault.
 *
 * Ed25519 signatures are deterministic (RFC 8032): the same key over the same
 * message always yields the same signature, so a signer can regenerate their
 * secret whenever they need it and never has to store it anywhere.
 */
export const keyMessage = (vaultAddress: string) =>
  `Stellar Vault — signer key v1\nVault: ${vaultAddress}\n\nSigning this derives your private approval key. It never leaves this device.`;

/**
 * A signer's secret and blinding for a vault, derived from a wallet signature.
 *
 * This is the part that must be unguessable. Deriving it from the signer's
 * ADDRESS — as this code used to — makes the commitment public knowledge, and
 * then anyone can compute `Poseidon(commitment, txId)` for each signer and
 * match it against the nullifier an approval published. With three signers
 * that is three guesses to identify the approver, and the anonymity is worth
 * nothing. A signature can only be produced by the key holder, so the
 * commitment becomes unguessable and the dictionary disappears.
 */
export async function signerKey(vaultAddress: string): Promise<{ secret: bigint; blinding: bigint }> {
  const freighter = await import("@stellar/freighter-api");
  const res: any = await freighter.signMessage(keyMessage(vaultAddress));
  if (res?.error) throw new Error(String(res.error));

  const sig: unknown = res?.signedMessage ?? res;
  const bytes =
    typeof sig === "string"
      ? new TextEncoder().encode(sig)
      : sig instanceof Uint8Array
        ? sig
        : new Uint8Array(Object.values(sig as Record<string, number>));

  const buf = new Uint8Array(bytes).slice().buffer;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const hex = "0x" + Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const base = BigInt(hex) >> 8n; // keep it inside the field
  return { secret: await H([base]), blinding: await H([base, 1n]) };
}

/** Deterministic field element from a string seed. */
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

/**
 * This signer's leaf in the vault's Merkle tree.
 *
 * Only the key holder can compute it, because only they can produce the
 * signature it is derived from. They hand the result to the owner, who
 * assembles everyone's and publishes them shuffled.
 */
export async function myCommitment(vaultAddress: string, vaultId: bigint): Promise<bigint> {
  const { secret, blinding } = await signerKey(vaultAddress);
  return H([secret, vaultId, blinding]);
}

/** The Merkle root of a published (shuffled) commitment list. */
export async function rootOf(commitments: bigint[]): Promise<bigint> {
  return (await buildTree(commitments)).root;
}

export type VoteProof = {
  proof: any;
  publicSignals: string[]; // [vaultId, txId, signerRoot, nullifier]
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
  /**
   * The proposal id, as a field element. It is a *public input the prover
   * chooses*, and the nullifier is derived from it — so the vault checks it
   * against the proposal actually being approved. Passing anything else here
   * produces a proof the contract will refuse.
   */
  txHash: bigint;
  /** The published leaves, in the shuffled order the owner posted them. */
  commitments: bigint[];
  /** This signer's own key material — nobody else's is knowable. */
  secret: bigint;
  blinding: bigint;
}): Promise<VoteProof> {
  const snarkjs: any = await import("snarkjs");
  const { vaultId, txHash, commitments, secret, blinding } = params;

  const myCommit = await H([secret, vaultId, blinding]);
  const myIndex = commitments.findIndex((c) => c === myCommit);
  if (myIndex < 0) {
    throw new Error(
      "Your signing key isn't in this vault's published signer set — register it, and ask the owner to publish."
    );
  }

  const tree = await buildTree(commitments);
  const { pathElements, pathIndices } = merklePath(tree.layers, myIndex);
  const nullifier = await H([myCommit, txHash]);

  const input = {
    vaultId: vaultId.toString(),
    txHash: txHash.toString(),
    signerRoot: tree.root.toString(),
    nullifier: nullifier.toString(),
    signerSecret: secret.toString(),
    blinding: blinding.toString(),
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
