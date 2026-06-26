#![no_std]

mod types;
mod vault;

#[cfg(test)]
mod test;

pub use vault::VaultContract;
