use std::hash::poseidon2::Poseidon2;

// Represents a single UNO card.
// color: 0=Red, 1=Blue, 2=Green, 3=Yellow, 4=Wild
// value: 0-9 numbered, 10=Skip, 11=Reverse, 12=DrawTwo, 13=WildDrawFour
// is_wild: 1 if card is a wild/wild-draw-four, 0 otherwise
struct CardStruct {
    color: Field,
    value: Field,
    is_wild: Field,
}

// Flatten a hand of 15 cards + salt into a single Field array and hash it
// with Poseidon2. Zeroed-out card slots (color=0, value=0, is_wild=0) are
// included in the hash so the position of empty slots is committed.
fn hash_hand(hand: [CardStruct; 15], salt: Field) -> Field {
    let mut fields: [Field; 46] = [0; 46];
    for i in 0..15 {
        fields[i * 3]     = hand[i].color;
        fields[i * 3 + 1] = hand[i].value;
        fields[i * 3 + 2] = hand[i].is_wild;
    }
    fields[45] = salt;
    Poseidon2::hash(fields, 46)
}

// Select a card by index using a linear scan so the circuit stays
// index-agnostic (no dynamic array indexing in ACIR).
fn select_card(hand: [CardStruct; 15], index: u32) -> CardStruct {
    let mut result = CardStruct { color: 0, value: 0, is_wild: 0 };
    for i in 0..15 {
        if i as u32 == index {
            result = hand[i];
        }
    }
    result
}

fn zero_card_at(hand: [CardStruct; 15], index: u32) -> [CardStruct; 15] {
    let mut new_hand = hand;
    for i in 0..15 {
        if i as u32 == index {
            new_hand[i] = CardStruct { color: 0, value: 0, is_wild: 0 };
        }
    }
    new_hand
}

// ── Public inputs (known to the verifier / on-chain program) ────────────────
// ── Private inputs (known only to the prover / player) ──────────────────────
fn main(
    // Public
    top_card_color:    pub Field,
    top_card_value:    pub Field,
    old_hand_hash:     pub Field,
    new_hand_hash:     pub Field,
    played_card_color: pub Field,
    played_card_value: pub Field,
    played_card_is_wild: pub Field,
    // Private
    hand_array:        [CardStruct; 15],
    played_card_index: u32,
    salt:              Field,
) {
    // 1. Verify the current hand commitment
    let computed_old = hash_hand(hand_array, salt);
    assert(computed_old == old_hand_hash, "old hand hash mismatch");

    // 2. Extract the played card and confirm it matches the public claim
    let played = select_card(hand_array, played_card_index);
    assert(played.color == played_card_color, "played card color mismatch");
    assert(played.value == played_card_value, "played card value mismatch");
    assert(played.is_wild == played_card_is_wild, "played card wild flag mismatch");

    // 3. Validate the move: color match OR value match OR wild card
    let color_ok = played.color == top_card_color;
    let value_ok = played.value == top_card_value;
    let wild_ok  = played.is_wild == 1;
    assert(color_ok | value_ok | wild_ok, "card does not match top card");

    // 4. Compute the new hand by zeroing the played slot
    let new_hand = zero_card_at(hand_array, played_card_index);

    // 5. Verify the new hand commitment
    let computed_new = hash_hand(new_hand, salt);
    assert(computed_new == new_hand_hash, "new hand hash mismatch");
}

// ── Tests ────────────────────────────────────────────────────────────────────
#[test]
fn test_valid_color_match() {
    // Hand: [Red-5, Blue-3, zeros...]  Playing Red-5 (index 0) on Red-7
    let mut hand: [CardStruct; 15] = [CardStruct { color: 0, value: 0, is_wild: 0 }; 15];
    hand[0] = CardStruct { color: 1, value: 5, is_wild: 0 }; // Red-5
    hand[1] = CardStruct { color: 2, value: 3, is_wild: 0 }; // Blue-3

    let salt: Field = 42;
    let old_hash = hash_hand(hand, salt);

    let new_hand = zero_card_at(hand, 0);
    let new_hash = hash_hand(new_hand, salt);

    main(1, 7, old_hash, new_hash, 1, 5, 0, hand, 0, salt);
}

#[test]
fn test_valid_value_match() {
    let mut hand: [CardStruct; 15] = [CardStruct { color: 0, value: 0, is_wild: 0 }; 15];
    hand[0] = CardStruct { color: 2, value: 5, is_wild: 0 }; // Green-5

    let salt: Field = 99;
    let old_hash = hash_hand(hand, salt);
    let new_hand = zero_card_at(hand, 0);
    let new_hash = hash_hand(new_hand, salt);

    // Playing Green-5 on Red-5 (value match)
    main(1, 5, old_hash, new_hash, 2, 5, 0, hand, 0, salt);
}

#[test]
fn test_valid_wild_card() {
    let mut hand: [CardStruct; 15] = [CardStruct { color: 0, value: 0, is_wild: 0 }; 15];
    hand[2] = CardStruct { color: 4, value: 13, is_wild: 1 }; // Wild Draw Four

    let salt: Field = 7;
    let old_hash = hash_hand(hand, salt);
    let new_hand = zero_card_at(hand, 2);
    let new_hash = hash_hand(new_hand, salt);

    // Wild card can be played on anything
    main(3, 9, old_hash, new_hash, 4, 13, 1, hand, 2, salt);
}
