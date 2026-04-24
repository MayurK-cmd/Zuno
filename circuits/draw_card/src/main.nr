use std::hash::poseidon2::Poseidon2;

struct CardStruct {
    color: Field,
    value: Field,
    is_wild: Field,
}

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

// Hash a single card — used to commit to a specific deck card without
// revealing it to the network. The deck_root is built from these hashes.
fn hash_card(card: CardStruct) -> Field {
    Poseidon2::hash([card.color, card.value, card.is_wild], 3)
}

fn insert_card_at(hand: [CardStruct; 15], index: u32, card: CardStruct) -> [CardStruct; 15] {
    let mut new_hand = hand;
    for i in 0..15 {
        if i as u32 == index {
            new_hand[i] = card;
        }
    }
    new_hand
}

// Verify that `slot` in `hand` is empty (zeroed out).
fn assert_slot_empty(hand: [CardStruct; 15], index: u32) {
    for i in 0..15 {
        if i as u32 == index {
            assert(hand[i].color == 0, "slot not empty: color");
            assert(hand[i].value == 0, "slot not empty: value");
            assert(hand[i].is_wild == 0, "slot not empty: is_wild");
        }
    }
}

// ── Public inputs ────────────────────────────────────────────────────────────
// ── Private inputs ───────────────────────────────────────────────────────────
fn main(
    // Public — verified against on-chain state
    old_hand_hash: pub Field,
    new_hand_hash: pub Field,
    deck_root:     pub Field,  // Merkle root of remaining deck (updated off-chain)
    card_hash:     pub Field,  // Poseidon hash of the drawn card (deck leaf)
    // Private
    hand_array:    [CardStruct; 15],
    drawn_card:    CardStruct,
    empty_slot:    u32,
    salt:          Field,
) {
    // 1. Verify the current hand commitment
    let computed_old = hash_hand(hand_array, salt);
    assert(computed_old == old_hand_hash, "old hand hash mismatch");

    // 2. Verify the drawn card is in the deck (matches the declared card_hash)
    //    The client proves card_hash is a valid leaf in deck_root via a
    //    Merkle membership proof — here we verify the card itself matches the hash.
    let computed_card_hash = hash_card(drawn_card);
    assert(computed_card_hash == card_hash, "card hash mismatch");

    // 3. The slot we're inserting into must be empty
    assert_slot_empty(hand_array, empty_slot);

    // 4. Insert drawn card into the empty slot
    let new_hand = insert_card_at(hand_array, empty_slot, drawn_card);

    // 5. Verify the new hand commitment
    let computed_new = hash_hand(new_hand, salt);
    assert(computed_new == new_hand_hash, "new hand hash mismatch");

    // deck_root is used by the on-chain program for accounting;
    // we reference it here so it's constrained as a public input.
    let _ = deck_root;
}

// ── Tests ────────────────────────────────────────────────────────────────────
#[test]
fn test_valid_draw() {
    let mut hand: [CardStruct; 15] = [CardStruct { color: 0, value: 0, is_wild: 0 }; 15];
    hand[0] = CardStruct { color: 1, value: 3, is_wild: 0 }; // existing card

    let salt: Field = 17;
    let old_hash = hash_hand(hand, salt);

    let drawn = CardStruct { color: 2, value: 6, is_wild: 0 }; // drawn Blue-6
    let c_hash = hash_card(drawn);

    let new_hand_arr = insert_card_at(hand, 1, drawn);
    let new_hash = hash_hand(new_hand_arr, salt);

    // deck_root is just c_hash for this unit test (single-leaf deck)
    main(old_hash, new_hash, c_hash, c_hash, hand, drawn, 1, salt);
}
