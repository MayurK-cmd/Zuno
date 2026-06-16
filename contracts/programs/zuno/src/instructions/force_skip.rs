//! `force_skip` — anyone can advance the turn past an AFK player
//! after `TURN_TIMEOUT_SECS` has elapsed.
//!
//! The AFK player draws one card (their `card_count` is incremented
//! but their `hand_commitment` is NOT updated — the off-chain client
//! is responsible for producing a `draw_card` ZK proof to commit to
//! the new hand). The turn then advances past them. This keeps the
//! pot and the room alive when one player walks away.
//!
//! Note: this method only forces the *turn* to advance. It does not
//! forfeit the player or refund the pot. The room stays `Active` so
//! the AFK player can re-join on their next move (their `turn_deadline`
//! is reset just like any other draw).

use soroban_sdk::{Address, Env, Symbol};

use crate::error::ZunoError;
use crate::state::{GameRoom, GameStatus, PlayerState, TURN_TIMEOUT_SECS};

const TOPIC_FORCE_SKIP: &str = "force_skip";

pub fn handler(env: Env, caller: Address, room_id: u64) -> Result<(), ZunoError> {
    // ── Auth: the caller authorises the force-skip ───────────────────
    caller.require_auth();

    // ── Load state ────────────────────────────────────────────────────
    let mut room = GameRoom::load(&env, room_id).ok_or(ZunoError::RoomNotFound)?;
    if room.status != GameStatus::Active {
        return Err(ZunoError::GameNotActive);
    }

    // The deadline must have elapsed.
    if env.ledger().timestamp() <= room.turn_deadline {
        return Err(ZunoError::TurnNotExpired);
    }

    // The AFK player is whoever holds the current turn.
    let afk = room
        .active_player()
        .ok_or(ZunoError::RoomNotFound)?;
    let mut afk_state =
        PlayerState::load(&env, room_id, &afk).ok_or(ZunoError::RoomNotFound)?;

    // ── Apply the force-skip ─────────────────────────────────────────
    // The AFK player draws 1. The actual hand_commitment update is
    // gated on a follow-up `draw_card` ZK proof from the AFK player
    // (or, if they don't return, the off-chain indexer observes the
    // mismatch and the game is forfeited via a separate flow).
    afk_state.card_count = afk_state
        .card_count
        .checked_add(1)
        .ok_or(ZunoError::Overflow)?;
    afk_state.has_called_zuno = false;

    // Advance the turn past the AFK player.
    room.advance_turn();
    room.turn_deadline = env.ledger().timestamp() + TURN_TIMEOUT_SECS;

    // ── Persist ──────────────────────────────────────────────────────
    room.save(&env, room_id);
    afk_state.save(&env);

    // ── Emit ForceSkipped event ─────────────────────────────────────
    env.events().publish(
        (Symbol::new(&env, TOPIC_FORCE_SKIP), caller.clone()),
        (room_id, afk, afk_state.card_count),
    );

    Ok(())
}
