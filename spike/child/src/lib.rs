#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Env, Symbol};

const LABEL: Symbol = symbol_short!("label");

#[contract]
pub struct Child;

#[contractimpl]
impl Child {
    /// Constructor — runs once at deploy with args from the factory.
    pub fn __constructor(env: Env, label: u32) {
        env.storage().instance().set(&LABEL, &label);
    }

    pub fn get_label(env: Env) -> u32 {
        env.storage().instance().get(&LABEL).unwrap_or(0)
    }
}
