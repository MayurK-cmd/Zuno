use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::error::ZunoError;
use crate::state::*;

#[derive(Accounts)]
pub struct JoinRoom<'info> {
    #[account(
        mut,
        constraint = game_room.status == GameStatus::Waiting @ ZunoError::GameAlreadyStarted,
        constraint = game_room.players.len() < GameRoom::MAX_PLAYERS @ ZunoError::GameFull,
        constraint = !game_room.players.contains(&player.key()) @ ZunoError::AlreadyInRoom,
    )]
    pub game_room: Account<'info, GameRoom>,

    /// CHECK: PDA vault
    #[account(
        mut,
        seeds = [SEED_VAULT, game_room.key().as_ref()],
        bump = game_room.vault_bump,
    )]
    pub vault: SystemAccount<'info>,

    #[account(
        init,
        payer = player,
        space = PlayerState::SPACE,
        seeds = [SEED_PLAYER_STATE, game_room.key().as_ref(), player.key().as_ref()],
        bump,
    )]
    pub player_state: Account<'info, PlayerState>,

    #[account(mut)]
    pub player: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<JoinRoom>) -> Result<()> {
    let room = &mut ctx.accounts.game_room;

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.player.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        room.buy_in,
    )?;

    room.pot = room.pot.checked_add(room.buy_in).ok_or(ZunoError::Overflow)?;
    room.players.push(ctx.accounts.player.key());

    let ps = &mut ctx.accounts.player_state;
    ps.room = room.key();
    ps.player = ctx.accounts.player.key();
    ps.hand_commitment = [0u8; 32];
    ps.card_count = 0;
    ps.has_called_zuno = false;
    ps.bump = ctx.bumps.player_state;

    emit!(PlayerJoined {
        room: room.key(),
        player: ctx.accounts.player.key(),
        player_count: room.players.len() as u8,
    });

    Ok(())
}

#[event]
pub struct PlayerJoined {
    pub room: Pubkey,
    pub player: Pubkey,
    pub player_count: u8,
}
