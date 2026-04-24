use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::error::ZunoError;
use crate::state::*;

#[derive(Accounts)]
pub struct ClaimVictory<'info> {
    #[account(
        mut,
        constraint = game_room.status == GameStatus::Active @ ZunoError::GameNotActive,
        close = winner,
    )]
    pub game_room: Account<'info, GameRoom>,

    /// CHECK: PDA vault holding the pot
    #[account(
        mut,
        seeds = [SEED_VAULT, game_room.key().as_ref()],
        bump = game_room.vault_bump,
    )]
    pub vault: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [SEED_PLAYER_STATE, game_room.key().as_ref(), winner.key().as_ref()],
        bump = player_state.bump,
        constraint = player_state.player == winner.key(),
        constraint = player_state.room == game_room.key(),
        constraint = player_state.card_count == 0 @ ZunoError::VictoryRequiresZeroCards,
        close = winner,
    )]
    pub player_state: Account<'info, PlayerState>,

    #[account(mut)]
    pub winner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ClaimVictory>) -> Result<()> {
    let room = &ctx.accounts.game_room;
    let pot = room.pot;
    let room_key = room.key();
    let vault_bump = room.vault_bump;

    // Transfer entire pot from vault to winner
    let vault_signer_seeds: &[&[u8]] = &[
        SEED_VAULT,
        room_key.as_ref(),
        &[vault_bump],
    ];

    system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.winner.to_account_info(),
            },
            &[vault_signer_seeds],
        ),
        pot,
    )?;

    emit!(VictoryClaimed {
        room: room_key,
        winner: ctx.accounts.winner.key(),
        pot,
    });

    Ok(())
}

#[event]
pub struct VictoryClaimed {
    pub room: Pubkey,
    pub winner: Pubkey,
    pub pot: u64,
}
