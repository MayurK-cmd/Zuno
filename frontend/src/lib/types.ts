/**
 * Shared TypeScript types for Zuno.
 *
 * The on-chain types follow the Soroban contract layout (see `state.rs`):
 *  - `color`: 0=Red, 1=Green, 2=Blue, 3=Yellow, 4=Wild
 *  - `value`: 0..9 for numbers, 10=Skip, 11=Reverse, 12=DrawTwo, 13=WildDrawFour
 *  - `isWild`: 0|1 marker — wilds always carry the special value 13
 *
 * ZK circuit public inputs use the same u8 representation, padded to 32-byte
 * big-endian field elements when crossing the contract boundary.
 */

/** Numeric card color as stored on chain. */
export type CardColor = 0 | 1 | 2 | 3 | 4;

/** Numeric card value: 0-9 numbers, 10 Skip, 11 Reverse, 12 DrawTwo, 13 WildDrawFour. */
export type CardValue = number;

/** A single card in the internal (numeric) representation used by circuits & contract. */
export interface Card {
  color: CardColor;
  value: CardValue;
  isWild: 0 | 1;
}

/** Soroban contract status enum. */
export type GameStatus = "Waiting" | "InProgress" | "Finished";

/** A player entry in a game room view. */
export interface GameRoomPlayer {
  address: string;
  handSize: number;
  handCommitment: string;
}

/** Parsed view of an on-chain `GameRoom`. */
export interface GameRoomView {
  host: string;
  players: GameRoomPlayer[];
  currentTurn: number;
  direction: 1 | -1;
  topCard: Card;
  pot: bigint;
  turnDeadline: number;
  gameStatus: GameStatus;
  winner?: string;
  /** Server-provided seed reveal, once the host calls `start_game`. */
  seed?: string;
}

/** Result returned by the prover worker + verifier server. */
export interface VerifiedProof {
  /** Hex-encoded ZK proof bytes (no 0x prefix). */
  proofHex: string;
  /** Hex-encoded public input field elements (no 0x prefix). */
  publicInputs: string[];
  /** Verifier server signature over the proof (hex, no 0x prefix). */
  signatureHex: string;
}

/** Which circuit the worker should execute. */
export type CircuitName = "play_card" | "draw_card";

/** Message sent to the prover Web Worker. */
export interface ProverRequest {
  action: "generate-proof";
  circuitName: CircuitName;
  witness: PlayCardWitness | DrawCardWitness;
}

/** Public + private inputs to the `play_card` circuit. */
export interface PlayCardWitness {
  top_card_color: string;
  top_card_value: string;
  old_hand_hash: string;
  new_hand_hash: string;
  played_card_color: string;
  played_card_value: string;
  played_card_is_wild: string;
  hand_array: Card[];
  played_card_index: number;
  salt: string;
}

/** Public + private inputs to the `draw_card` circuit. */
export interface DrawCardWitness {
  old_hand_hash: string;
  new_hand_hash: string;
  card_hash: string;
  slot_index: number;
  hand_array: Card[];
  drawn_card_color: string;
  drawn_card_value: string;
  salt: string;
}

/** Result returned from the prover worker. */
export type ProverResponse =
  | {
      status: "success";
      proofHex: string;
      publicInputs: string[];
    }
  | {
      status: "error";
      error: string;
    };

/** Result of a contract transaction submission. */
export interface TxResult {
  hash: string;
  status: "pending" | "success" | "failed";
  error?: string;
}
