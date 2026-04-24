use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ZunoError;
use crate::state::*;

#[derive(Accounts)]
pub struct ForceSkip<'info> {
    #[account(
        mut,
        constraint = game_room.status == GameStatus::Active @ ZunoError::GameNotActive,
    )]
    pub game_room: Account<'info, GameRoom>,

    /// CHECK: The player whose turn has expired (identified by current_turn index)
    #[account(
        mut,
        seeds = [SEED_PLAYER_STATE, game_room.key().as_ref(), afk_player.key().as_ref()],
        bump = afk_player_state.bump,
        constraint = afk_player_state.player == afk_player.key(),
        constraint = afk_player_state.room == game_room.key(),
    )]
    pub afk_player_state: Account<'info, PlayerState>,

    /// CHECK: The AFK player — validated via current_turn constraint below
    pub afk_player: AccountInfo<'info>,

    // Anyone can call force_skip; no signer restriction
    pub caller: Signer<'info>,
}

pub fn handler(ctx: Context<ForceSkip>) -> Result<()> {
    let room = &mut ctx.accounts.game_room;
    let ps = &mut ctx.accounts.afk_player_state;

    // Confirm it's actually this player's turn
    require!(
        room.active_player() == ctx.accounts.afk_player.key(),
        ZunoError::NotYourTurn
    );

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp > room.turn_deadline,
        ZunoError::TurnNotExpired
    );

    // AFK penalty: +1 card to their count
    ps.card_count = ps.card_count.checked_add(1).ok_or(ZunoError::Overflow)?;
    ps.has_called_zuno = false;

    room.advance_turn();
    room.turn_deadline = clock.unix_timestamp + TURN_TIMEOUT_SECS;

    emit!(TurnForceSkipped {
        room: room.key(),
        afk_player: ctx.accounts.afk_player.key(),
        new_card_count: ps.card_count,
    });

    Ok(())
}

#[event]
pub struct TurnForceSkipped {
    pub room: Pubkey,
    pub afk_player: Pubkey,
    pub new_card_count: u8,
}
