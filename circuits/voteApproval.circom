pragma circom 2.1.6;

include "poseidon.circom";
include "merkle.circom";

/*
 * voteApproval.circom — anonymous signer approval.
 *
 * Proves, without revealing WHICH signer:
 *   1. "I know a secret whose commitment is in this vault's signer Merkle tree"
 *      (membership → I am a valid signer)
 *   2. The vote is bound to this specific (vaultId, txHash)
 *   3. The published nullifier is the unique tag for (this signer, this tx)
 *      → double-vote is detectable, identity is NOT recoverable.
 *
 * Public  : vaultId, txHash, signerRoot, nullifier
 * Private : signerSecret, blinding, pathElements[], pathIndices[]
 */
template VoteApproval(levels) {
    // public
    signal input vaultId;
    signal input txHash;
    signal input signerRoot;
    signal input nullifier;

    // private
    signal input signerSecret;
    signal input blinding;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // commitment = Poseidon(signerSecret, vaultId, blinding) — the signer's leaf
    component commit = Poseidon(3);
    commit.inputs[0] <== signerSecret;
    commit.inputs[1] <== vaultId;
    commit.inputs[2] <== blinding;

    // membership: commitment is in the signer tree rooted at signerRoot
    component mt = MerkleTreeChecker(levels);
    mt.leaf <== commit.out;
    mt.root <== signerRoot;
    for (var i = 0; i < levels; i++) {
        mt.pathElements[i] <== pathElements[i];
        mt.pathIndices[i] <== pathIndices[i];
    }

    // nullifier = Poseidon(commitment, txHash) — unique per (signer, tx), one-way
    component nh = Poseidon(2);
    nh.inputs[0] <== commit.out;
    nh.inputs[1] <== txHash;
    nullifier === nh.out;
}

component main { public [vaultId, txHash, signerRoot, nullifier] } = VoteApproval(4);
