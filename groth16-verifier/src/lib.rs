#![no_std]

//! Groth16 verifier for `voteApproval.circom`, on BN254.
//!
//! Deliberately narrow: this contract does cryptography and nothing else. It
//! holds no funds, has no admin, and its verification key is compiled in — see
//! [`vk`]. Policy and state transitions live in `vault-instance`, which calls
//! `verify` and decides what a `true` means. Keeping the two apart is what lets
//! the vault be upgraded without touching audited crypto, and vice versa.
//!
//! # The check
//!
//! Groth16 verification is the pairing equation
//!
//! ```text
//! e(A, B) == e(alpha, beta) * e(vk_x, gamma) * e(C, delta)
//! ```
//!
//! where `vk_x = IC[0] + sum(public_i * IC[i])`. Moving everything to one side
//! turns it into a single multi-pairing against the identity, which is what the
//! host exposes:
//!
//! ```text
//! e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
//! ```
//!
//! So the whole verification is one `g1_msm` (folding the public inputs) plus
//! one `pairing_check`.
//!
//! # Requires
//!
//! BN254 host functions — CAP-0074 (protocol 21+... see below) and CAP-0080.
//! Verified working on testnet at protocol 27; see `spike/bn254-probe`.

use soroban_sdk::{
    contract, contracterror, contractimpl,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    vec, BytesN, Env, Vec, U256,
};

mod vk;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// The number of public inputs did not match the circuit's.
    WrongPublicInputCount = 1,
}

/// A Groth16 proof in the affine encoding snarkjs produces.
///
/// `a` is the raw `pi_a`; this contract negates it internally rather than
/// trusting a caller-supplied negation, so a caller cannot smuggle in a
/// different point.
#[soroban_sdk::contracttype]
#[derive(Clone)]
pub struct Proof {
    /// G1: be(x) || be(y)
    pub a: BytesN<64>,
    /// G2: be(x_c1) || be(x_c0) || be(y_c1) || be(y_c0)
    pub b: BytesN<128>,
    /// G1: be(x) || be(y)
    pub c: BytesN<64>,
}

#[contract]
pub struct Groth16Verifier;

#[contractimpl]
impl Groth16Verifier {
    /// `true` iff `proof` is a valid proof for `public_inputs` under the
    /// compiled-in verification key.
    ///
    /// `public_inputs` are field elements in circuit order:
    /// `[vaultId, txHash, signerRoot, nullifier]`.
    ///
    /// Malformed points make the host trap rather than return `false` — an
    /// invalid encoding is a caller bug, not a failed proof, and the two should
    /// not be indistinguishable.
    pub fn verify(env: Env, proof: Proof, public_inputs: Vec<U256>) -> Result<bool, Error> {
        if public_inputs.len() as usize != vk::N_PUBLIC {
            return Err(Error::WrongPublicInputCount);
        }
        let bn = env.crypto().bn254();

        // vk_x = IC[0] + sum(public_i * IC[i]), as one MSM.
        // IC[0] is included with scalar 1 so the whole fold is a single call.
        let mut points = vec![&env, g1(&env, &vk::IC[0])];
        let mut scalars = vec![&env, Bn254Fr::from_u256(U256::from_u32(&env, 1))];
        for (i, input) in public_inputs.iter().enumerate() {
            points.push_back(g1(&env, &vk::IC[i + 1]));
            scalars.push_back(Bn254Fr::from_u256(input));
        }
        let vk_x = bn.g1_msm(points, scalars);

        // e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
        let neg_a = neg_g1(&env, &proof.a);
        let g1s = vec![
            &env,
            neg_a,
            g1(&env, &vk::ALPHA_1),
            vk_x,
            Bn254G1Affine::from_bytes(proof.c),
        ];
        let g2s = vec![
            &env,
            Bn254G2Affine::from_bytes(proof.b),
            g2(&env, &vk::BETA_2),
            g2(&env, &vk::GAMMA_2),
            g2(&env, &vk::DELTA_2),
        ];
        Ok(bn.pairing_check(g1s, g2s))
    }

    /// Public inputs this verifier's circuit expects. Lets a caller fail fast
    /// instead of discovering the mismatch inside `verify`.
    pub fn n_public(_env: Env) -> u32 {
        vk::N_PUBLIC as u32
    }
}

fn g1(env: &Env, raw: &[u8; 64]) -> Bn254G1Affine {
    Bn254G1Affine::from_bytes(BytesN::from_array(env, raw))
}

fn g2(env: &Env, raw: &[u8; 128]) -> Bn254G2Affine {
    Bn254G2Affine::from_bytes(BytesN::from_array(env, raw))
}

/// -P = (x, p - y) over the BN254 base field. Computed here rather than
/// accepted from the caller.
fn neg_g1(env: &Env, p: &BytesN<64>) -> Bn254G1Affine {
    let raw = p.to_array();
    let mut x = [0u8; 32];
    let mut y = [0u8; 32];
    x.copy_from_slice(&raw[..32]);
    y.copy_from_slice(&raw[32..]);

    let field = U256::from_be_bytes(env, &soroban_sdk::Bytes::from_array(env, &BASE_FIELD));
    let yv = U256::from_be_bytes(env, &soroban_sdk::Bytes::from_array(env, &y));
    let zero = U256::from_u32(env, 0);
    // -0 is 0: the point at infinity must stay encoded as y = 0.
    let neg_y = if yv == zero { zero } else { field.sub(&yv) };

    let mut out = [0u8; 64];
    out[..32].copy_from_slice(&x);
    let nb = neg_y.to_be_bytes();
    // U256::to_be_bytes is already 32 bytes wide.
    let mut i = 0usize;
    while i < 32 {
        out[32 + i] = nb.get(i as u32).unwrap();
        i += 1;
    }
    Bn254G1Affine::from_bytes(BytesN::from_array(env, &out))
}

/// BN254 base field modulus p.
const BASE_FIELD: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d, 0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
];

#[cfg(test)]
mod test;
