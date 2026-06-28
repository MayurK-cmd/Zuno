//! Zuno — Fully On-Chain ZK Card Game (Soroban)
//!
//! This is the contract entry point. It maps the original Anchor
//! `#[program] mod zuno` block 1:1 to a Soroban `#[contractimpl] impl
//! ZunoContract` block. Each instruction in the original `instructions/`
//! directory is implemented as a public method on `ZunoContract` (see
//! `src/instructions/*.rs`).
//!
//! Module layout:
//!   - `state`     : on-chain data model (GameRoom, PlayerState, Card,
//!                   GameStatus, DataKey)
//!   - `error`     : `#[contracterror]` enum
//!   - `constants` : non-state constants (penalties, dealing size)
//!   - `instructions`: one file per game action
//!
#![no_std]

use soroban_sdk::{contract, contractimpl, Address, Bytes, Env, Vec};

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use crate::error::ZunoError;

// Verifier public key (secp256k1, uncompressed 65 bytes)
// Replace with the actual public key from the verifier server's private key
// Format: 0x04 [x: 32 bytes] [y: 32 bytes]
pub const VERIFIER_PUBLIC_KEY: [u8; 65] = [
    0x04, 0xb7, 0x8c, 0x61, 0x54, 0x15, 0x08, 0xc6,
    0x22, 0x77, 0xff, 0x0c, 0x23, 0x9e, 0xd1, 0x4e,
    0xda, 0xbc, 0x4c, 0x44, 0xc0, 0x9c, 0xcd, 0x58,
    0x8a, 0xee, 0xeb, 0xcd, 0xe6, 0x6c, 0x1e, 0x5d,
    0x26, 0x7f, 0x4c, 0x8d, 0x0a, 0x0a, 0xe8, 0x61,
    0x88, 0x5c, 0x47, 0xeb, 0x3f, 0x53, 0x10, 0x18,
    0xa8, 0x59, 0x32, 0x3c, 0x2f, 0x19, 0xe4, 0x40,
    0xe0, 0x5a, 0x05, 0x10, 0x05, 0x11, 0xac, 0x44,
    0xe1
];

// ── Contract ────────────────────────────────────────────────────────────────

#[contract]
pub struct ZunoContract;

// ── Contract implementation ─────────────────────────────────────────────────
//
// Each method is a thin entry point that delegates to the per-instruction
// file in `instructions/`. The original Anchor handler signatures took a
// `Context<...>` plus typed args; the Soroban equivalents take `env: &Env`
// followed by the contract parameters directly. Authentication (i.e.
// "is the caller the host?") is handled inside the per-instruction file
// via `env.invoker()` / `require_auth()`, and the XLM token transfer is
// performed via the `token::Client` wrapper.

#[contractimpl]
impl ZunoContract {
    // ── Lobby lifecycle ─────────────────────────────────────────────────────

    /// Create a new game room. The host becomes the first player and
    /// pays their own `stake_amount` in XLM stroops.
    ///
    /// `seed_commitment` is the host's commit-reveal commitment (a
    /// Poseidon2 hash of a random seed) — the actual seed is revealed
    /// later in `start_game`. This prevents the host from biasing the
    /// deck shuffle.
    pub fn initialize_room(
        env: Env,
        host: Address,
        room_id: u64,
        stake_amount: i128,
        xlm_token: Address,
        verifier_contract: Address,
        seed_commitment: Bytes,
    ) -> Result<(), ZunoError> {
        instructions::initialize_room::handler(
            env,
            host,
            room_id,
            stake_amount,
            xlm_token,
            verifier_contract,
            seed_commitment,
        )
    }

    /// Join an open room. The player pays `stake_amount` and gets a
    /// fresh `PlayerState`. A `PlayerState` is NOT yet initialised with
    /// a hand commitment here — that happens off-chain after the deck
    /// is dealt (post-`start_game`).
    pub fn join_room(
        env: Env,
        player: Address,
        room_id: u64,
    ) -> Result<(), ZunoError> {
        instructions::join_room::handler(env, player, room_id)
    }

    // ── Game start (commit-reveal randomness) ─────────────────────────────

