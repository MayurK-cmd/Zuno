use soroban_sdk::{token, Address, Env};

use crate::error::ZunoError;
use crate::state::{DataKey, GameRoom, GameStatus, PlayerState};

/// Claim the pot when your hand reaches 0 cards. The contract:
///   - verifies the room is in `Active` state
///   - verifies the winner's `card_count == 0`
///   - verifies the winner is actually a registered player in the room
///   - transfers the entire XLM pot from the contract balance to the
///     winner
///   - flips the room to `Finished`
///   - removes the winner's `PlayerState` (hand_hash is now public-zero)
///
/// **Trust assumption (hackathon scope):** the contract does not
/// re-verify `card_count == 0` with a ZK proof — it trusts the
/// `card_count` field that was tracked through the preceding
/// `play_card` / `draw_card` invocations. A real production contract
/// would also require a "final hand proof" showing the player has
/// 0 cards committed in their hand.
pub fn handler(env: Env, winner: Address, room_id: u64) -> Result<(), ZunoError> {
    // ── Auth: the winner authorises the payout ────────────────────────
    winner.require_auth();

    // ── Load state ────────────────────────────────────────────────────
    let mut room = GameRoom::load(&env, room_id).ok_or(ZunoError::RoomNotFound)?;
    let ps = PlayerState::load(&env, room_id, &winner).ok_or(ZunoError::RoomNotFound)?;

    // ── Validate ──────────────────────────────────────────────────────
    if room.status != GameStatus::Active {
        return Err(ZunoError::GameNotActive);
    }
    if !room.players.contains(&winner) {
        return Err(ZunoError::RoomNotFound);
    }
    if ps.card_count != 0 {
        return Err(ZunoError::VictoryRequiresZeroCards);
    }

    // ── Pay out the pot ───────────────────────────────────────────────
    let pot = room.pot;
    let xlm_token = room.xlm_token.clone();
    token::Client::new(&env, &xlm_token).transfer(
        &env.current_contract_address(),
        &winner,
        &pot,
    );

    // ── Update room state ─────────────────────────────────────────────
    room.status = GameStatus::Finished;
    room.pot = 0;
    room.save(&env, room_id);

    // ── Remove the winner's PlayerState ───────────────────────────────
    let ps_key = DataKey::PlayerState(room_id, winner);
    env.storage().persistent().remove(&ps_key);

    Ok(())
}

#[cfg(test)]
mod tests {
    use soroban_sdk::{testutils::Address as _, Bytes, Env, IntoVal, Symbol, Val, Vec};
    use super::*;
    use crate::instructions::{initialize_room::handler as initialize_handler, join_room, start_game};
    use crate::ZunoContract;

    const PLAYER_FUNDING: i128 = 100_000_000_000;

    fn mint(env: &Env, token_addr: &Address, to: &Address, amount: &i128) {
        let args: Vec<Val> = (to.clone(), amount.clone()).into_val(env);
        env.invoke_contract::<Val>(token_addr, &Symbol::new(env, "mint"), args);
    }

    /// Basic env setup: admin → SAC → funded host → ZunoContract registration.
    fn setup_env() -> (Env, Address, Address, Address) {
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

    /// Creates a room in `Waiting` with a single host player.
    fn create_waiting_room(
        env: &Env,
        zuno_addr: &Address,
        host: &Address,
        token_addr: &Address,
    ) -> u64 {
        let room_id: u64 = 1;
        let stake: i128 = 1_000_000;
        let seed = Bytes::from_array(&env, &[0u8; 32]);
        let verifier = Address::generate(&env);
        mint(&env, token_addr, host, &PLAYER_FUNDING);
        env.as_contract(zuno_addr, || {
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
        room_id
    }

    #[test]
    fn test_claim_victory_happy() {
        let (env, zuno_addr, token_addr, host) = setup_env();
        mint(&env, &token_addr, &host, &PLAYER_FUNDING);
        let room_id = create_waiting_room(&env, &zuno_addr, &host, &token_addr);

        // Add a second player and start the game.
        let player2 = Address::generate(&env);
        mint(&env, &token_addr, &player2, &PLAYER_FUNDING);
        env.as_contract(&zuno_addr, || {
            join_room::handler(env.clone(), player2.clone(), room_id).unwrap();
            start_game::handler(env.clone(), host.clone(), room_id).unwrap();
            // Force the room into Active (bypassing reveal_randomness, which
            // depends on host-known seed bytes; this test is about victory,
            // not randomness).
            let mut room = GameRoom::load(&env, room_id).unwrap();
            room.status = GameStatus::Active;
            room.save(&env, room_id);
        });

        // Directly set card_count to 0 via PlayerState save (bypass the
        // full play_card / draw_card flow for the test).
        env.as_contract(&zuno_addr, || {
            let mut ps = PlayerState::load(&env, room_id, &player2).unwrap();
            ps.card_count = 0;
            ps.save(&env);
        });

        // Winner claims the pot
        env.as_contract(&zuno_addr, || {
            handler(env.clone(), player2.clone(), room_id).unwrap();
        });

        // Verify that the room is finished
        let status = env.as_contract(&zuno_addr, || {
            GameRoom::load(&env, room_id).unwrap().status
        });
        assert_eq!(status, GameStatus::Finished);
    }

    #[test]
    fn test_claim_victory_not_active() {
        // Setup as in happy path but force the room status to Finished before
        // calling claim_victory. The winner's PlayerState is also created so
        // the load doesn't short-circuit with RoomNotFound.
        let (env, zuno_addr, token_addr, host) = setup_env();
        mint(&env, &token_addr, &host, &PLAYER_FUNDING);
        let room_id = create_waiting_room(&env, &zuno_addr, &host, &token_addr);

        // Add a second player and finish the room.
        let player2 = Address::generate(&env);
        mint(&env, &token_addr, &player2, &PLAYER_FUNDING);
        env.as_contract(&zuno_addr, || {
            join_room::handler(env.clone(), player2.clone(), room_id).unwrap();
            // Directly mark room as Finished
            let mut room = GameRoom::load(&env, room_id).unwrap();
            room.status = GameStatus::Finished;
            room.save(&env, room_id);
        });

        // attempt to claim victory – should Err(GameNotActive)
        env.as_contract(&zuno_addr, || {
            let result = handler(env.clone(), player2, room_id);
            assert_eq!(result, Err(ZunoError::GameNotActive));
        });
    }

    #[test]
    fn test_claim_victory_wrong_player() {
        // Setup normal room with host but no winner yet
        let (env, zuno_addr, token_addr, host) = setup_env();
        mint(&env, &token_addr, &host, &PLAYER_FUNDING);
        let room_id = create_waiting_room(&env, &zuno_addr, &host, &token_addr);

        // Try to claim victory as a third‑party attacker
        env.as_contract(&zuno_addr, || {
            let result = handler(env.clone(), Address::generate(&env), room_id);
            assert_eq!(result, Err(ZunoError::RoomNotFound));
        });
    }
}
