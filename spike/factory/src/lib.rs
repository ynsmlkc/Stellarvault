#![no_std]
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, IntoVal, Val, Vec};

#[contract]
pub struct Factory;

#[contractimpl]
impl Factory {
    /// Deploy a child contract from `wasm_hash`, passing `label` to its constructor.
    /// Returns the new child's address — this is the API the real factory will use.
    pub fn deploy_child(env: Env, wasm_hash: BytesN<32>, salt: BytesN<32>, label: u32) -> Address {
        let args: Vec<Val> = (label,).into_val(&env);
        env.deployer()
            .with_current_contract(salt)
            .deploy_v2(wasm_hash, args)
    }
}
