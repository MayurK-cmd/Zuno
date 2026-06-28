use soroban_sdk::{Address, Bytes, BytesN, Env, Symbol};

use crate::constants::SEED_SIZE;
use crate::error::ZunoError;
use crate::state::{Card, GameRoom, GameStatus, TURN_TIMEOUT_SECS};

const TOPIC_GAME_REVEALED: &str = "game_revealed";

pub fn handler(env: Env, host: Address, room_id: u64, seed_reveal: Bytes) -> Result<(), ZunoError> {
    // ── Auth: the host authorises the reveal ─────────────────────────
    host.require_auth();

    // ── Load state ────────────────────────────────────────────────────
    let mut room = GameRoom::load(&env, room_id).ok_or(ZunoError::RoomNotFound)?;

    // ── Validate ──────────────────────────────────────────────────────
    if room.host != host {
        return Err(ZunoError::NotHost);
    }
    if room.status != GameStatus::AwaitingReveal {
        return Err(ZunoError::SeedNotReady);
    }
    if seed_reveal.len() != SEED_SIZE as u32 {
        return Err(ZunoError::InvalidSeed);
    }

    // ── Verify the reveal matches the stored commitment ──────────────
    //
    // PHASE 2 TODO: replace with `poseidon2(seed_reveal) ==
    // commit_reveal_seed` once the Poseidon2 host function is wired
    // (Stellar Protocol 25 added it but the on-chain verifier is not
    // yet available at the time of writing). For now we treat the
    // stored `commit_reveal_seed` as the actual seed.
    let stored_seed = room
        .commit_reveal_seed
        .clone()
        .unwrap_or_else(|| BytesN::from_array(&env, &[0u8; 32]));
    let mut reveal_arr = [0u8; 32];
    seed_reveal.copy_into_slice(&mut reveal_arr);
    let reveal_bytes: BytesN<32> = BytesN::from_array(&env, &reveal_arr);
    if reveal_bytes != stored_seed {
        return Err(ZunoError::InvalidSeed);
    }

    // ── Derive the deck root and top card from the seed ──────────────
    //
    // PHASE 2: replace `env.crypto().poseidon2_hash(&[seed, ledger_seq])`
    // once the Soroban host exposes the BN254 Poseidon2 primitive. Until
    // then we use a deterministic placeholder derived from the seed bytes
    // — the deck_root is never consumed by any ZK proof in Phase 1, so
    // the placeholder is safe.
    let top_color = reveal_arr[0] % 4;
    let top_value = reveal_arr[1] % 10;

    // Synthesize a BytesN<32> deck_root from the seed bytes directly.
    // Future: swap for the real Poseidon2 hash of (seed, ledger_seq).
    let deck_root: BytesN<32> = BytesN::from_array(&env, &reveal_arr);
    room.deck_root = deck_root.clone();

    room.top_card = Card {
        color: top_color as u32,
        value: top_value as u32,
        is_wild: false,
    };
    room.status = GameStatus::Active;
    room.turn_deadline = env.ledger().timestamp() + TURN_TIMEOUT_SECS;

    // ── Persist ──────────────────────────────────────────────────────
    room.save(&env, room_id);

    // ── Emit GameRevealed event ─────────────────────────────────────
    env.events().publish(
        (Symbol::new(&env, TOPIC_GAME_REVEALED), host.clone()),
        (room_id, top_color as u32, top_value as u32),
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use soroban_sdk::{testutils::Address as _, Bytes, Env, IntoVal, Symbol, Val, Vec};
    use super::*;
    use crate::instructions::{
        initialize_room::handler as initialize_handler, join_room::handler as join_handler,
        start_game::handler as start_game_handler,
    };
    use crate::ZunoContract;

    const PLAYER_FUNDING: i128 = 100_000_000_000;

    fn mint(env: &Env, token_addr: &Address, to: &Address, amount: &i128) {
        let args: Vec<Val> = (to.clone(), amount.clone()).into_val(env);
        env.invoke_contract::<Val>(token_addr, &Symbol::new(env, "mint"), args);
    }

    /// Sets up a basic environment:
    ///   - admin account (SAC creator)
    ///   - registered SAC token
    ///   - a funded host account
    ///   - registers ZunoContract
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

    /// Creates a Waiting‑status room that contains at least the host, then
    /// adds a second player so `start_game` can succeed (it requires >= 2
    /// players). Returns the room id.
    fn create_room_with_two_players(
        env: &Env,
        zuno_addr: &Address,
        host: &Address,
        token_addr: &Address,
    ) -> u64 {
        let room_id: u64 = 1;
        let stake: i128 = 1_000_000;
        let verifier = Address::generate(env);
        let seed = Bytes::from_array(env, &[0u8; 32]);
        let player2 = Address::generate(env);
        mint(&env, token_addr, host, &PLAYER_FUNDING);
        mint(&env, token_addr, &player2, &PLAYER_FUNDING);
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
            join_handler(env.clone(), player2, room_id).expect("join should succeed");
        });
        room_id
    }

    #[test]
    fn test_reveal_randomness_happy() {
        let (env, zuno_addr, token_addr, host) = setup_env();

        let room_id = create_room_with_two_players(&env, &zuno_addr, &host, &token_addr);

        // Move the room to AwaitingReveal by calling start_game as the host
        env.as_contract(&zuno_addr, || {
            start_game_handler(env.clone(), host.clone(), room_id).unwrap();
        });

        // Prepare a valid reveal: copy the stored commitment (here all zeros)
        let seed_reveal = Bytes::from_array(&env, &[0u8; 32]);

        // Execute reveal_randomness and ensure it returns Ok
        env.as_contract(&zuno_addr, || {
            let result = handler(
                env.clone(),
                host.clone(),
                room_id,
                seed_reveal.clone(),
            );
            assert_eq!(result, Ok(()));
        });
    }

    #[test]
    fn test_reveal_randomness_not_host() {
        let (env, zuno_addr, token_addr, host) = setup_env();
        let attacker = Address::generate(&env);

        let room_id = create_room_with_two_players(&env, &zuno_addr, &host, &token_addr);

        // Advance status to AwaitingReveal
        env.as_contract(&zuno_addr, || {
            start_game_handler(env.clone(), host.clone(), room_id).unwrap();
        });

        // Attacker tries to call reveal_randomness – should get NotHost
        env.as_contract(&zuno_addr, || {
            let result = handler(
                env.clone(),
                attacker,
                room_id,
                Bytes::from_array(&env, &[0u8; 32]),
            );
            assert_eq!(result, Err(ZunoError::NotHost));
        });
    }

    #[test]
    fn test_reveal_randomness_invalid_seed_length() {
        let (env, zuno_addr, token_addr, host) = setup_env();

        let room_id = create_room_with_two_players(&env, &zuno_addr, &host, &token_addr);

        env.as_contract(&zuno_addr, || {
            start_game_handler(env.clone(), host.clone(), room_id).unwrap();
        });

        // Provide a seed of wrong length (here 0 bytes)
        let wrong_len_seed = Bytes::new(&env);
        env.as_contract(&zuno_addr, || {
            let result = handler(
                env.clone(),
                host,
                room_id,
                wrong_len_seed,
            );
            assert_eq!(result, Err(ZunoError::InvalidSeed));
        });
    }
}