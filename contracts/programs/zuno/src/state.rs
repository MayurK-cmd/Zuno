use soroban_sdk::{contracttype, Address, BytesN, Env, Vec};

/// Maximum number of players allowed in a single game room.
pub const MAX_PLAYERS: u32 = 8;

/// Maximum number of card slots a single hand can hold (matches the Noir
/// circuit's fixed hand size of 15).
pub const MAX_HAND_SIZE: u32 = 15;

/// Turn timeout, in seconds. After this many seconds elapse, anyone can
/// call `force_skip` to advance the turn past the AFK player.
pub const TURN_TIMEOUT_SECS: u64 = 60;

// ── Card value constants ─────────────────────────────────────────────────────
// Matches the Noir circuit's encoding.
//   Skip        = 10
//   Reverse     = 11
//   DrawTwo     = 12
//   WildDrawFour = 13
// Colors (in Soroban/Card.value semantics):
//   0=Red, 1=Green, 2=Blue, 3=Yellow
// Wild cards are flagged via `is_wild = true` rather than a dedicated
// color byte (so a Wild can be played against any top card).

pub const SKIP: u32 = 10;
pub const REVERSE: u32 = 11;
pub const DRAW_TWO: u32 = 12;
pub const WILD_DRAW_FOUR: u32 = 13;

// ── Storage keys ─────────────────────────────────────────────────────────────
//
// Soroban has no PDAs. Storage keys are a `(DataKey, ...)` tuple. We mirror
// the layout described in CLAUDE.md:
//   GameRoom  : persistent, keyed by (DataKey::GameRoom(room_id))
//   PlayerState: persistent, keyed by (DataKey::PlayerState(room_id, player))
//
// Both keys are stored under `env.storage().persistent()` so we can call
// `extend_ttl` on each write.

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    GameRoom(u64),
    PlayerState(u64, Address),
}

// ── Card ─────────────────────────────────────────────────────────────────────

/// A single UNO card.
///
/// `value` carries both the number (0-9) and the action type via the
/// constants above (SKIP=10, REVERSE=11, DRAW_TWO=12, WILD_DRAW_FOUR=13).
/// `is_wild` is true for Wild and WildDrawFour cards.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Card {
    pub color: u32,
    pub value: u32,
    pub is_wild: bool,
}

// ── GameStatus ───────────────────────────────────────────────────────────────

/// Lifecycle of a game room. Mirrors the Solana enum 1:1.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GameStatus {
    Waiting,
    AwaitingReveal, // host has committed, seed not yet revealed
    Active,
    Finished,
}

// ── GameRoom ────────────────────────────────────────────────────────────────

/// On-chain, per-room state. Persisted at `DataKey::GameRoom(room_id)`.
///
/// The `deck_root` and the deck-card Merkle tree itself are kept off-chain
/// (the chain never sees raw cards). The contract only stores the
/// commitment to the deck and a per-player `hand_commitment`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct GameRoom {
    pub host: Address,
    pub status: GameStatus,
    pub stake_amount: i128,       // XLM stroops per player
    pub pot: i128,                // accumulated XLM stroops
    pub players: Vec<Address>,
    pub current_turn: u32,        // index into `players`
    pub top_card: Card,
    /// Poseidon2 / BN254 root of the deck's card-hash Merkle tree. The
    /// actual Merkle tree is reconstructed off-chain from public state.
    pub deck_root: BytesN<32>,
    pub turn_deadline: u64,       // ledger timestamp (seconds)
    pub flow_direction: i32,      // +1 normal, -1 reversed
    /// Address of the Soroban token contract used for XLM stakes
    /// (typically the SAC for native XLM on Stellar).
    pub xlm_token: Address,
    /// Seed committed by the host during `initialize_room`; revealed
    /// during `start_game` to seed the deck shuffle. `None` until the
    /// host commits. Stored as `Option<BytesN<32>>` so that "no seed
    /// yet" is a distinct state from "seed is all zeros".
    pub commit_reveal_seed: Option<BytesN<32>>,
}

impl GameRoom {
    /// Return the address of the player whose turn it currently is.
    pub fn active_player(&self) -> Option<Address> {
        self.players.get(self.current_turn)
    }

    /// Advance `current_turn` by one step, wrapping around with the
    /// configured `flow_direction`.
    pub fn advance_turn(&mut self) {
        let n = self.players.len() as i64;
        if n == 0 {
            return;
        }
        let cur = self.current_turn as i64;
        let dir = self.flow_direction as i64;
        let next = ((cur + dir).rem_euclid(n)) as u32;
        self.current_turn = next;
    }

    /// Skip the next player in turn order (used for Skip and DrawTwo).
    pub fn skip_turn(&mut self) {
        self.advance_turn();
        self.advance_turn();
    }

