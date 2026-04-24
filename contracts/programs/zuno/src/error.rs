use anchor_lang::prelude::*;

#[error_code]
pub enum ZunoError {
    #[msg("Not your turn")]
    NotYourTurn,
    #[msg("Game is not active")]
    GameNotActive,
    #[msg("Game is already full")]
    GameFull,
    #[msg("Game has already started")]
    GameAlreadyStarted,
    #[msg("Not enough players to start")]
    NotEnoughPlayers,
    #[msg("Only the host can perform this action")]
    NotHost,
    #[msg("Player is already in this room")]
    AlreadyInRoom,
    #[msg("ZK proof verification failed")]
    InvalidProof,
    #[msg("Turn deadline exceeded")]
    TurnExpired,
    #[msg("Turn deadline has not passed yet")]
    TurnNotExpired,
    #[msg("Must have exactly 2 cards to call Zuno")]
    ZunoRequiresTwoCards,
    #[msg("Must have 0 cards to claim victory")]
    VictoryRequiresZeroCards,
    #[msg("Player has already called Zuno")]
    AlreadyCalledZuno,
    #[msg("Player cannot punish themselves")]
    CannotPunishSelf,
    #[msg("Target player has called Zuno or has more than 1 card")]
    PunishNotApplicable,
    #[msg("Invalid card for this move")]
    InvalidCard,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("VRF result not ready")]
    VrfNotReady,
    #[msg("Invalid hand commitment")]
    InvalidHandCommitment,
    #[msg("Public input mismatch")]
    PublicInputMismatch,
}
