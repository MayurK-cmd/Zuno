use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::error::ZunoError;
use crate::state::*;

#[derive(Accounts)]
#[instruction(buy_in: u64, room_id: u64)]
pub struct InitializeRoom<'info> {
    #[account(
        init,
        payer = host,
        space = GameRoom::SPACE,
        seeds = [SEED_GAME_ROOM, &room_id.to_le_bytes()],
        bump,
    )]
    pub game_room: Account<'info, GameRoom>,

    /// CHECK: PDA vault that holds SOL buy-ins
    #[account(
        mut,
        seeds = [SEED_VAULT, game_room.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    #[account(mut)]
    pub host: Signer<'info>,

    /// CHECK: Sunspot-generated ZK verifier program for play_card circuit
    pub verifier_program: UncheckedAccount<'info>,

    /// CHECK: Switchboard VRF account (created off-chain via CLI)
    pub vrf_account: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeRoom>,
    buy_in: u64,
    _room_id: u64,
) -> Result<()> {
    let room = &mut ctx.accounts.game_room;
    let bumps = &ctx.bumps;

    room.host = ctx.accounts.host.key();
    room.status = GameStatus::Waiting;
    room.buy_in = buy_in;
    room.pot = 0;
    room.players = Vec::new();
    room.current_turn = 0;
    room.top_card = Card { color: 0, value: 0, is_wild: false };
    room.deck_root = [0u8; 32];
    room.turn_deadline = 0;
    room.flow_direction = 1;
    room.vrf_account = ctx.accounts.vrf_account.key();
    room.verifier_program = ctx.accounts.verifier_program.key();
    room.bump = bumps.game_room;
    room.vault_bump = bumps.vault;

    // Transfer host buy-in to vault
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.host.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        buy_in,
    )?;

    room.pot = buy_in;
    room.players.push(ctx.accounts.host.key());

    emit!(RoomCreated {
        room: ctx.accounts.game_room.key(),
        host: ctx.accounts.host.key(),
        buy_in,
    });

    Ok(())
}

#[event]
pub struct RoomCreated {
    pub room: Pubkey,
    pub host: Pubkey,
    pub buy_in: u64,
}

impl<'info> InitializeRoom<'info> {
    pub fn validate(&self, buy_in: u64) -> Result<()> {
        require!(buy_in > 0, ZunoError::Overflow);
        Ok(())
    }
}
