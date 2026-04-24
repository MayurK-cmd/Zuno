use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ZunoError;
use crate::state::*;

#[derive(Accounts)]
pub struct PunishZuno<'info> {
    #[account(
        constraint = game_room.status == GameStatus::Active @ ZunoError::GameNotActive,
    )]
    pub game_room: Account<'info, GameRoom>,

    #[account(
        mut,
        seeds = [SEED_PLAYER_STATE, game_room.key().as_ref(), offender.key().as_ref()],
        bump = offender_state.bump,
        constraint = offender_state.player == offender.key(),
        constraint = offender_state.room == game_room.key(),
    )]
    pub offender_state: Account<'info, PlayerState>,

    /// CHECK: The player who forgot to call Zuno
    pub offender: AccountInfo<'info>,

    pub caller: Signer<'info>,
}

pub fn handler(ctx: Context<PunishZuno>) -> Result<()> {
    require!(
        ctx.accounts.caller.key() != ctx.accounts.offender.key(),
        ZunoError::CannotPunishSelf
    );

    let ps = &mut ctx.accounts.offender_state;

    require!(
        ps.card_count == 1 && !ps.has_called_zuno,
        ZunoError::PunishNotApplicable
    );

    ps.card_count = ps
        .card_count
        .checked_add(DRAW_PENALTY_CARDS)
        .ok_or(ZunoError::Overflow)?;
    ps.has_called_zuno = false;

    emit!(ZunoPunished {
        room: ctx.accounts.game_room.key(),
        offender: ctx.accounts.offender.key(),
        penalty_cards: DRAW_PENALTY_CARDS,
        new_card_count: ps.card_count,
    });

    Ok(())
}

#[event]
pub struct ZunoPunished {
    pub room: Pubkey,
    pub offender: Pubkey,
    pub penalty_cards: u8,
    pub new_card_count: u8,
}
