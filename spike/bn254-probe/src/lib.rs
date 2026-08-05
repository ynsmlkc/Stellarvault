#![no_std]

//! Throwaway probe: are the BN254 host functions (CAP-0074 / CAP-0080) actually
//! callable on the live network, at the cost of a real invocation?
//!
//! This exists to de-risk the on-chain Groth16 verifier before any of it is
//! written. A Groth16 check is ultimately one multi-pairing plus a G1 MSM over
//! the public inputs, so if `pairing_check`, `g1_mul` and `g1_msm` execute here,
//! the verifier is a matter of wiring, not of protocol support.
//!
//! Poseidon is deliberately NOT probed: it is used *inside* the circuit, never
//! on-chain, for verification. (And `poseidon_permutation` takes the MDS matrix
//! and round constants as arguments, so matching circomlib would mean shipping
//! its exact parameters — a separate question, only relevant if we ever want to
//! recompute the signer Merkle root on-chain.)

use soroban_sdk::{
    contract, contractimpl,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    vec, Bytes, BytesN, Env, U256, Vec,
};

/// BN254 G1 generator in affine form: x = 1, y = 2, each big-endian 32 bytes.
fn g1_generator(env: &Env) -> Bn254G1Affine {
    let mut b = [0u8; 64];
    b[31] = 1; // x = 1
    b[63] = 2; // y = 2
    Bn254G1Affine::from_bytes(BytesN::from_array(env, &b))
}

#[contract]
pub struct Bn254Probe;

#[contractimpl]
impl Bn254Probe {
    /// The empty product is 1, so an empty multi-pairing must report true.
    /// Cheapest possible proof that the host function exists and runs.
    pub fn pairing_empty(env: Env) -> bool {
        env.crypto()
            .bn254()
            .pairing_check(Vec::<Bn254G1Affine>::new(&env), Vec::<Bn254G2Affine>::new(&env))
    }

    /// 2·G computed on-chain. Returns the serialized point so the caller can
    /// compare it against the known answer computed off-chain.
    pub fn g1_double(env: Env) -> Bytes {
        let g = g1_generator(&env);
        let two = Bn254Fr::from_u256(U256::from_u32(&env, 2));
        let p = env.crypto().bn254().g1_mul(&g, &two);
        p.to_bytes().into()
    }

    /// A multi-scalar multiplication over two points — the shape a Groth16
    /// verifier uses to fold public inputs into the vk's IC vector.
    pub fn msm_smoke(env: Env) -> Bytes {
        let g = g1_generator(&env);
        let points = vec![&env, g.clone(), g];
        let scalars = vec![
            &env,
            Bn254Fr::from_u256(U256::from_u32(&env, 3)),
            Bn254Fr::from_u256(U256::from_u32(&env, 4)),
        ];
        let p = env.crypto().bn254().g1_msm(points, scalars);
        p.to_bytes().into()
    }

    /// e(P, Q)·e(-P, Q) == 1 — a real, non-trivial multi-pairing that must come
    /// back true. This is the exact shape of a Groth16 verification equation,
    /// so a `true` here means the verifier is wiring work, not research.
    /// `p`, `neg_p` and `q` are supplied by the caller so the probe carries no
    /// hardcoded G2 encoding assumptions.
    pub fn pairing_inverse(env: Env, p: BytesN<64>, neg_p: BytesN<64>, q: BytesN<128>) -> bool {
        let bn = env.crypto().bn254();
        let q = Bn254G2Affine::from_bytes(q);
        bn.pairing_check(
            vec![&env, Bn254G1Affine::from_bytes(p), Bn254G1Affine::from_bytes(neg_p)],
            vec![&env, q.clone(), q],
        )
    }
}
