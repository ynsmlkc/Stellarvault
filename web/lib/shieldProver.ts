// Browser prover for the shield pool — real Groth16 over confidentialTransfer.
// Generates an unlinkable confidential-withdraw proof for a deposited note.

const LEVELS = 4; // up to 16 notes per pool
const WASM = "/zk-wasm/confidentialTransfer.wasm";
const ZKEY = "/zk-wasm/confidentialTransfer_final.zkey";
const VK_URL = "/zk-wasm/confidentialTransfer_vk.json";

let _poseidon: any = null;
async function poseidon() {
  if (!_poseidon) {
    const { buildPoseidon } = await import("circomlibjs");
    _poseidon = await buildPoseidon();
  }
  return _poseidon;
}
async function H(inputs: (bigint | string | number)[]): Promise<bigint> {
  const p = await poseidon();
  return BigInt(p.F.toString(p(inputs.map((x) => p.F.e(x)))));
}

function randField(): bigint {
  const b = new Uint8Array(31);
  crypto.getRandomValues(b);
  return BigInt("0x" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join(""));
}

export type Note = { amount: string; secret: string; blinding: string; commitment: string };

/** Create a fresh note for `amountStroops` and its commitment. */
export async function newNote(amountStroops: bigint): Promise<Note> {
  const secret = randField();
  const blinding = randField();
  const commitment = await H([amountStroops, secret, blinding]);
  return {
    amount: amountStroops.toString(),
    secret: secret.toString(),
    blinding: blinding.toString(),
    commitment: commitment.toString(),
  };
}

/** Deterministic field element from a Stellar address (binds the proof). */
export async function recipientField(address: string): Promise<bigint> {
  const data = new TextEncoder().encode(address);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = "0x" + Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return (BigInt(hex) >> 8n); // keep < field prime
}

async function buildTree(leaves: bigint[]) {
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

export type WithdrawProof = {
  proof: any;
  publicSignals: string[]; // [root, nullifierHash, recipient, amount]
  nullifierHash: bigint;
  root: bigint;
  ms: number;
};

/**
 * Prove a confidential withdraw of `note` to `recipientAddr`.
 * `commitments` are ALL on-chain pool commitments (to rebuild the tree).
 */
export async function generateWithdrawProof(params: {
  note: Note;
  commitments: bigint[];
  recipientAddr: string;
}): Promise<WithdrawProof> {
  const snarkjs: any = await import("snarkjs");
  const { note, commitments, recipientAddr } = params;

  const myCommit = BigInt(note.commitment);
  const myIndex = commitments.findIndex((c) => c === myCommit);
  if (myIndex < 0) throw new Error("Note commitment not found in the pool");

  const tree = await buildTree(commitments);
  const { pathElements, pathIndices } = merklePath(tree.layers, myIndex);
  const nullifierHash = await H([BigInt(note.secret), BigInt(note.blinding)]);
  const recipient = await recipientField(recipientAddr);

  const input = {
    root: tree.root.toString(),
    nullifierHash: nullifierHash.toString(),
    recipient: recipient.toString(),
    amount: note.amount,
    secret: note.secret,
    blinding: note.blinding,
    pathElements: pathElements.map((x) => x.toString()),
    pathIndices: pathIndices.map((x) => x.toString()),
  };

  const t0 = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  return { proof, publicSignals, nullifierHash, root: tree.root, ms: Date.now() - t0 };
}

export async function verifyWithdrawProof(publicSignals: string[], proof: any): Promise<boolean> {
  const snarkjs: any = await import("snarkjs");
  const vk = await fetch(VK_URL).then((r) => r.json());
  return snarkjs.groth16.verify(vk, publicSignals, proof);
}

/* ---- local note storage (per wallet) ---- */
const noteKey = (wallet: string) => `sv_notes_${wallet}`;

export function loadNotes(wallet: string): (Note & { spent?: boolean })[] {
  try {
    return JSON.parse(localStorage.getItem(noteKey(wallet)) || "[]");
  } catch {
    return [];
  }
}
export function saveNote(wallet: string, note: Note) {
  const notes = loadNotes(wallet);
  notes.push(note);
  localStorage.setItem(noteKey(wallet), JSON.stringify(notes));
}
export function markNoteSpent(wallet: string, commitment: string) {
  const notes = loadNotes(wallet).map((n) => (n.commitment === commitment ? { ...n, spent: true } : n));
  localStorage.setItem(noteKey(wallet), JSON.stringify(notes));
}
