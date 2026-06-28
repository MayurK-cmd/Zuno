use soroban_sdk::{token, Address, Env};

use crate::error::ZunoError;
use crate::state::{GameRoom, GameStatus, PlayerState, MAX_PLAYERS};

/// Join an open room. The player pays `stake_amount` (taken from the
/// `GameRoom`) in XLM stroops and gets a fresh `PlayerState`.
///
/// `PlayerState` is NOT yet initialised with a hand commitment here —
/// that happens off-chain after the deck is dealt (post-`start_game`).
/// Initial `card_count` is 0 and `hand_commitment` is the all-zero
/// placeholder.
///
/// Storage:
///   - mutates `GameRoom` (adds player, increments `pot`)
///   - writes a new `PlayerState` at `DataKey::PlayerState(room_id, player)`
///
/// Auth: the joining player must `require_auth` to spend their own XLM.
pub fn handler(env: Env, player: Address, room_id: u64) -> Result<(), ZunoError> {
    // ── Auth: the joining player authorises the XLM spend ─────────────
    player.require_auth();

    // ── Load the room ──────────────────────────────────────────────────
    let mut room = GameRoom::load(&env, room_id).ok_or(ZunoError::RoomNotFound)?;

    // Migration safeguard: if the original host address is missing from the players vec,
    // transfer host privileges to the next player (players[1] as per spec).
    if !room.players.contains(&room.host) {
        if let Some(new_host) = room.players.get(1) {
            room.host = new_host.clone();
        }
    }

    // ── Validate the join ─────────────────────────────────────────────
    if room.status != GameStatus::Waiting {
        return Err(ZunoError::GameAlreadyStarted);
    }
    if room.players.len() >= MAX_PLAYERS {
        return Err(ZunoError::GameFull);
    }
    if room.players.contains(&player) {
        return Err(ZunoError::AlreadyInRoom);
    }

    // ── Transfer stake from joiner to the contract's balance ──────────
    token::Client::new(&env, &room.xlm_token).transfer(
        &player,
        &env.current_contract_address(),
        &room.stake_amount,
    );

    // ── Update room state ─────────────────────────────────────────────
    room.pot = room
        .pot
        .checked_add(room.stake_amount)
        .ok_or(ZunoError::Overflow)?;
    room.players.push_back(player.clone());
    room.save(&env, room_id);

    // ── Create the PlayerState ────────────────────────────────────────
    let zero_commitment = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    let ps = PlayerState {
        room_id,
        player: player.clone(),
        hand_commitment: zero_commitment,
        card_count: 0,
        has_called_zuno: false,
    };
    ps.save(&env);

    Ok(())
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use soroban_sdk::{testutils::Address as _, token, Bytes, Env, IntoVal, Symbol, Val, Vec};

    use super::*;
    use crate::instructions::initialize_room;
    use crate::ZunoContract;

    // Enough for the host's stake + several joiners' stakes.
    const PLAYER_FUNDING: i128 = 100_000_000_000;

    /// Mint `amount` of the SAC token at `token_addr` to `to`.
    /// **Caller must wrap this in `env.as_contract(&zuno_addr, ...)`**
    /// — the SAC rejects re-entry into itself, so the running contract
    /// during the `mint` invocation must be our own ZunoContract.
    fn mint(env: &Env, token_addr: &Address, to: &Address, amount: &i128) {
        let args: Vec<Val> = (to.clone(), amount.clone()).into_val(env);
        env.invoke_contract::<Val>(token_addr, &Symbol::new(env, "mint"), args);
    }

    /// Set up: env with mocked auth, a SAC, ZunoContract registered, a
    /// funded host and a room already created. Returns
    /// (env, zuno_addr, host, token_addr, room_id, stake).
    fn setup_with_room() -> (Env, Address, Address, Address, u64, i128) {
        let env = Env::default();
        env.mock_all_auths();
        env.mock_all_auths_allowing_non_root_auth();

        let admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(admin);
        let token_addr = sac.address();

        let zuno_addr = env.register(ZunoContract, ());

        let host = Address::generate(&env);
        let verifier = Address::generate(&env);
        let room_id: u64 = 100;
        let stake: i128 = 1_000_000;
        let mut seed_arr = [0u8; 32];
        seed_arr[0] = 0xAB;
        let seed = Bytes::from_array(&env, &seed_arr);

        env.as_contract(&zuno_addr, || {
            mint(&env, &token_addr, &host, &PLAYER_FUNDING);

            initialize_room::handler(
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

        (env, zuno_addr, host, token_addr, room_id, stake)
    }

    #[test]
    fn test_join_room_adds_player_to_room() {
        let (env, zuno_addr, _host, token_addr, room_id, _stake) = setup_with_room();
        let joiner = Address::generate(&env);

        env.as_contract(&zuno_addr, || {
            mint(&env, &token_addr, &joiner, &PLAYER_FUNDING);

            let result = handler(env.clone(), joiner.clone(), room_id);
            assert_eq!(result, Ok(()));

            let room = GameRoom::load(&env, room_id).unwrap();
            assert_eq!(room.players.len(), 2);
            assert_eq!(room.players.get(1), Some(joiner));
        });
    }

    #[test]
    fn test_join_room_transfers_stake_to_contract() {
        let (env, zuno_addr, _host, token_addr, room_id, stake) = setup_with_room();
        let joiner = Address::generate(&env);

        env.as_contract(&zuno_addr, || {
            let token_client = token::Client::new(&env, &token_addr);
            mint(&env, &token_addr, &joiner, &PLAYER_FUNDING);

            let contract_balance_before = token_client.balance(&env.current_contract_address());
            let joiner_balance_before = token_client.balance(&joiner);

            handler(env.clone(), joiner.clone(), room_id).unwrap();

            let contract_balance_after = token_client.balance(&env.current_contract_address());
            let joiner_balance_after = token_client.balance(&joiner);

            assert_eq!(joiner_balance_before - joiner_balance_after, stake);
            assert_eq!(contract_balance_after - contract_balance_before, stake);

            let room = GameRoom::load(&env, room_id).unwrap();
            assert_eq!(room.pot, 2 * stake); // host + joiner
        });
    }

    #[test]
    fn test_join_room_creates_player_state_with_zero_cards() {
        let (env, zuno_addr, _host, token_addr, room_id, _stake) = setup_with_room();
        let joiner = Address::generate(&env);

        env.as_contract(&zuno_addr, || {
            mint(&env, &token_addr, &joiner, &PLAYER_FUNDING);

            handler(env.clone(), joiner.clone(), room_id).unwrap();

            let ps = PlayerState::load(&env, room_id, &joiner)
                .expect("player state should exist");
            assert_eq!(ps.room_id, room_id);
            assert_eq!(ps.player, joiner);
            assert_eq!(ps.card_count, 0);
            assert!(!ps.has_called_zuno);
            let commitment_bytes: [u8; 32] = ps.hand_commitment.into();
            assert_eq!(commitment_bytes, [0u8; 32]);
        });
    }

    #[test]
    fn test_join_room_rejects_unknown_room() {
        let (env, zuno_addr, _host, _token_addr, _room_id, _stake) = setup_with_room();
        let joiner = Address::generate(&env);

        env.as_contract(&zuno_addr, || {
            let result = handler(env.clone(), joiner, 9_999); // not the room we created
            assert_eq!(result, Err(ZunoError::RoomNotFound));
        });
    }

    #[test]
    fn test_join_room_rejects_already_joined_player() {
        let (env, zuno_addr, host, _token_addr, room_id, _stake) = setup_with_room();
        env.as_contract(&zuno_addr, || {
            // The host is already in the room. Re-joining must fail.
            let result = handler(env.clone(), host, room_id);
            assert_eq!(result, Err(ZunoError::AlreadyInRoom));
        });
    }

    #[test]
    fn test_join_room_rejects_duplicate_join() {
        let (env, zuno_addr, _host, token_addr, room_id, _stake) = setup_with_room();
        let joiner = Address::generate(&env);

        env.as_contract(&zuno_addr, || {
            mint(&env, &token_addr, &joiner, &PLAYER_FUNDING);
        });

        env.as_contract(&zuno_addr, || {
            handler(env.clone(), joiner.clone(), room_id).unwrap();
        });

        // Second join by the same player must fail with AlreadyInRoom.
        // Each `as_contract` block is its own auth frame, so the second
        // join can call `require_auth` fresh on the same address.
        env.as_contract(&zuno_addr, || {
            let result = handler(env.clone(), joiner, room_id);
            assert_eq!(result, Err(ZunoError::AlreadyInRoom));
        });
    }

    #[test]
    fn test_join_room_fails_after_game_start() {
        // Initialize → join → start_game (flips to AwaitingReveal).
        // A second join after that must fail with GameAlreadyStarted.
        let (env, zuno_addr, host, token_addr, room_id, _stake) = setup_with_room();
        let joiner = Address::generate(&env);

        env.as_contract(&zuno_addr, || {
            mint(&env, &token_addr, &joiner, &PLAYER_FUNDING);
            handler(env.clone(), joiner.clone(), room_id).unwrap();

            crate::instructions::start_game::handler(env.clone(), host, room_id).unwrap();
        });

        let late_joiner = Address::generate(&env);
        env.as_contract(&zuno_addr, || {
            mint(&env, &token_addr, &late_joiner, &PLAYER_FUNDING);

            let result = handler(env.clone(), late_joiner, room_id);
            assert_eq!(result, Err(ZunoError::GameAlreadyStarted));
        });
    }

    #[test]
    fn test_join_room_enforces_max_players() {
        let (env, zuno_addr, _host, token_addr, room_id, _stake) = setup_with_room();

        env.as_contract(&zuno_addr, || {
            // MAX_PLAYERS is 8. The host is already player 0. Add 7 joiners
            // to fill the room, then verify the 9th attempt fails.
            for _ in 0..7 {
                let p = Address::generate(&env);
                mint(&env, &token_addr, &p, &PLAYER_FUNDING);
                handler(env.clone(), p, room_id).unwrap();
            }

            let room = GameRoom::load(&env, room_id).unwrap();
            assert_eq!(room.players.len(), 8);

            let ninth = Address::generate(&env);
            mint(&env, &token_addr, &ninth, &PLAYER_FUNDING);
            let result = handler(env.clone(), ninth, room_id);
            assert_eq!(result, Err(ZunoError::GameFull));
        });
    }
}
