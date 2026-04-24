use anchor_lang::prelude::*;

#[account]
pub struct GameRoom {
    pub host: Pubkey,
    pub status: GameStatus,
    pub buy_in: u64,
    pub pot: u64,
    pub players: Vec<Pubkey>,
    pub current_turn: u8,
    pub top_card: Card,
    pub deck_root: [u8; 32],
    pub turn_deadline: i64,
    pub flow_direction: i8,
    pub vrf_account: Pubkey,
    pub verifier_program: Pubkey,
    pub bump: u8,
    pub vault_bump: u8,
}

impl GameRoom {
    pub const MAX_PLAYERS: usize = 8;
    pub const SPACE: usize = 8    // discriminator
        + 32                      // host
        + 1                       // status
        + 8                       // buy_in
        + 8                       // pot
        + 4 + 32 * Self::MAX_PLAYERS // players vec
        + 1                       // current_turn
        + Card::SIZE              // top_card
        + 32                      // deck_root
        + 8                       // turn_deadline
        + 1                       // flow_direction
        + 32                      // vrf_account
        + 32                      // verifier_program
        + 1                       // bump
        + 1;                      // vault_bump

    pub fn active_player(&self) -> Pubkey {
        self.players[self.current_turn as usize]
    }

    pub fn advance_turn(&mut self) {
        let n = self.players.len() as i16;
        let next = (self.current_turn as i16 + self.flow_direction as i16).rem_euclid(n);
        self.current_turn = next as u8;
    }

    pub fn skip_turn(&mut self) {
        self.advance_turn();
        self.advance_turn();
    }

    pub fn reverse_direction(&mut self) {
        self.flow_direction = -self.flow_direction;
        self.advance_turn();
    }
}

#[account]
pub struct PlayerState {
    pub room: Pubkey,
    pub player: Pubkey,
    pub hand_commitment: [u8; 32],
    pub card_count: u8,
    pub has_called_zuno: bool,
    pub bump: u8,
}

impl PlayerState {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 1 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub struct Card {
    pub color: u8,
    pub value: u8,
    pub is_wild: bool,
}

impl Card {
    pub const SIZE: usize = 1 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum GameStatus {
    Waiting,
    AwaitingVrf,
    Active,
    Finished,
}

pub mod card_value {
    pub const SKIP: u8 = 10;
    pub const REVERSE: u8 = 11;
    pub const DRAW_TWO: u8 = 12;
    pub const WILD_DRAW_FOUR: u8 = 13;
}
