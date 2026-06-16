use soroban_sdk::{token, Address, Bytes, BytesN, Env, Vec};

use crate::constants::SEED_SIZE;
use crate::error::ZunoError;
use crate::state::{Card, GameRoom, GameStatus};

/// Create a new game room. The host becomes the first player and pays
/// their own `stake_amount` in XLM stroops.
///
/// `seed_commitment` is the host's commit-reveal commitment (a
/// Poseidon2 hash of a random 32-byte seed). The actual seed is
/// revealed later via `start_game` — this prevents the host from
/// biasing the deck shuffle after seeing the other players' hands.
/// The commitment is stored on the `GameRoom` for the host to
/// disclose in `start_game`.
///
/// Storage: writes a new `GameRoom` at `DataKey::GameRoom(room_id)`.
///
/// Auth: the host must `require_auth` to spend their own XLM.
pub fn handler(
    env: Env,
    host: Address,
    room_id: u64,
    stake_amount: i128,
    xlm_token: Address,
    verifier_contract: Address,
    seed_commitment: Bytes,
) -> Result<(), ZunoError> {
    // ── Validate args ───────────────────────────────────────────────────
    if stake_amount <= 0 {
        return Err(ZunoError::Overflow);
    }
    if seed_commitment.len() != SEED_SIZE as u32 {
        return Err(ZunoError::InvalidSeed);
    }

    // ── Auth: host authorises the XLM spend ─────────────────────────────
    host.require_auth();

    // ── Reject duplicate room IDs ───────────────────────────────────────
    if GameRoom::load(&env, room_id).is_some() {
        return Err(ZunoError::GameAlreadyStarted);
    }

    // ── Transfer stake from host to the contract's own balance ──────────
    token::Client::new(&env, &xlm_token).transfer(&host, &env.current_contract_address(), &stake_amount);

    // ── Build the empty top card placeholder ────────────────────────────
    // (Replaced with a real top card in `start_game` once the deck is
    // committed.) We still need a non-wild placeholder so that any
    // accidental early-state read doesn't claim a wild is on top.
    let placeholder_top = Card { color: 0, value: 0, is_wild: false };

    // ── Convert the host's seed commitment to a fixed-size array ────────
    // The `Bytes` length check above guarantees we have exactly 32 bytes.
    let mut arr = [0u8; 32];
    seed_commitment.copy_into_slice(&mut arr);
    let seed_bytes: BytesN<32> = BytesN::from_array(&env, &arr);

    // ── Build the player list with the host as player 0 ────────────────
    let players: Vec<Address> = Vec::from_array(&env, [host.clone()]);

    // ── Build the room ──────────────────────────────────────────────────
    // The deck_root is a zero placeholder — the real root is computed
    // from the host's revealed seed in `start_game`.
    let room = GameRoom {
        host: host.clone(),
        status: GameStatus::Waiting,
        stake_amount,
        pot: stake_amount,
        players,
        current_turn: 0,
        top_card: placeholder_top,
        deck_root: BytesN::from_array(&env, &[0u8; 32]),
        turn_deadline: 0,
        flow_direction: 1,
        verifier_contract,
        xlm_token: xlm_token.clone(),
        commit_reveal_seed: Some(seed_bytes),
    };
    room.save(&env, room_id);

    Ok(())
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use soroban_sdk::{testutils::Address as _, token, Bytes, Env, IntoVal, Symbol, Val, Vec};

    use super::*;
    use crate::state::GameStatus;
    use crate::ZunoContract;

    /// Mint `amount` of the SAC token at `token_addr` to `to`. The
    /// SAC's `mint` function is admin-gated; we use `env.mock_all_auths`
    /// in the test setup so the admin requirement is satisfied.
    ///
    /// **Caller must wrap this in `env.as_contract(&zuno_addr, ...)`.**
    /// The SAC rejects re-entry into itself, so the running contract
    /// during the `mint` invocation must be our own ZunoContract, not
    /// the SAC. We also need non-root auth mocking enabled for the
    /// admin auth to be accepted from a nested context.
    fn mint(env: &Env, token_addr: &Address, to: &Address, amount: &i128) {
        let args: Vec<Val> = (to.clone(), amount.clone()).into_val(env);
        env.invoke_contract::<Val>(token_addr, &Symbol::new(env, "mint"), args);
    }

    /// Set up an `Env` with the SAC + ZunoContract registered and the
    /// ZunoContract as the currently-running contract, so that storage
    /// ops and `as_contract`-context-requiring invocations both work.
    fn setup_env() -> (Env, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        // The SAC `mint` happens inside our `as_contract` block (a
        // nested invocation), so the admin's auth would otherwise be
        // rejected as non-root. Allow it.
        env.mock_all_auths_allowing_non_root_auth();

        // Register a SAC for the test token. The admin is allowed to mint.
        let admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(admin);
        let token_addr = sac.address();

        // Register our contract so we can run as it.
        let zuno_addr = env.register_contract(None, ZunoContract);
        let host = Address::generate(&env);

        (env, zuno_addr, token_addr, host)
    }

    /// Variant of `setup_env` that mints HOST_FUNDING to a host and
    /// returns the host. Use when the test needs a funded host.
    fn setup_with_host() -> (Env, Address, Address, Address) {
        let (env, zuno_addr, token_addr, host) = setup_env();
        env.as_contract(&zuno_addr, || {
            mint(&env, &token_addr, &host, &100_000_000_000);
        });
        (env, zuno_addr, token_addr, host)
    }

    fn seed_commitment(env: &Env) -> Bytes {
        // 32 arbitrary bytes. The contract only checks length.
        Bytes::from_array(env, &[7u8; 32])
    }

    #[test]
    fn test_initialize_room_creates_room_with_host_first_player() {
        let (env, zuno_addr, token_addr, host) = setup_with_host();
        let verifier = Address::generate(&env);
        let room_id: u64 = 1;
        let stake: i128 = 1_000_000; // 0.1 XLM

        env.as_contract(&zuno_addr, || {
            let result = handler(
                env.clone(),
                host.clone(),
                room_id,
                stake,
                token_addr.clone(),
                verifier.clone(),
                seed_commitment(&env),
            );
            assert_eq!(result, Ok(()));

            let room = GameRoom::load(&env, room_id).expect("room should be persisted");
            assert_eq!(room.host, host);
            assert_eq!(room.status, GameStatus::Waiting);
            assert_eq!(room.stake_amount, stake);
            assert_eq!(room.pot, stake);
            assert_eq!(room.players.len(), 1);
            assert_eq!(room.players.get(0), Some(host.clone()));
            assert_eq!(room.current_turn, 0);
            assert_eq!(room.xlm_token, token_addr);
            assert_eq!(room.verifier_contract, verifier);
            assert_eq!(room.flow_direction, 1);
        });
    }

    #[test]
    fn test_initialize_room_transfers_stake_to_contract() {
        let (env, zuno_addr, token_addr, host) = setup_with_host();
        let verifier = Address::generate(&env);
        let room_id: u64 = 2;
        let stake: i128 = 1_500_000;

        env.as_contract(&zuno_addr, || {
            let host_balance_before = token::Client::new(&env, &token_addr).balance(&host);

            handler(
                env.clone(),
                host.clone(),
                room_id,
                stake,
                token_addr.clone(),
                verifier,
                seed_commitment(&env),
            )
            .unwrap();

            let token_client = token::Client::new(&env, &token_addr);
            let host_balance_after = token_client.balance(&host);
            let contract_balance = token_client.balance(&env.current_contract_address());

            assert_eq!(host_balance_before - host_balance_after, stake);
            assert_eq!(contract_balance, stake);
            assert_eq!(GameRoom::load(&env, room_id).unwrap().pot, stake);
        });
    }

    #[test]
    fn test_initialize_room_rejects_zero_stake() {
        let (env, zuno_addr, token_addr, host) = setup_with_host();
        let verifier = Address::generate(&env);
        let room_id: u64 = 3;

        env.as_contract(&zuno_addr, || {
            let result = handler(
                env.clone(),
                host,
                room_id,
                0, // zero stake
                token_addr,
                verifier,
                seed_commitment(&env),
            );
            assert_eq!(result, Err(ZunoError::Overflow));
            assert!(GameRoom::load(&env, room_id).is_none());
        });
    }

    #[test]
    fn test_initialize_room_rejects_negative_stake() {
        let (env, zuno_addr, token_addr, host) = setup_with_host();
        let verifier = Address::generate(&env);
        let room_id: u64 = 4;

        env.as_contract(&zuno_addr, || {
            let result = handler(
                env.clone(),
                host,
                room_id,
                -1,
                token_addr,
                verifier,
                seed_commitment(&env),
            );
            assert_eq!(result, Err(ZunoError::Overflow));
            assert!(GameRoom::load(&env, room_id).is_none());
        });
    }

    #[test]
    fn test_initialize_room_rejects_wrong_seed_length() {
        let (env, zuno_addr, token_addr, host) = setup_with_host();
        let verifier = Address::generate(&env);
        let room_id: u64 = 5;

        env.as_contract(&zuno_addr, || {
            // 16 bytes instead of 32.
            let bad_seed = Bytes::from_array(&env, &[1u8; 16]);
            let result = handler(
                env.clone(),
                host,
                room_id,
                1_000_000,
                token_addr,
                verifier,
                bad_seed,
            );
            assert_eq!(result, Err(ZunoError::InvalidSeed));
            assert!(GameRoom::load(&env, room_id).is_none());
        });
    }

    #[test]
    fn test_initialize_room_rejects_duplicate_room_id() {
        let (env, zuno_addr, token_addr, host) = setup_with_host();
        let verifier = Address::generate(&env);
        let room_id: u64 = 6;
        let stake: i128 = 1_000_000;

        env.as_contract(&zuno_addr, || {
            handler(
                env.clone(),
                host.clone(),
                room_id,
                stake,
                token_addr.clone(),
                verifier.clone(),
                seed_commitment(&env),
            )
            .unwrap();

            // Second call with the same room_id and a fresh host.
            let host2 = Address::generate(&env);
            mint(&env, &token_addr, &host2, &stake);

            let result = handler(
                env.clone(),
                host2,
                room_id,
                stake,
                token_addr,
                verifier,
                seed_commitment(&env),
            );
            assert_eq!(result, Err(ZunoError::GameAlreadyStarted));
        });
    }

    #[test]
    fn test_initialize_room_stores_seed_commitment() {
        let (env, zuno_addr, token_addr, host) = setup_with_host();
        let verifier = Address::generate(&env);
        let room_id: u64 = 7;
        let stake: i128 = 1_000_000;

        // Use a recognisable seed so we can verify it was stored
        // byte-for-byte.
        let mut seed_arr = [0u8; 32];
        for (i, b) in seed_arr.iter_mut().enumerate() {
            *b = i as u8;
        }
        let seed = Bytes::from_array(&env, &seed_arr);

        env.as_contract(&zuno_addr, || {
            handler(
                env.clone(),
                host,
                room_id,
                stake,
                token_addr,
                verifier,
                seed,
            )
            .unwrap();

            let room = GameRoom::load(&env, room_id).unwrap();
            let stored = room.commit_reveal_seed.expect("seed must be set");
            let stored_arr: [u8; 32] = stored.into();
            assert_eq!(stored_arr, seed_arr);
        });
    }
}
