# Product Requirements Document (PRD): Zuno Blockchain Infrastructure

**Target Audience:** AI Coding Agent (Claude Code, Cursor, etc.)
**Project:** Zuno (Fully On-Chain ZK-Uno)
**Network:** Solana
**Goal:** Implement the smart contracts and zero-knowledge circuits required to run a trustless, hidden-information card game on-chain.

---

## 1. System Architecture & Tech Stack

The backend of Zuno relies on the "ZK-Solana Trinity" to achieve the Mental Poker protocol (hidden hands, trustless verification).

* **Smart Contracts:** Anchor (Rust)
* **Zero-Knowledge Circuits:** Noir (`nargo`)
* **On-Chain Verifier:** Sunspot (compiles Noir to Solana Verifier Program)
* **State Compression:** Light Protocol (to store player hand commitments affordably)
* **Randomness:** Switchboard VRF (for decentralized deck shuffling)

---

## 2. Core Mechanics & Cryptographic Flow

The fundamental problem this system solves is **Hidden State**.

1.  **Hand Commitment:** The Solana program NEVER stores a player's actual hand array. It stores a Poseidon Hash (Commitment) of the player's hand + a secret salt.
2.  **Move Validation:** To play a card, a player generates a local ZK-proof proving:
    * The card exists in their currently committed hand.
    * The card is a valid move against the public top card.
    * The new hand commitment is correctly calculated by removing the played card.
3.  **State Transition:** The Anchor program verifies the proof via the Sunspot verifier. If valid, it updates the top card and the player's new hand commitment.

---

## 3. ZK Circuit Specifications (Noir)

The AI must generate two primary Noir circuits. Use Poseidon for all hashing.

### Circuit 1: `play_card.nr`
**Inputs:**
* `public` `top_card_color`: Field
* `public` `top_card_value`: Field
* `public` `old_hand_hash`: Field
* `public` `new_hand_hash`: Field
* `private` `hand_array`: [CardStruct; 15] 
* `private` `played_card_index`: Field
* `private` `salt`: Field

**Logic constraints to write:**
* Hash `hand_array` with `salt`. Assert it equals `old_hand_hash`.
* Extract `played_card` using `played_card_index`.
* Assert `played_card.color == top_card_color` OR `played_card.value == top_card_value` OR `played_card.is_wild == true`.
* Create `new_hand_array` by zeroing out the card at `played_card_index`.
* Hash `new_hand_array` with `salt`. Assert it equals `new_hand_hash`.

### Circuit 2: `draw_card.nr`
Proves a player correctly added the encrypted top card of the deck to their hand hash without revealing the card to the network.

---

## 4. Anchor Smart Contract Specifications (Rust)

### 4.1 Data Structures

```rust
#[account]
pub struct GameRoom {
    pub host: Pubkey,
    pub status: GameStatus,
    pub buy_in: u64,
    pub pot: u64,
    pub players: Vec<Pubkey>,
    pub current_turn: u8,
    pub top_card: Card,
    pub deck_root: [u8; 32],
    pub turn_deadline: i64,
    pub flow_direction: i8,
}

#[account]
pub struct PlayerState {
    pub room: Pubkey,
    pub player: Pubkey,
    pub hand_commitment: [u8; 32],
    pub card_count: u8,
    pub has_called_zuno: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub struct Card {
    pub color: u8,
    pub value: u8,
    pub is_wild: bool,
}
```

### 4.2 Core Instructions (RPC Methods)

1.  `initialize_room`
    * Creates the `GameRoom` PDA.
    * Sets buy-in and transfers host SOL to the program vault.
2.  `join_room`
    * Transfers buy-in SOL to vault.
    * Initializes `PlayerState` PDA.
3.  `start_game`
    * Callable only by host when players > 1.
    * Triggers Switchboard VRF to generate a random seed.
    * Initializes the `deck_root` and sets the first `top_card`.
4.  `play_card`
    * Accepts the ZK Proof bytes.
    * Calls the Sunspot Verifier CPI.
    * Updates `GameRoom.top_card`.
    * Updates `PlayerState.hand_commitment` and decrements `card_count`.
    * Advances `current_turn` (handling Skip and Reverse logic based on the played card).
5.  `draw_card`
    * Accepts ZK Proof for drawing.
    * Updates `PlayerState.hand_commitment` and increments `card_count`.
6.  `call_zuno`
    * Sets `has_called_zuno` to true. Fails if `card_count` != 2.
7.  `claim_victory`
    * Callable only if `card_count` == 0.
    * Transfers the entire vault pot to the caller.
    * Closes the `GameRoom` account.

---

## 5. Security & Edge Case Handling

* **Turn Timeouts (AFK Penalty):** The `play_card` instruction must check `Clock::get()?.unix_timestamp` against `GameRoom.turn_deadline`. If a player exceeds 60 seconds, a `force_skip` instruction can be called by anyone, which increments the active player's `card_count` by 1 and advances the turn.
* **The "Catch" Mechanic:** If a player's `card_count` is 1 and `has_called_zuno` is false, any other player can call a `punish_zuno` instruction. This adds 2 cards to the offender's hand count and resets their commitment requirement.
* **Double Spend of Cards:** Handled inherently by the Noir circuit. The `old_hand_hash` must strictly match the current on-chain state, meaning stale proofs will be rejected by the Anchor program.

---

## 6. Implementation Phases for AI Agent

**Phase 1: Project Scaffolding**
* Initialize Anchor workspace.
* Initialize Noir project within the workspace.
* Set up Light Protocol SDK dependencies.

**Phase 2: Cryptography & Circuits**
* Write `play_card.nr` and compile via `nargo`.
* Generate the Solidity/Rust verifier using Sunspot.
* Write circuit tests using Noir's internal testing framework.

**Phase 3: Solana Programs**
* Implement state accounts and game loop logic in Anchor.
* Integrate the generated ZK verifier into the `play_card` instruction.
* Implement the vault logic for the SOL buy-in pot.

**Phase 4: Integration Tests**
* Write TypeScript tests utilizing `anchor test`.
* Do not mock the ZK proof generation in JS/TS to test the full on-chain flow locally.

Write code that should not have mocks.