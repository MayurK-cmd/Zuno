use anchor_lang::prelude::*;
use solana_program::instruction::Instruction;
use solana_program::program::invoke;

use crate::constants::*;
use crate::error::ZunoError;
use crate::state::*;

fn encode_draw_public_inputs(
    old_hand_hash: &[u8; 32],
    new_hand_hash: &[u8; 32],
    deck_root: &[u8; 32],
    card_hash: &[u8; 32],
) -> Vec<u8> {
    let mut buf = Vec::with_capacity(4 * 32);
    buf.extend_from_slice(old_hand_hash);
    buf.extend_from_slice(new_hand_hash);
    buf.extend_from_slice(deck_root);
    buf.extend_from_slice(card_hash);
    buf
}

#[derive(Accounts)]
pub struct DrawCard<'info> {
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

    /// CHECK: Sunspot ZK verifier for draw_card circuit
    pub verifier_program: AccountInfo<'info>,
}

pub fn handler(
    ctx: Context<DrawCard>,
    proof: Vec<u8>,
    new_hand_hash: [u8; 32],
    card_hash: [u8; 32],
) -> Result<()> {
    let room = &mut ctx.accounts.game_room;
    let ps = &mut ctx.accounts.player_state;

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp <= room.turn_deadline,
        ZunoError::TurnExpired
    );

    require!(
        ps.card_count < MAX_HAND_SIZE,
        ZunoError::Overflow
    );

    let old_hash: [u8; 32] = ps.hand_commitment;
    let pub_inputs = encode_draw_public_inputs(
        &old_hash,
        &new_hand_hash,
        &room.deck_root,
        &card_hash,
    );

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

    ps.hand_commitment = new_hand_hash;
    ps.card_count = ps.card_count.checked_add(1).ok_or(ZunoError::Overflow)?;
    ps.has_called_zuno = false;

    room.advance_turn();
    room.turn_deadline = clock.unix_timestamp + TURN_TIMEOUT_SECS;

    emit!(CardDrawn {
        room: room.key(),
        player: ctx.accounts.player.key(),
        card_count: ps.card_count,
    });

    Ok(())
}

#[event]
pub struct CardDrawn {
    pub room: Pubkey,
    pub player: Pubkey,
    pub card_count: u8,
}
