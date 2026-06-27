pragma circom 2.1.6;

include "poseidon.circom";
include "merkle.circom";

/*
 * confidentialTransfer.circom — shielded-pool withdraw / confidential transfer.
 *
 * A "note" deposited into the pool is committed as:
 *     commitment = Poseidon(amount, secret, blinding)
 * and inserted into the pool's Merkle tree.
 *
 * To withdraw / send confidentially, the owner proves — WITHOUT revealing
 * which note — that:
 *   1. they know a note whose commitment is in the tree (membership),
 *   2. the published nullifierHash is the unique one-way tag of that note
 *      (so it can't be spent twice, but the note can't be identified),
 *   3. the proof is bound to this exact recipient + amount.
 *
 * On-chain only the nullifierHash + recipient + amount appear — never a link
 * back to which deposit funded it. The deposit↔withdraw link is severed.
 *
 * Public  : root, nullifierHash, recipient, amount
 * Private : secret, blinding, pathElements[], pathIndices[]
 */
template ConfidentialTransfer(levels) {
    // public
    signal input root;
    signal input nullifierHash;
    signal input recipient;
    signal input amount;

    // private
    signal input secret;
    signal input blinding;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // commitment = Poseidon(amount, secret, blinding)
    component commit = Poseidon(3);
    commit.inputs[0] <== amount;
    commit.inputs[1] <== secret;
    commit.inputs[2] <== blinding;

    // membership: the note's commitment is in the pool tree
    component mt = MerkleTreeChecker(levels);
    mt.leaf <== commit.out;
    mt.root <== root;
    for (var i = 0; i < levels; i++) {
        mt.pathElements[i] <== pathElements[i];
        mt.pathIndices[i] <== pathIndices[i];
    }

    // nullifierHash = Poseidon(secret, blinding) — unique, one-way, unlinkable
    component nh = Poseidon(2);
    nh.inputs[0] <== secret;
    nh.inputs[1] <== blinding;
    nullifierHash === nh.out;

    // bind recipient into the statement so the proof can't be replayed to a
    // different recipient (amount is already bound via the commitment).
    signal recipientSquared;
    recipientSquared <== recipient * recipient;
}

component main { public [root, nullifierHash, recipient, amount] } = ConfidentialTransfer(4);
