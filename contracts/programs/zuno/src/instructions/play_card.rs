use anchor_lang::prelude::*;
use solana_program::instruction::Instruction;
use solana_program::program::invoke;

use crate::constants::*;
use crate::error::ZunoError;
use crate::state::*;

/// Serialised public inputs passed to the Sunspot verifier CPI.
/// Order must match the Noir circuit's public input declaration:
///   top_card_color, top_card_value, old_hand_hash, new_hand_hash,
///   played_card_color, played_card_value, played_card_is_wild
fn encode_public_inputs(
    top_card: &Card,
    old_hand_hash: &[u8; 32],
    new_hand_hash: &[u8; 32],
    played: &Card,
) -> Vec<u8> {
    let mut buf = Vec::with_capacity(7 * 32);
    // Each public field is 32 bytes (big-endian padded) for Barretenberg
    fn field(v: u8) -> [u8; 32] { let mut b = [0u8; 32]; b[31] = v; b }
    fn bool_field(v: bool) -> [u8; 32] { field(v as u8) }

    buf.extend_from_slice(&field(top_card.color));
    buf.extend_from_slice(&field(top_card.value));
    buf.extend_from_slice(old_hand_hash);
    buf.extend_from_slice(new_hand_hash);
    buf.extend_from_slice(&field(played.color));
    buf.extend_from_slice(&field(played.value));
    buf.extend_from_slice(&bool_field(played.is_wild));
    buf
}

#[derive(Accounts)]
pub struct PlayCard<'info> {
    #[account(
        mut,
        constraint = game_room.status == GameStatus::Active @ ZunoError::GameNotActive,
        constraint = game_room.active_player() == player.key() @ ZunoError::NotYourTurn,
    )]
    pub game_room: Account<'info, GameRoom>,

    #[account(
        mut,
        seeds = [SEED_PLAYER_STATE, game_room.key().as_ref(), player.key().as_ref()],
        bump = player_state.bump,
        constraint = player_state.player == player.key(),
        constraint = player_state.room == game_room.key(),
    )]
    pub player_state: Account<'info, PlayerState>,

    pub player: Signer<'info>,

    /// CHECK: Sunspot-compiled ZK verifier program for play_card circuit
    pub verifier_program: AccountInfo<'info>,
}

pub fn handler(
    ctx: Context<PlayCard>,
    proof: Vec<u8>,
    played_card: Card,
    new_hand_hash: [u8; 32],
) -> Result<()> {
    let room = &mut ctx.accounts.game_room;
    let ps = &mut ctx.accounts.player_state;

    // Deadline check
    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp <= room.turn_deadline,
        ZunoError::TurnExpired
    );

    // Verify played card is valid against current top card
    let top = &room.top_card;
    require!(
        played_card.color == top.color
            || played_card.value == top.value
            || played_card.is_wild,
        ZunoError::InvalidCard
    );

    // Build public inputs and call Sunspot verifier
    let pub_inputs = encode_public_inputs(
        &room.top_card,
        &ps.hand_commitment.try_into().unwrap(),
        &new_hand_hash,
        &played_card,
    );

    // Sunspot verifier instruction layout: [proof_len: u32][proof][pub_inputs]
    let mut ix_data = Vec::with_capacity(4 + proof.len() + pub_inputs.len());
    ix_data.extend_from_slice(&(proof.len() as u32).to_le_bytes());
    ix_data.extend_from_slice(&proof);
    ix_data.extend_from_slice(&pub_inputs);

    let verify_ix = Instruction {
        program_id: ctx.accounts.verifier_program.key(),
        accounts: vec![],
        data: ix_data,
    };

    invoke(&verify_ix, &[ctx.accounts.verifier_program.to_account_info()])
        .map_err(|_| error!(ZunoError::InvalidProof))?;

    // Update state post-proof
    ps.hand_commitment = new_hand_hash;
    ps.card_count = ps.card_count.checked_sub(1).ok_or(ZunoError::Overflow)?;

    // Reset Zuno call if they now have > 1 card (shouldn't happen here, but guard)
    if ps.card_count > 1 {
        ps.has_called_zuno = false;
    }

    room.top_card = played_card.clone();

    // Handle special card effects and advance turn
    match played_card.value {
        card_value::SKIP => room.skip_turn(),
        card_value::REVERSE => room.reverse_direction(),
        _ => room.advance_turn(),
    }

    room.turn_deadline = clock.unix_timestamp + TURN_TIMEOUT_SECS;

    emit!(CardPlayed {
        room: room.key(),
        player: ctx.accounts.player.key(),
        card_color: played_card.color,
        card_value: played_card.value,
        cards_remaining: ps.card_count,
    });

    Ok(())
}

#[event]
pub struct CardPlayed {
    pub room: Pubkey,
    pub player: Pubkey,
    pub card_color: u8,
    pub card_value: u8,
    pub cards_remaining: u8,
}
