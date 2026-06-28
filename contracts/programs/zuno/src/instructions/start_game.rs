//! `start_game` — first step of the commit-reveal randomness flow.
//!
//! The host calls this to signal that the lobby is closed and the
//! game is about to begin. The room transitions from `Waiting` to
//! `AwaitingReveal`.
//!
//! The host then calls `reveal_randomness` to disclose the seed they
//! committed during `initialize_room`. Splitting the two steps lets
//! other players (and the chain itself) observe that the seed
//! commitment was locked in BEFORE the deck is dealt — preventing
//! the host from biasing the shuffle after seeing the other players'
//! initial hand commitments.

use soroban_sdk::{Address, Env, Symbol};

use crate::error::ZunoError;
use crate::state::{GameRoom, GameStatus};

const TOPIC_GAME_STARTING: &str = "game_starting";

pub fn handler(env: Env, host: Address, room_id: u64) -> Result<(), ZunoError> {
    // ── Auth: the host authorises the start ──────────────────────────
    host.require_auth();

    // ── Load state ────────────────────────────────────────────────────
    let mut room = GameRoom::load(&env, room_id).ok_or(ZunoError::RoomNotFound)?;

    // ── Validate ──────────────────────────────────────────────────────
    if room.host != host {
        return Err(ZunoError::NotHost);
    }
    if room.status != GameStatus::Waiting {
        return Err(ZunoError::GameAlreadyStarted);
    }
    if room.players.len() < 2 {
        return Err(ZunoError::NotEnoughPlayers);
    }

    // ── Update state ──────────────────────────────────────────────────
    room.status = GameStatus::AwaitingReveal;
    room.save(&env, room_id);

    // ── Emit GameStarting event ─────────────────────────────────────
    env.events().publish(
        (Symbol::new(&env, TOPIC_GAME_STARTING), host.clone()),
        (room_id, room.players.len() as u32),
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use soroban_sdk::{testutils::Address as _, Bytes, Env, IntoVal, Symbol, Val, Vec};
    use super::*;
    use crate::instructions::initialize_room::handler as initialize_handler;
    use crate::ZunoContract;

    const PLAYER_FUNDING: i128 = 100_000_000_000;

    fn mint(env: &Env, token_addr: &Address, to: &Address, amount: &i128) {
        let args: Vec<Val> = (to.clone(), amount.clone()).into_val(env);
        env.invoke_contract::<Val>(token_addr, &Symbol::new(env, "mint"), args);
    }

    fn setup_with_host() -> (Env, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        env.mock_all_auths_allowing_non_root_auth();

        let admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(admin);
        let token_addr = sac.address();

        let zuno_addr = env.register(ZunoContract, ());
        let host = Address::generate(&env);

        (env, zuno_addr, token_addr, host)
    }

    #[test]
    fn test_start_game_happy() {
        let (env, zuno_addr, token_addr, host) = setup_with_host();
        mint(&env, &token_addr, &host, &PLAYER_FUNDING);

        let room_id: u64 = 1;
        let stake: i128 = 1_000_000;
        let mut seed_arr = [0u8; 32];
        seed_arr[0] = 0xAB;
        let seed = Bytes::from_array(&env, &seed_arr);
        let verifier = Address::generate(&env);

        env.as_contract(&zuno_addr, || {
            initialize_handler(
                env.clone(),
                host.clone(),
                room_id,
                stake,
                token_addr.clone(),
                verifier.clone(),
                seed,
            )
            .expect("room creation should succeed");
        });

        // Single player → must be NotEnoughPlayers (sanity check the setup).
        env.as_contract(&zuno_addr, || {
            let result = handler(env.clone(), host.clone(), room_id);
            assert_eq!(result, Err(ZunoError::NotEnoughPlayers));
        });
    }

    #[test]
    fn test_start_game_not_host() {
        let (env, zuno_addr, token_addr, host) = setup_with_host();
        let attacker = Address::generate(&env);
        mint(&env, &token_addr, &attacker, &PLAYER_FUNDING);

        // Create a room with `host` as the registered host
        let room_id: u64 = 2;
        let stake: i128 = 1_000_000;
        let seed = Bytes::from_array(&env, &[0u8; 32]);
        let verifier = Address::generate(&env);
        mint(&env, &token_addr, &host, &PLAYER_FUNDING);
        env.as_contract(&zuno_addr, || {
            initialize_handler(
                env.clone(),
                host.clone(),
                room_id,
                stake,
                token_addr.clone(),
                verifier,
                seed,
            )
            .expect("room creation should succeed");
        });

        // Attacker tries to call start_game – should get NotHost
        env.as_contract(&zuno_addr, || {
            let result = handler(env.clone(), attacker, room_id);
            assert_eq!(result, Err(ZunoError::NotHost));
        });
    }

    #[test]
    fn test_start_game_game_not_waiting() {
        // Set up a room and then manually flip its status to Active
        let (env, zuno_addr, token_addr, host) = setup_with_host();
        mint(&env, &token_addr, &host, &PLAYER_FUNDING);

        let room_id: u64 = 3;
        let stake: i128 = 1_000_000;
        let seed = Bytes::from_array(&env, &[0u8; 32]);
        let verifier = Address::generate(&env);

        env.as_contract(&zuno_addr, || {
            initialize_handler(
                env.clone(),
                host.clone(),
                room_id,
                stake,
                token_addr.clone(),
                verifier,
                seed,
            )
            .expect("room creation should succeed");
        });

        // Manually set status to Active
        env.as_contract(&zuno_addr, || {
            let mut room = GameRoom::load(&env, room_id).unwrap();
            room.status = GameStatus::Active;
            room.save(&env, room_id);
        });

        // Now try start_game again – should Err(GameAlreadyStarted)
        env.as_contract(&zuno_addr, || {
            let result = handler(env.clone(), host.clone(), room_id);
            assert_eq!(result, Err(ZunoError::GameAlreadyStarted));
        });
    }

    #[test]
    fn test_start_game_not_enough_players() {
        let (env, zuno_addr, token_addr, host) = setup_with_host();
        mint(&env, &token_addr, &host, &PLAYER_FUNDING);

        // Create a room with only the host (no second player)
        let room_id: u64 = 4;
        let stake: i128 = 1_000_000;
        let seed = Bytes::from_array(&env, &[0u8; 32]);
        let verifier = Address::generate(&env);

        env.as_contract(&zuno_addr, || {
            initialize_handler(
                env.clone(),
                host.clone(),
                room_id,
                stake,
                token_addr.clone(),
                verifier,
                seed,
            )
            .expect("room creation should succeed");
        });

        // Try to start the game – should return NotEnoughPlayers
        env.as_contract(&zuno_addr, || {
            let result = handler(env.clone(), host.clone(), room_id);
            assert_eq!(result, Err(ZunoError::NotEnoughPlayers));
        });
    }
}
