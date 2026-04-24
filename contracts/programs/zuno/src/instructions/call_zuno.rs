use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ZunoError;
use crate::state::*;

#[derive(Accounts)]
pub struct CallZuno<'info> {
    #[account(
        constraint = game_room.status == GameStatus::Active @ ZunoError::GameNotActive,
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
}

pub fn handler(ctx: Context<CallZuno>) -> Result<()> {
    let ps = &mut ctx.accounts.player_state;

    require!(!ps.has_called_zuno, ZunoError::AlreadyCalledZuno);
    require!(ps.card_count == 2, ZunoError::ZunoRequiresTwoCards);

    ps.has_called_zuno = true;

    emit!(ZunoCalled {
        room: ctx.accounts.game_room.key(),
        player: ctx.accounts.player.key(),
    });

    Ok(())
}

#[event]
pub struct ZunoCalled {
    pub room: Pubkey,
    pub player: Pubkey,
}
