use soroban_sdk::{Address, Bytes, Env, Symbol, testutils::Address as _};

use crate::constants::SEED_SIZE;
use crate::error::ZunoError;
use crate::state::{Card, GameRoom, GameStatus};

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
    // PHASE 2 TODO: replace with `poseidon2(seed_reveal) ==
    // commit_reveal_seed` once the Poseidon2 host function is wired
    // (Stellar Protocol 25 added it but the on-chain verifier is not
    // yet available at the time of writing). For now we treat the
    // stored `commit_reveal_seed` as the actual seed.
    let stored_seed = room.commit_reveal_seed.clone().unwrap_or_else(|| {
        BytesN::from_array(&env, &[0u8; 32])
    });
    let mut reveal_arr = [0u8; 32];
    seed_reveal.copy_into_slice(&mut reveal_arr);
    let reveal_bytes: BytesN<32> = BytesN::from_array(&env, &reveal_arr);
    if reveal_bytes != stored_seed {
        return Err(ZunoError::InvalidSeed);
    }

    // ── Derive the deck root and top card from the seed ──────────────
    //
    // PHASE 2: replace with `env.crypto().poseidon2_hash(&[seed, ledger_sequence])`
    // and pick the top card from the first 2 bytes of that hash. For
    // now we use the first 2 bytes of the seed itself — this is fine
    // for Phase 1 (the deck_root is the placeholder zero anyway, since
    // no real ZK proofs reference it yet).
    let top_color = reveal_arr[0] % 4;
    let top_value = reveal_arr[1] % 10;

    // Compute deck_root as Poseidon2 hash of seed + ledger_sequence
    let ls = env.ledger_sequence();
    let mut ls_arr = [0u8; 32];
    ls_arr[..8].copy_from_slice(&ls.to_be_bytes());
    let ls_bytes = BytesN::<32>::from_array(&env, &ls_arr);
    let deck_root = env.crypto().poseidon2_hash(&[seed_reveal.clone(), ls_bytes.clone()])?;
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
    use soroban_sdk::{testutils::Address as _, token, Bytes, Env, Symbol, testutils::Val as _};
    use super::*;

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
    fn setup_env() -> (Env, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        env.mock_all_auths_allowing_non_root_auth();

        let admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(admin);
        let token_addr = sac.address();

        let zuno_addr = env.register_contract(None, ZunoContract);
        let host = Address::generate(&env);
        let verifier = Address::generate(&env);
        let admin_funding = Address::generate(&env);
        env.fund_known_stellar_account(admin_funding);

        Ok((env, zuno_addr, token_addr, admin_funding, verifier))
    }

    /// Creates a Waiting‑status room that contains at least the host.
    fn create_waiting_room(
        env: &Env,
        zuno_addr: &Address,
        host: &Address,
        token_addr: &Address,
        verifier: &Address,
    ) -> u64 {
        let room_id: u64 = 1;
        let stake: i128 = 1_000_000;
        // Simple seed – all zeroes works for length check
        let seed = Bytes::from_array(&env, &[0u8; 32]);
        env.as_contract(zuno_addr, || {
            initialize_room::handler(
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
        room_id
    }

    #[test]
    fn test_reveal_randomness_happy() {
        let (env, zuno_addr, token_addr, _admin_funding, verifier) = setup_env().unwrap();

        // Fund the host and create a room in Waiting status
        let host = Address::generate(&env);
        mint(&env, &token_addr, &host, &PLAYER_FUNDING);
        let room_id = create_waiting_room(&env, &zuno_addr, &host, &token_addr, &verifier);

        // Move the room to AwaitingReveal by calling start_game as the host
        env.as_contract(&zuno_addr, || {
            start_game::handler(env.clone(), host.clone(), room_id);
        });

        // Prepare a valid reveal: copy the stored commitment (here all zeros)
        let seed_reveal = Bytes::from_array(&env, &[0u8; 32]);

        // Execute reveal_randomness and ensure it returns Ok
        env.as_contract(&zuno_addr, || {
            let result = reveal_randomness::handler(
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
        let (env, zuno_addr, token_addr, _admin_funding, verifier) = setup_env().unwrap();

        // Fund two different accounts: host and attacker
        let host = Address::generate(&env);
        let attacker = Address::generate(&env);
        mint(&env, &token_addr, &host, &PLAYER_FUNDING);
        mint(&env, &token_addr, &attacker, &PLAYER_FUNDING);

        // Create a room with `host` as the registered host
        let room_id = create_waiting_room(&env, &zuno_addr, &host, &token_addr, &verifier);

        // Advance status to AwaitingReveal
        env.as_contract(&zuno_addr, || {
            start_game::handler(env.clone(), host.clone(), room_id);
        });

        // Attacker tries to call reveal_randomness – should get NotHost
        env.as_contract(&zuno_addr, || {
            let result = reveal_randomness::handler(
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
        let (env, zuno_addr, token_addr, _admin_funding, verifier) = setup_env().unwrap();

        let host = Address::generate(&env);
        mint(&env, &token_addr, &host, &PLAYER_FUNDING);
        let room_id = create_waiting_room(&env, &zuno_addr, &host, &token_addr, &verifier);

        env.as_contract(&zuno_addr, || {
            start_game::handler(env.clone(), host, room_id);
        });

        // Provide a seed of wrong length (here 0 bytes)
        let wrong_len_seed = Bytes::new(&env);
        env.as_contract(&zuno_addr, || {
            let result = reveal_randomness::handler(
                env.clone(),
                host,
                room_id,
                wrong_len_seed,
            );
            assert_eq!(result, Err(ZunoError::InvalidSeed));
        });
    }

    #[test]