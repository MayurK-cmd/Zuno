//! Phase 1 verifier stub.
//!
//! A real ZK verifier would call the Soroban host's BN254 pairing
//! check to verify a Groth16 proof. Stellar Protocol 25 added the
//! required host functions, but the Soroban SDK 22 surface does not
//! yet expose them. Until Phase 2 (or until someone ports the Aztec
//! UltraPlonk → Soroban verifier), we deploy this stub so the Zuno
//! contract has a valid verifier address to store in `GameRoom`.
//!
//! Behaviour: `verify` accepts any proof and returns `Ok(())`. The
//! matching empty-signature check in `play_card` / `draw_card`
//! (in `programs/zuno/src/instructions/{play_card,draw_card}.rs`)
//! already gates "empty sig = reject" — so for Phase 1 the stub
//! just needs to be live on chain.

#![no_std]

use soroban_sdk::{contract, contractimpl, Bytes, Env, Vec};

#[contract]
pub struct VerifierStub;

#[contractimpl]
impl VerifierStub {
    /// Accept any proof. Phase 2 will replace this body with the real
    /// BN254 pairing call.
    pub fn verify(_env: Env, _proof: Bytes, _public_inputs: Vec<soroban_sdk::Val>) -> bool {
        true
    }
}