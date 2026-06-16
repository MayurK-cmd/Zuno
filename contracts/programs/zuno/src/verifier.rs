use soroban_sdk::Bytes;
use crate::error::ZunoError;

/// Simple wrapper around the on‑chain BN254 verifier contract.
/// In Phase 2 this will forward the proof and public inputs to the
/// verifier contract; for now it is a placeholder that always succeeds.
pub struct VerifierClient;

impl VerifierClient {
    /// Construct a new client that points at a deployed verifier contract.
    pub fn new(_env: &soroban_sdk::Env, _verifier_contract: &Bytes) -> Self {
        Self
    }

    /// Verify the given proof against the public inputs.
    /// Currently a no‑op – always returns `Ok(())`. In Phase 2 this will
    /// invoke the verifier contract and return an error on failure.
    pub fn try_verify(
        &self,
        _proof: &Bytes,
        _public_inputs: &[soroban_sdk::Val],
    ) -> Result<(), ZunoError> {
        // Placeholder – always succeed.
        Ok(())
    }
}