    /// Reverse turn direction and advance (used for Reverse cards).
    /// With only 2 players this is equivalent to a Skip; with 3+ it
    /// flips the order.
    pub fn reverse_direction(&mut self) {
        self.flow_direction = -self.flow_direction;
        self.advance_turn();
    }

    /// Persist this room and refresh its storage TTL. Call after every
    /// state mutation to keep the entry alive.
    pub fn save(&self, env: &Env, room_id: u64) {
        let key = DataKey::GameRoom(room_id);
        env.storage().persistent().set(&key, self);
        // ~30 days at the current Soroban storage rent/TTL parameters.
        // Refreshing on every write is cheap and keeps rooms safe from
        // being archived mid-game.
        env.storage()
            .persistent()
            .extend_ttl(&key, 100, 200);
    }

    /// Load a room from persistent storage. Returns `None` if the room
    /// does not exist (i.e. the key is unset or has been archived).
    pub fn load(env: &Env, room_id: u64) -> Option<Self> {
        env.storage()
            .persistent()
            .get::<DataKey, Self>(&DataKey::GameRoom(room_id))
    }
}

// ── PlayerState ──────────────────────────────────────────────────────────────

/// Per-player state inside a room. Persisted at
/// `DataKey::PlayerState(room_id, player)`.
///
/// `hand_commitment` is the Poseidon2 hash of `(hand, salt)`; the chain
/// never sees the raw cards. `card_count` is the publicly-tracked number
/// of cards (the source of truth for win/lose and Zuno timing), kept in
/// sync with the off-chain hand via ZK proofs.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PlayerState {
    pub room_id: u64,
    pub player: Address,
    /// BN254 field element — 32 bytes of a Poseidon2 commitment.
    pub hand_commitment: BytesN<32>,
    pub card_count: u32,
    pub has_called_zuno: bool,
}

impl PlayerState {
    /// Persist this player state and refresh its storage TTL.
    pub fn save(&self, env: &Env) {
        let key = DataKey::PlayerState(self.room_id, self.player.clone());
        env.storage().persistent().set(&key, self);
        env.storage()
            .persistent()
            .extend_ttl(&key, 5_000_000, 10_000_000);
    }

