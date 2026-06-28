//! `play_card` — apply a move from the active player's hand.
//!
//! This is one of the two ZK-verified actions (the other is
//! `draw_card`). The contract:
//!
//!   1. Verifies the room is `Active` and the caller is the active
//!      player, and the turn deadline has not elapsed.
//!   2. Decodes the 7 public inputs supplied by the client (the same
//!      order the Noir `play_card` circuit expects):
//!
//!         [0] top_card_color        (u32, in 0..=3 or 4=wild)
//!         [1] top_card_value        (u32, in 0..=13)
//!         [2] old_hand_hash         (BytesN<32>)
//!         [3] new_hand_hash         (BytesN<32>)
//!         [4] played_card_color     (u32)
//!         [5] played_card_value     (u32)
//!         [6] played_card_is_wild   (0 or 1)
//!
//!   3. STUB: in Phase 2 this method will invoke the on-chain BN254
//!      verifier at `room.verifier_contract` via `env.invoke_contract`
//!      and propagate `InvalidProof` on a verifier-side failure. For
//!      now, we just validate the public inputs' shape and skip the
//!      verifier call.
//!   4. Updates the room's `top_card`, the player's
//!      `hand_commitment`, decrements `card_count`, and advances the
//!      turn (with Skip / Reverse / DrawTwo effects).
//!   5. Resets the turn deadline and emits a `CardPlayed` event.

use soroban_sdk::{Address, Bytes, BytesN, Env, Symbol, TryIntoVal, Val, Vec};

use crate::error::ZunoError;
use crate::state::{
    Card, GameRoom, GameStatus, PlayerState, DRAW_TWO, REVERSE, SKIP, TURN_TIMEOUT_SECS,
    WILD_DRAW_FOUR,
};

// `Card.value == 1` is a "wild with chosen color" (no separate
// `is_wild` value — `is_wild` flag covers it).
const PLAY_CARD_PUBLIC_INPUTS_LEN: u32 = 7;
const TOPIC_PLAY_CARD: &str = "play_card";

