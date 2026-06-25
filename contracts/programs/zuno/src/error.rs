use soroban_sdk::contracterror;

/// All errors that the Zuno contract can return.
///
/// Each variant maps to a u32 error code. Soroban does not have
/// structured `#[msg(...)]` strings the way Anchor does — error context
/// is emitted by the host environment. Keep this list in sync with the
/// `ZunoError` variants referenced by the instruction handlers.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ZunoError {
    /// The action was attempted by an account that does not currently
    /// hold the turn.
    NotYourTurn = 1,

    /// The room exists but its `status` is not `Active`.
    GameNotActive = 2,

    /// The room already has `MAX_PLAYERS` players.
    GameFull = 3,

    /// The room's `status` is not `Waiting` (game has already started
    /// or finished).
    GameAlreadyStarted = 4,

    /// `start_game` was called with fewer than 2 players.
    NotEnoughPlayers = 5,

    /// A host-gated action was called by a non-host account.
    NotHost = 6,

    /// The player is already registered in the room.
    AlreadyInRoom = 7,

    /// The ZK proof failed to verify against the supplied public inputs.
    InvalidProof = 8,

    /// The verifier signature is invalid.
    InvalidSignature = 24,

    /// `play_card` / `draw_card` was called after the turn deadline
    /// had already elapsed.
    TurnExpired = 9,

    /// `force_skip` was called before the turn deadline had elapsed.
    TurnNotExpired = 10,

    /// `call_zuno` was called when the player does not have exactly
    /// 2 cards.
    ZunoRequiresTwoCards = 11,

    /// `claim_victory` was called when the player does not have 0 cards.
    VictoryRequiresZeroCards = 12,

    /// `call_zuno` was called twice for the same round.
    AlreadyCalledZuno = 13,

    /// `punish_zuno` was called with `caller == offender`.
    CannotPunishSelf = 14,

    /// `punish_zuno` was called against a player who has called Zuno
    /// or has more than 1 card.
    PunishNotApplicable = 15,

    /// The played card does not match color, value, or wild against
    /// the current top card.
    InvalidCard = 16,

    /// Arithmetic overflow / underflow on `pot`, `card_count`, etc.
    Overflow = 17,

    /// The commit-reveal seed has not been revealed yet
    /// (kept for parity with the old `VrfNotReady` variant).
    SeedNotReady = 18,

    /// The supplied `hand_commitment` does not match the on-chain state.
    InvalidHandCommitment = 19,

    /// The public inputs supplied to the verifier contract do not match
    /// the expected layout/length.
    PublicInputMismatch = 20,

    /// The host attempted to commit / reveal with a seed of the wrong
    /// size.
    InvalidSeed = 21,

    /// The supplied room ID does not correspond to an existing room.
    RoomNotFound = 22,

    /// The Stellar token transfer (XLM stake / payout) failed.
    TokenTransferFailed = 23,

    /// The verifier signature is invalid.
    InvalidSignature = 24,
}