    /// Load a player's state for a given room. Returns `None` if the
    /// player has not joined (or their state has been archived).
    pub fn load(env: &Env, room_id: u64, player: &Address) -> Option<Self> {
        env.storage()
            .persistent()
            .get::<DataKey, Self>(&DataKey::PlayerState(room_id, player.clone()))
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ZunoContract;
    use soroban_sdk::testutils::Address as _;

    fn make_card(color: u32, value: u32, is_wild: bool) -> Card {
        Card { color, value, is_wild }
    }

    fn build_env() -> Env {
        Env::default()
    }

    /// Run `f` with a registered ZunoContract as the current contract
    /// context. `state::save` / `state::load` touch
    /// `env.storage().persistent()`, which requires a contract to be
    /// running.
    fn with_contract<F: FnOnce(&Env)>(f: F) {
        let env = Env::default();
        let addr = env.register_contract(None, ZunoContract);
        env.as_contract(&addr, || f(&env));
    }

    #[test]
    fn test_advance_turn_wraps_forward() {
        let env = build_env();
        let host = Address::generate(&env);
        let p2 = Address::generate(&env);
        let p3 = Address::generate(&env);

        let mut room = GameRoom {
            host: host.clone(),
            status: GameStatus::Active,
            stake_amount: 0,
            pot: 0,
            players: Vec::from_array(&env, [host.clone(), p2.clone(), p3.clone()]),
            current_turn: 0,
            top_card: make_card(0, 1, false),
            deck_root: BytesN::from_array(&env, &[0u8; 32]),
            turn_deadline: 0,
            flow_direction: 1,
            verifier_contract: Address::generate(&env),
            xlm_token: Address::generate(&env),
            commit_reveal_seed: None,
        };

        room.advance_turn();
        assert_eq!(room.current_turn, 1);
        room.advance_turn();
        assert_eq!(room.current_turn, 2);
        room.advance_turn();
        assert_eq!(room.current_turn, 0); // wraps back to host
    }

    #[test]
    fn test_advance_turn_wraps_backward() {
        let env = build_env();
        let host = Address::generate(&env);
        let p2 = Address::generate(&env);
        let p3 = Address::generate(&env);

        let mut room = GameRoom {
            host: host.clone(),
            status: GameStatus::Active,
            stake_amount: 0,
            pot: 0,
            players: Vec::from_array(&env, [host.clone(), p2.clone(), p3.clone()]),
            current_turn: 0,
            top_card: make_card(0, 1, false),
            deck_root: BytesN::from_array(&env, &[0u8; 32]),
            turn_deadline: 0,
            flow_direction: -1,
            verifier_contract: Address::generate(&env),
            xlm_token: Address::generate(&env),
            commit_reveal_seed: None,
        };

        // direction = -1, so from 0 we go to 2 (last player)
        room.advance_turn();
        assert_eq!(room.current_turn, 2);
        room.advance_turn();
        assert_eq!(room.current_turn, 1);
    }

    #[test]
    fn test_skip_turn_advances_two() {
        let env = build_env();
        let host = Address::generate(&env);
        let p2 = Address::generate(&env);
        let p3 = Address::generate(&env);

        let mut room = GameRoom {
            host: host.clone(),
            status: GameStatus::Active,
            stake_amount: 0,
            pot: 0,
            players: Vec::from_array(&env, [host.clone(), p2.clone(), p3.clone()]),
            current_turn: 0,
            top_card: make_card(0, 1, false),
            deck_root: BytesN::from_array(&env, &[0u8; 32]),
            turn_deadline: 0,
            flow_direction: 1,
            verifier_contract: Address::generate(&env),
            xlm_token: Address::generate(&env),
            commit_reveal_seed: None,
        };

        room.skip_turn();
        // 0 -> 1 -> 2
        assert_eq!(room.current_turn, 2);
    }

    #[test]
    fn test_reverse_direction_with_three_players_flips_order() {
        let env = build_env();
        let host = Address::generate(&env);
        let p2 = Address::generate(&env);
        let p3 = Address::generate(&env);

        let mut room = GameRoom {
            host: host.clone(),
            status: GameStatus::Active,
            stake_amount: 0,
            pot: 0,
            players: Vec::from_array(&env, [host.clone(), p2.clone(), p3.clone()]),
            current_turn: 0,
            top_card: make_card(0, 1, false),
            deck_root: BytesN::from_array(&env, &[0u8; 32]),
            turn_deadline: 0,
            flow_direction: 1,
            verifier_contract: Address::generate(&env),
            xlm_token: Address::generate(&env),
            commit_reveal_seed: None,
        };

        // Play Reverse on turn 0: direction flips, then advance.
        // direction was 1, becomes -1, then advance from 0 -> 2.
        room.reverse_direction();
        assert_eq!(room.flow_direction, -1);
        assert_eq!(room.current_turn, 2);
    }

    #[test]
    fn test_active_player_returns_correct_address() {
        let env = build_env();
        let host = Address::generate(&env);
        let p2 = Address::generate(&env);
        let p3 = Address::generate(&env);

        let room = GameRoom {
            host: host.clone(),
            status: GameStatus::Active,
            stake_amount: 0,
            pot: 0,
            players: Vec::from_array(&env, [host.clone(), p2.clone(), p3.clone()]),
            current_turn: 1,
            top_card: make_card(0, 1, false),
            deck_root: BytesN::from_array(&env, &[0u8; 32]),
            turn_deadline: 0,
            flow_direction: 1,
            verifier_contract: Address::generate(&env),
            xlm_token: Address::generate(&env),
            commit_reveal_seed: None,
        };

        assert_eq!(room.active_player(), Some(p2));
    }

    #[test]
    fn test_save_and_load_round_trip() {
        with_contract(|env| {
            let room_id: u64 = 42;
            let host = Address::generate(env);

            let room = GameRoom {
                host: host.clone(),
                status: GameStatus::Waiting,
                stake_amount: 1_000_000,
                pot: 0,
                players: Vec::from_array(env, [host.clone()]),
                current_turn: 0,
                top_card: make_card(0, 5, false),
                deck_root: BytesN::from_array(env, &[0u8; 32]),
                turn_deadline: 0,
                flow_direction: 1,
                verifier_contract: Address::generate(env),
                xlm_token: Address::generate(env),
                commit_reveal_seed: None,
            };

            room.save(env, room_id);
            let loaded = GameRoom::load(env, room_id).expect("room should exist");
            assert_eq!(loaded.host, host);
            assert_eq!(loaded.stake_amount, 1_000_000);
            assert_eq!(loaded.status, GameStatus::Waiting);
        });
    }

    #[test]
    fn test_load_missing_room_returns_none() {
        with_contract(|env| {
            let result = GameRoom::load(env, 9_999);
            assert!(result.is_none());
        });
    }

    #[test]
    fn test_player_state_save_and_load() {
        with_contract(|env| {
            let player = Address::generate(env);
            let commitment = BytesN::from_array(
                env,
                &[
                    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
                    22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
                ],
            );

            let ps = PlayerState {
                room_id: 7,
                player: player.clone(),
                hand_commitment: commitment.clone(),
                card_count: 7,
                has_called_zuno: false,
            };

            ps.save(env);

            let loaded = PlayerState::load(env, 7, &player).expect("state should exist");
            assert_eq!(loaded.card_count, 7);
            assert!(!loaded.has_called_zuno);
            assert_eq!(loaded.hand_commitment, commitment);
        });
    }
}