pub fn handler(
    env: Env,
    player: Address,
    room_id: u64,
    proof: Bytes,
    public_inputs: Vec<Val>,
    verifier_signature: Bytes,
) -> Result<(), ZunoError> {
    // ── Auth: the active player authorises the move ────────────────────
    player.require_auth();

    // STUB: verifier signature check.
    //
    // PHASE 2: replace with `env.crypto().secp256k1_recover(...)` against
    // `room.verifier_pubkey` (the off-chain verifier server signs the
    // keccak256 of the proof with its secp256k1 key; the contract
    // recovers the signer and compares). For Phase 1 we just enforce
    // the signature is non-empty so empty sigs get rejected with a
    // meaningful error.
    if verifier_signature.is_empty() {
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

    // ── Decode public inputs (all 7 must be present) ──────────────────
    if public_inputs.len() != PLAY_CARD_PUBLIC_INPUTS_LEN {
        return Err(ZunoError::PublicInputMismatch);
    }
    let top_card_color: u32 = decode_u32(&env, public_inputs.get(0).unwrap())?;
    let top_card_value: u32 = decode_u32(&env, public_inputs.get(1).unwrap())?;
    let old_hand_hash = decode_bytes32(&env, public_inputs.get(2).unwrap())?;
    let new_hand_hash = decode_bytes32(&env, public_inputs.get(3).unwrap())?;
    let played_card_color: u32 = decode_u32(&env, public_inputs.get(4).unwrap())?;
    let played_card_value: u32 = decode_u32(&env, public_inputs.get(5).unwrap())?;
    let played_card_is_wild: bool = decode_u32(&env, public_inputs.get(6).unwrap())? != 0;

    // ── Sanity-check the on-chain public inputs match the room state ──
    if top_card_color != room.top_card.color || top_card_value != room.top_card.value {
        return Err(ZunoError::PublicInputMismatch);
    }
    if old_hand_hash != ps.hand_commitment {
        return Err(ZunoError::InvalidHandCommitment);
    }
    if !card_is_legal(
        played_card_color,
        played_card_value,
        played_card_is_wild,
        &room.top_card,
    ) {
        return Err(ZunoError::InvalidCard);
    }

    // ── Card value range checks ──────────────────────────────────────
    if played_card_color > 4 {
        return Err(ZunoError::InvalidCard);
    }
    if played_card_value > 13 {
        return Err(ZunoError::InvalidCard);
    }

    // ── STUB: would call `env.invoke_contract` on the BN254 verifier ─
    // PHASE 2: replace with the real verifier invocation:
    //
    //     let verifier_client = verifier::VerifierClient::new(&env, &room.verifier_contract);
    //     verifier_client.try_verify(&proof, &public_inputs)?;
    //
    // The verifier contract's `verify` symbol is the standard BN254
    // verifier interface. For now we skip the invoke entirely; the
    // public-input shape check above is what the verifier would
    // ultimately enforce.

    // ── Apply the move ────────────────────────────────────────────────
    room.top_card = Card {
        color: played_card_color,
        value: played_card_value,
        is_wild: played_card_is_wild,
    };
    ps.hand_commitment = new_hand_hash;
    ps.card_count = ps
        .card_count
        .checked_sub(1)
        .ok_or(ZunoError::VictoryRequiresZeroCards)?; // 0 == won

    // Re-asserting the "won" case: if card_count hit 0, the player
    // should call `claim_victory` to collect the pot. The contract
    // does not auto-claim here — that decision is left to the player
    // so they can choose to keep the room "live" until they call.

    // Reset Zuno flag if they no longer have exactly 1 card.
    if ps.card_count > 1 {
        ps.has_called_zuno = false;
    }

    // ── Advance the turn with card-effect handling ───────────────────
    match played_card_value {
        v if v == SKIP => room.skip_turn(),
        v if v == REVERSE => room.reverse_direction(),
        v if v == DRAW_TWO => {
            // The next player is forced to draw 2. We don't know who
            // that is until after we advance once. We just advance
            // past them and let the draw logic (combined with the
            // front-end UI) handle the +2 in the player's local
            // `card_count` until that flow is wired end-to-end.
            room.advance_turn();
        }
        v if v == WILD_DRAW_FOUR => {
            // Same: +4 goes to the next player via the client.
            room.advance_turn();
        }
        _ => room.advance_turn(),
    }

    // ── Reset the turn deadline ─────────────────────────────────────
    room.turn_deadline = env.ledger().timestamp() + TURN_TIMEOUT_SECS;

    // ── Persist ──────────────────────────────────────────────────────
    room.save(&env, room_id);
    ps.save(&env);

    // ── Emit CardPlayed event ───────────────────────────────────────
    env.events().publish(
        (Symbol::new(&env, TOPIC_PLAY_CARD), player.clone()),
        (room_id, played_card_color, played_card_value, ps.card_count),
    );

    Ok(())
}

// ── Helpers ────────────────────────────────────────────────────────────────

/// Returns `true` if the played card is legal against the top card
/// (matching color, matching value, or is a wild).
fn card_is_legal(
    played_color: u32,
    played_value: u32,
    played_is_wild: bool,
    top: &Card,
) -> bool {
    if played_is_wild {
        return true;
    }
    played_color == top.color || played_value == top.value
}

/// Decode a public input `Val` as a `u32`. The contract method's
/// `public_inputs: Vec<Val>` is a typed bag; small values (≤ u32) are
/// passed in directly and large values are wrapped in `Bytes`.
fn decode_u32(env: &Env, v: Val) -> Result<u32, ZunoError> {
    <Val as TryIntoVal<Env, u32>>::try_into_val(&v, env)
        .map_err(|_| ZunoError::PublicInputMismatch)
}

/// Decode a public input `Val` as a `BytesN<32>` (BN254 field element).
/// The ZK proof public-inputs buffer carries 32-byte field elements,
/// which the contract receives as `Bytes` inside the `Vec<Val>`.
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
