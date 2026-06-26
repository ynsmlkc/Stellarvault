pragma circom 2.1.6;

include "poseidon.circom";

// Swaps the two inputs iff s == 1 (s is constrained boolean).
template DualMux() {
    signal input in[2];
    signal input s;
    signal output out[2];
    s * (1 - s) === 0;
    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

// Poseidon hash of an ordered pair (left, right).
template HashLeftRight() {
    signal input left;
    signal input right;
    signal output hash;
    component h = Poseidon(2);
    h.inputs[0] <== left;
    h.inputs[1] <== right;
    hash <== h.out;
}

// Verifies that `leaf` is a member of the tree with the given `root`,
// using a binary Merkle path. pathIndices[i] = 0 → sibling on the right.
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    component selectors[levels];
    component hashers[levels];

    signal levelHashes[levels + 1];
    levelHashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        selectors[i] = DualMux();
        selectors[i].in[0] <== levelHashes[i];
        selectors[i].in[1] <== pathElements[i];
        selectors[i].s <== pathIndices[i];

        hashers[i] = HashLeftRight();
        hashers[i].left <== selectors[i].out[0];
        hashers[i].right <== selectors[i].out[1];

        levelHashes[i + 1] <== hashers[i].hash;
    }

    root === levelHashes[levels];
}
