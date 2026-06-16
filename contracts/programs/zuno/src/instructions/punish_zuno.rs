//! `punish_zuno` — catch a player who has reached 1 card without
//! calling Zuno.
//!
//! Anyone can call this against an offender. The contract checks:
//!   - the room is in `Active` state
//!   - the offender's `card_count == 1`
//!   - the offender has NOT called Zuno
//!   - the caller is not the offender (no self-policing)
//!
//! On success, the offender's `card_count` is incremented by
//! `DRAW_PENALTY_CARDS` (= 2) and their `hand_commitment` is
//! unchanged. As with `force_skip`, the actual hand_commitment
//! update is gated on a follow-up `draw_card` ZK proof that the
//! offender must produce locally (the contract trusts `card_count`
//! for ordering, not for hidden-hand correctness — that comes from
//! the ZK proof).
//!
//! **No caller reward.** The caller spends a transaction fee; the
//! only effect is the 2-card penalty on the offender.

use soroban_sdk::{Address, Env, Symbol};

use crate::constants::DRAW_PENALTY_CARDS;
use crate::error::ZunoError;
use crate::state::{GameRoom, GameStatus, PlayerState};

const TOPIC_PUNISH_ZUNO: &str = "punish_zuno";

pub fn handler(
    env: Env,
    caller: Address,
    target: Address,
    room_id: u64,
) -> Result<(), ZunoError> {
    // ── Auth: the caller authorises the punish ───────────────────────
    caller.require_auth();

    // ── Load state ────────────────────────────────────────────────────
    let room = GameRoom::load(&env, room_id).ok_or(ZunoError::RoomNotFound)?;
    if room.status != GameStatus::Active {
        return Err(ZunoError::GameNotActive);
    }

    // ── Validate ──────────────────────────────────────────────────────
    if caller == target {
        return Err(ZunoError::CannotPunishSelf);
    }
    if !room.players.contains(&target) {
        return Err(ZunoError::RoomNotFound);
    }

    let mut target_state =
        PlayerState::load(&env, room_id, &target).ok_or(ZunoError::RoomNotFound)?;

    if target_state.has_called_zuno {
        return Err(ZunoError::PunishNotApplicable);
    }
    if target_state.card_count != 1 {
        return Err(ZunoError::PunishNotApplicable);
    }

    // ── Apply the penalty ────────────────────────────────────────────
    target_state.card_count = target_state
        .card_count
        .checked_add(DRAW_PENALTY_CARDS)
        .ok_or(ZunoError::Overflow)?;
    target_state.has_called_zuno = false;
    target_state.save(&env);

    // ── Emit Punished event ─────────────────────────────────────────
    env.events().publish(
        (Symbol::new(&env, TOPIC_PUNISH_ZUNO), caller.clone()),
        (room_id, target, target_state.card_count),
    );

    Ok(())
}
