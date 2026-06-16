use soroban_sdk::{Address, Env};

use crate::error::ZunoError;
use crate::state::{GameRoom, GameStatus, PlayerState};

/// Declare "Zuno!" when you have exactly 2 cards. The contract checks:
///   - the room is in `Active` state (you can't Zuno in the lobby)
///   - `card_count == 2`
///   - the player has not already called Zuno this round
///
/// The check is on the on-chain `card_count` field, which is tracked
/// through the preceding `play_card` / `draw_card` invocations. The
/// player doesn't need to provide a ZK proof for this — the only
/// constraint here is the public card count.
pub fn handler(env: Env, player: Address, room_id: u64) -> Result<(), ZunoError> {
    // The host / caller must authorise the call.
    player.require_auth();

    // ── Load state ────────────────────────────────────────────────────
    let room = GameRoom::load(&env, room_id).ok_or(ZunoError::RoomNotFound)?;

    if room.status != GameStatus::Active {
        return Err(ZunoError::GameNotActive);
    }

    let mut ps = PlayerState::load(&env, room_id, &player).ok_or(ZunoError::RoomNotFound)?;

    // ── Validate ──────────────────────────────────────────────────────
    if ps.has_called_zuno {
        return Err(ZunoError::AlreadyCalledZuno);
    }
    if ps.card_count != 2 {
        return Err(ZunoError::ZunoRequiresTwoCards);
    }

    // ── Update state ──────────────────────────────────────────────────
    ps.has_called_zuno = true;
    ps.save(&env);

    Ok(())
}
