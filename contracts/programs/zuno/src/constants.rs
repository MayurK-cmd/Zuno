//! Cross-cutting constants for the Zuno contract.
//!
//! Most game constants (`MAX_PLAYERS`, `MAX_HAND_SIZE`, `TURN_TIMEOUT_SECS`,
//! and the card-value constants `SKIP`/`REVERSE`/`DRAW_TWO`/`WILD_DRAW_FOUR`)
//! live in `state.rs` next to the types they describe, since they are tied
//! to the on-chain `GameRoom` / `Card` / `GameStatus` definitions.
//!
//! This module is reserved for constants that don't have a natural home
//! in `state.rs` — anything that's referenced from multiple instruction
//! handlers but isn't part of the stored data model.
//!
//! PDA seeds (`SEED_GAME_ROOM`, `SEED_PLAYER_STATE`, `SEED_VAULT`) have
//! been removed: Soroban has no PDAs, and `state.rs::DataKey` is the
//! single source of truth for storage keys.

// ── Punishments / penalties ──────────────────────────────────────────────────

/// Number of cards added to a player's hand when `punish_zuno` is
/// successfully called (i.e. they reached 1 card without calling Zuno).
pub const DRAW_PENALTY_CARDS: u32 = 2;

// ── Initial dealing ──────────────────────────────────────────────────────────

/// Number of cards each player is dealt at the start of a game. Standard
/// UNO rule.
pub const INITIAL_HAND_SIZE: u32 = 7;

// ── Commit-reveal randomness ─────────────────────────────────────────────────

/// Size in bytes of the host's commit-reveal seed (a BN254 field element
/// — same size as a `BytesN<32>` commitment).
pub const SEED_SIZE: u32 = 32;
