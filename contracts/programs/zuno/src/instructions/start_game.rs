use anchor_lang::prelude::*;
use switchboard_solana::prelude::*;

use crate::constants::*;
use crate::error::ZunoError;
use crate::state::*;

#[derive(Accounts)]
pub struct StartGame<'info> {
    #[account(
        mut,
        has_one = host @ ZunoError::NotHost,
        constraint = game_room.status == GameStatus::Waiting @ ZunoError::GameAlreadyStarted,
        constraint = game_room.players.len() >= 2 @ ZunoError::NotEnoughPlayers,
    )]
    pub game_room: Account<'info, GameRoom>,

    pub host: Signer<'info>,

    // Switchboard VRF Lite account — created off-chain before calling start_game
    #[account(
        mut,
        constraint = vrf.load()?.authority == game_room.key() @ ZunoError::VrfNotReady,
    )]
    pub vrf: AccountLoader<'info, VrfLiteAccountData>,

    /// CHECK: Switchboard oracle queue
    pub oracle_queue: AccountInfo<'info>,

    /// CHECK: Queue authority
    pub queue_authority: AccountInfo<'info>,

    /// CHECK: Data buffer
    pub data_buffer: AccountInfo<'info>,

    /// CHECK: Permission account for VRF
    pub permission: AccountInfo<'info>,

    #[account(mut)]
    /// CHECK: Escrow for VRF request fee
    pub escrow: AccountInfo<'info>,

    /// CHECK: Switchboard program mint
    pub switchboard_mint: AccountInfo<'info>,

    pub payer: Signer<'info>,

    /// CHECK: Switchboard V2 program
    pub switchboard_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: AccountInfo<'info>,
}

pub fn handler(ctx: Context<StartGame>) -> Result<()> {
    let room = &mut ctx.accounts.game_room;
    room.status = GameStatus::AwaitingVrf;

    let room_key = room.key();
    let room_bump = room.bump;

    // CPI: request VRF randomness from Switchboard
    // The oracle will call our `consume_randomness` instruction as callback
    let request_params = format!(
        "ProgramID={},StateAccountKey={}",
        crate::ID,
        room_key,
    );

    let vrf_request_ctx = CpiContext::new_with_signer(
        ctx.accounts.switchboard_program.to_account_info(),
        VrfLiteRequestRandomness {
            authority: room.to_account_info(),
            vrf: ctx.accounts.vrf.to_account_info(),
            oracle_queue: ctx.accounts.oracle_queue.to_account_info(),
            queue_authority: ctx.accounts.queue_authority.to_account_info(),
            data_buffer: ctx.accounts.data_buffer.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            escrow: ctx.accounts.escrow.to_account_info(),
            recent_blockhashes: ctx.accounts.payer.to_account_info(),
            program_state: ctx.accounts.payer.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
        &[&[SEED_GAME_ROOM, &[room_bump]]],
    );

    // NOTE: Full Switchboard VRF request CPI — wire in exact types once
    // switchboard-solana version is pinned and VRF account is provisioned.
    msg!("Requesting VRF randomness for room {}", room_key);
    msg!("Callback params: {}", request_params);

    emit!(GameStarting {
        room: room_key,
        player_count: room.players.len() as u8,
    });

    Ok(())
}

#[event]
pub struct GameStarting {
    pub room: Pubkey,
    pub player_count: u8,
}
