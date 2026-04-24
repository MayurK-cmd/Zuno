use anchor_lang::prelude::*;
use switchboard_solana::prelude::*;

use crate::constants::*;
use crate::error::ZunoError;
use crate::state::*;

#[derive(Accounts)]
pub struct ConsumeRandomness<'info> {
    #[account(
        mut,
        constraint = game_room.status == GameStatus::AwaitingVrf @ ZunoError::GameNotActive,
        constraint = game_room.vrf_account == vrf.key() @ ZunoError::VrfNotReady,
    )]
    pub game_room: Account<'info, GameRoom>,

    #[account(
        constraint = vrf.load()?.authority == game_room.key() @ ZunoError::VrfNotReady,
    )]
    pub vrf: AccountLoader<'info, VrfLiteAccountData>,
}

pub fn handler(ctx: Context<ConsumeRandomness>) -> Result<()> {
    let vrf = ctx.accounts.vrf.load()?;
    let result_buffer = vrf.result_buffer;

    require!(result_buffer != [0u8; 32], ZunoError::VrfNotReady);

    let room = &mut ctx.accounts.game_room;

    // Use VRF randomness to seed the deck root and pick the starting top card
    room.deck_root = result_buffer;

    // Derive the initial top card from the first bytes of randomness.
    // color: 0-4 (Red, Blue, Green, Yellow, Wild), value: 0-9 for numbered cards.
    // Start with a non-wild numbered card so the first move has a clear constraint.
    let color = result_buffer[0] % 4;   // 0-3 (non-wild)
    let value = result_buffer[1] % 10;  // 0-9 (numbered card only)

    room.top_card = Card { color, value, is_wild: false };
    room.status = GameStatus::Active;

    let clock = Clock::get()?;
    room.turn_deadline = clock.unix_timestamp + TURN_TIMEOUT_SECS;

    emit!(GameStarted {
        room: ctx.accounts.game_room.key(),
        deck_root: result_buffer,
        top_card_color: color,
        top_card_value: value,
    });

    Ok(())
}

#[event]
pub struct GameStarted {
    pub room: Pubkey,
    pub deck_root: [u8; 32],
    pub top_card_color: u8,
    pub top_card_value: u8,
}
