//! `draw_card` — pull one card from the deck and add it to the active
//! player's hand.
//!
//! The contract:
//!
//!   1. Verifies the room is `Active`, the caller is the active
//!      player, and the turn deadline has not elapsed.
//!   2. Decodes the 4 public inputs supplied by the client (the same
//!      order the Noir `draw_card` circuit expects):
//!
//!         [0] old_hand_hash     (BytesN<32>)
//!         [1] new_hand_hash     (BytesN<32>)
//!         [2] card_hash         (BytesN<32>)
//!         [3] slot_index        (u32, in 0..15)
//!
//!   3. STUB: in Phase 2 this method will invoke the on-chain BN254
//!      verifier at `room.verifier_contract` via `env.invoke_contract`
//!      and propagate `InvalidProof` on a verifier-side failure. For
//!      now, we just validate the public inputs' shape and skip the
//!      verifier call.
//!   4. Increments `card_count`, clears `has_called_zuno` (the player
//!      just grew their hand, so any prior Zuno claim is stale),
//!      and advances the turn.
//!   5. Resets the turn deadline and emits a `CardDrawn` event.

use soroban_sdk::{Address, Bytes, BytesN, Env, Symbol, TryIntoVal, Val, Vec, crypto};

use crate::error::ZunoError;
use crate::state::{GameRoom, GameStatus, PlayerState, TURN_TIMEOUT_SECS};

const DRAW_CARD_PUBLIC_INPUTS_LEN: u32 = 4;
const TOPIC_CARD_DRAWN: &str = "card_drawn";

pub fn handler(
    env: Env,
    player: Address,
    room_id: u64,
    proof: Bytes,
    public_inputs: Vec<Val>,
    verifier_signature: Bytes,
) -> Result<(), ZunoError> {
    // ── Auth: the active player authorises the draw ───────────────────
    player.require_auth();

    // Verify the verifier signature on the proof
    if !crypto::verify_signature_secp256k1(&crate::VERIFIER_PUBLIC_KEY, &proof, &verifier_signature) {
        return Err(ZunoError::InvalidSignature);
    }

    // ── Load state ────────────────────────────────────────────────────
    let mut room = GameRoom::load(&env, room_id).ok_or(ZunoError::RoomNotFound)?;
    if room.status != GameStatus::Active {
        return Err(ZunoError::GameNotActive);
    }
    if room.active_player() != Some(player.clone()) {
        return Err(ZunoError::NotYourTurn);
    }
    if env.ledger().timestamp() > room.turn_deadline {
        return Err(ZunoError::TurnExpired);
    }

    let mut ps = PlayerState::load(&env, room_id, &player).ok_or(ZunoError::RoomNotFound)?;

    // ── Decode public inputs ─────────────────────────────────────────
    if public_inputs.len() != DRAW_CARD_PUBLIC_INPUTS_LEN {
        return Err(ZunoError::PublicInputMismatch);
    }
    let old_hand_hash = decode_bytes32(&env, public_inputs.get(0).unwrap())?;
    let new_hand_hash = decode_bytes32(&env, public_inputs.get(1).unwrap())?;
    let card_hash = decode_bytes32(&env, public_inputs.get(2).unwrap())?;
    let slot_index: u32 = decode_u32(&env, public_inputs.get(3).unwrap())?;

    // ── Sanity-check the on-chain public inputs match the room state ──
    if old_hand_hash != ps.hand_commitment {
        return Err(ZunoError::InvalidHandCommitment);
    }
    if slot_index >= 15 {
        return Err(ZunoError::PublicInputMismatch);
    }
    if card_hash == BytesN::from_array(&env, &[0u8; 32]) {
        return Err(ZunoError::PublicInputMismatch);
    }

    
    // ── Apply the draw ────────────────────────────────────────────────
    ps.hand_commitment = new_hand_hash;
    ps.card_count = ps
        .card_count
        .checked_add(1)
        .ok_or(ZunoError::Overflow)?;
    ps.has_called_zuno = false;

    // Advance the turn past the drawing player.
    room.advance_turn();
    room.turn_deadline = env.ledger().timestamp() + TURN_TIMEOUT_SECS;

    // ── Persist ──────────────────────────────────────────────────────
    room.save(&env, room_id);
    ps.save(&env);

    // ── Emit CardDrawn event ────────────────────────────────────────
    env.events().publish(
        (Symbol::new(&env, TOPIC_CARD_DRAWN), player.clone()),
        (room_id, ps.card_count),
    );

    Ok(())
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn decode_u32(env: &Env, v: Val) -> Result<u32, ZunoError> {
    <Val as TryIntoVal<Env, u32>>::try_into_val(&v, env)
        .map_err(|_| ZunoError::PublicInputMismatch)
}

fn decode_bytes32(env: &Env, v: Val) -> Result<BytesN<32>, ZunoError> {
    let bytes: Bytes = <Val as TryIntoVal<Env, Bytes>>::try_into_val(&v, env)
        .map_err(|_| ZunoError::PublicInputMismatch)?;
    if bytes.len() != 32 {
        return Err(ZunoError::PublicInputMismatch);
    }
    let mut arr = [0u8; 32];
    bytes.copy_into_slice(&mut arr);
    Ok(BytesN::from_array(env, &arr))
}
