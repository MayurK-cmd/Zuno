use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use instructions::*;
use state::Card;

declare_id!("ZUNoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

#[program]
pub mod zuno {
    use super::*;

    /// Create a new game room. Host pays the buy-in and becomes the first player.
    pub fn initialize_room(
        ctx: Context<InitializeRoom>,
        buy_in: u64,
        room_id: u64,
    ) -> Result<()> {
        ctx.accounts.validate(buy_in)?;
        initialize_room::handler(ctx, buy_in, room_id)
    }

    /// Join an open room. Player pays the buy-in and gets a PlayerState PDA.
    pub fn join_room(ctx: Context<JoinRoom>) -> Result<()> {
        join_room::handler(ctx)
    }

    /// Host starts the game. Triggers Switchboard VRF for deck randomness.
    pub fn start_game(ctx: Context<StartGame>) -> Result<()> {
        start_game::handler(ctx)
    }

    /// Switchboard oracle callback: seeds the deck and activates the game.
    pub fn consume_randomness(ctx: Context<ConsumeRandomness>) -> Result<()> {
        consume_randomness::handler(ctx)
    }

    /// Play a card. Submits a ZK proof, updates hand commitment and top card.
    pub fn play_card(
        ctx: Context<PlayCard>,
        proof: Vec<u8>,
        played_card: Card,
        new_hand_hash: [u8; 32],
    ) -> Result<()> {
        play_card::handler(ctx, proof, played_card, new_hand_hash)
    }

    /// Draw a card from the deck. Submits a ZK proof, updates hand commitment.
    pub fn draw_card(
        ctx: Context<DrawCard>,
        proof: Vec<u8>,
        new_hand_hash: [u8; 32],
        card_hash: [u8; 32],
    ) -> Result<()> {
        draw_card::handler(ctx, proof, new_hand_hash, card_hash)
    }

    /// Declare "Zuno" when you have exactly 2 cards. Must be called before
    /// playing down to 1 card or risk being punished.
    pub fn call_zuno(ctx: Context<CallZuno>) -> Result<()> {
        call_zuno::handler(ctx)
    }

    /// Claim the pot when your card count reaches 0.
    pub fn claim_victory(ctx: Context<ClaimVictory>) -> Result<()> {
        claim_victory::handler(ctx)
    }

    /// Anyone can force-skip an AFK player after their 60-second deadline.
    pub fn force_skip(ctx: Context<ForceSkip>) -> Result<()> {
        force_skip::handler(ctx)
    }

    /// Catch a player at 1 card who forgot to call Zuno — they draw 2.
    pub fn punish_zuno(ctx: Context<PunishZuno>) -> Result<()> {
        punish_zuno::handler(ctx)
    }
}