    /// First step of the commit-reveal randomness flow. The host calls
    /// this to signal that the lobby is closed and the game is about
    /// to begin. The room transitions from `Waiting` to
    /// `AwaitingReveal`.
    pub fn start_game(
        env: Env,
        host: Address,
        room_id: u64,
    ) -> Result<(), ZunoError> {
        instructions::start_game::handler(env, host, room_id)
    }

    /// Second step of the commit-reveal randomness flow. The host
    /// discloses the seed they committed during `initialize_room`.
    /// The contract verifies the reveal matches the commitment,
    /// derives the deck root, picks a non-wild numbered top card,
    /// and transitions the room to `Active`.
    pub fn reveal_randomness(
        env: Env,
        host: Address,
        room_id: u64,
        seed_reveal: Bytes,
    ) -> Result<(), ZunoError> {
        instructions::reveal_randomness::handler(env, host, room_id, seed_reveal)
    }

    // ── Per-turn actions (require ZK proofs) ────────────────────────────────

    /// Play a card from the active player's hand. The verifier signature
    /// is checked against the verifier public key. On success, the room's
    /// `top_card` is updated, the player's `hand_commitment` is
    /// replaced, `card_count` is decremented, and the turn advances
    /// (with Skip / Reverse handling).
    pub fn play_card(
        env: Env,
        player: Address,
        room_id: u64,
        proof: Bytes,
        public_inputs: Vec<soroban_sdk::Val>,
        verifier_signature: Bytes,
    ) -> Result<(), ZunoError> {
        instructions::play_card::handler(env, player, room_id, proof, public_inputs, verifier_signature)
    }

    /// Draw a card from the deck. The verifier signature is checked against the verifier public key.
    /// On success, updates the hand commitment, increments `card_count`, clears `has_called_zuno`, advances turn.
    pub fn draw_card(
        env: Env,
        player: Address,
        room_id: u64,
        proof: Bytes,
        public_inputs: Vec<soroban_sdk::Val>,
        verifier_signature: Bytes,
    ) -> Result<(), ZunoError> {
        instructions::draw_card::handler(env, player, room_id, proof, public_inputs, verifier_signature)
    }

    // ── Status / punishment / forfeit ───────────────────────────────────────

    /// Declare "Zuno!" when you have exactly 2 cards. The contract
    /// checks `card_count == 2 == 2` and that the player has not already
    /// called Zuno this round.
    pub fn call_zuno(
        env: Env,
        player: Address,
        room_id: u64,
    ) -> Result<(), ZunoError> {
        instructions::call_zuno::handler(env, player, room_id)
    }

    /// Claim the pot when your hand reaches 0 cards. The contract
    /// transfers the entire XLM pot to the caller and marks the room
    /// `Finished`. **This is a trust assumption for the hackathon**:
    /// the contract does not re-verify `card_count == 0` with a ZK
    /// proof — it relies on the `card_count` that was tracked through
    /// the preceding `play_card` / `draw_card` invocations.
    pub fn claim_victory(
        env: Env,
        winner: Address,
        room_id: u64,
    ) -> Result<(), ZunoError> {
        instructions::claim_victory::handler(env, winner, room_id)
    }

    /// Anyone can force-skip an AFK player after `TURN_TIMEOUT_SECS`
    /// has elapsed. The AFK player draws one card and the turn
    /// advances past them.
    pub fn force_skip(
        env: Env,
        caller: Address,
        room_id: u64,
    ) -> Result<(), ZunoError> {
        instructions::force_skip::handler(env, caller, room_id)
    }

    /// Catch a player who has 1 card but has not called Zuno. The
    /// caller forces the offender to draw 2 extra cards.
    pub fn punish_zuno(
        env: Env,
        caller: Address,
        target: Address,
        room_id: u64,
    ) -> Result<(), ZunoError> {
        instructions::punish_zuno::handler(env, caller, target, room_id)
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────
//
// Unit tests for the per-instruction logic live in each
// `instructions/<name>.rs` file. The end-to-end integration tests that
// were previously in `tests/zuno.ts` (Anchor / TypeScript) will be
// rewritten in Rust under `tests/` in a follow-up step.