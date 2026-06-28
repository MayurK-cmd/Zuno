/**
 * Poseidon2 hand commitments.
 *
 * The chain only ever sees a commitment to a player's hand. When a card is
 * played or drawn, the player submits the OLD commitment, the NEW commitment,
 * and a ZK proof that the transition is valid (see `prover.ts`).
 *
 * The circuit hashes the hand as:
 *
 *     H = poseidon2(color_0, value_0, isWild_0, ..., color_14, value_14, isWild_14, salt)
 *
 * Empty slots (after a card is played) MUST be encoded as (0, 0, 0) — the
 * circuit treats those as zero-valued field elements.
 *
 * We delegate the actual hashing to `@aztec/bb.js`'s WASM Poseidon2
 * implementation, loaded lazily so it does not bloat the entry bundle.
 */

import type { Card } from "./types";

// Lazily-loaded bb.js module. We use a dynamic import because the WASM is
// several MB and should only be loaded when the user actually plays a card.
//
// bb.js v0.50 does NOT export `poseidon2Hash` at the top level. It is a
// method on the `Barretenberg` instance (which extends `BarretenbergApi`).
// `Barretenberg.new()` constructs the instance inside a worker and returns
// a Promise<Barretenberg> that exposes `poseidon2Hash(Fr[]): Promise<Fr>`.
// The returned `Fr` has `.toBuffer()` -> `Uint8Array` (32 bytes BE).
type BBModule = typeof import("@aztec/bb.js");
let bbModulePromise: Promise<BBModule> | null = null;

async function getBB(): Promise<BBModule> {
  if (!bbModulePromise) {
    bbModulePromise = import("@aztec/bb.js");
  }
  return bbModulePromise;
}

// Cache a single Barretenberg instance for the session — spinning up the
// WASM worker is expensive (hundreds of ms) and we may hash many times.
type BBInstance = Awaited<ReturnType<BBModule["Barretenberg"]["new"]>>;
let bbInstancePromise: Promise<BBInstance> | null = null;

async function getBBInstance(): Promise<BBInstance> {
  if (!bbInstancePromise) {
    bbInstancePromise = (async () => {
      const { Barretenberg } = await getBB();
      return await Barretenberg.new({ threads: 1 });
    })();
  }
  return bbInstancePromise;
}

/** Run Poseidon2 over the given fields and return a 32-byte hex string. */
async function poseidon2Hex(fields: bigint[]): Promise<string> {
  const { Fr } = await getBB();
  const instance = await getBBInstance();
  const frs = fields.map((v) => new Fr(v));
  const fr = await instance.poseidon2Hash(frs);
  const bytes: Uint8Array = fr.toBuffer();
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex.padStart(64, "0");
}

const HAND_FIELDS_PER_CARD = 3;
export const HAND_LENGTH = 15;
const TOTAL_FIELDS = HAND_FIELDS_PER_CARD * HAND_LENGTH + 1; // 46

/** Zero card used to pad empty slots in the hand array. */
export const ZERO_CARD: Card = { color: 0, value: 0, isWild: 0 };

/**
 * Convert a single byte/uint8 to a bigint field element. The salt we generate
 * is 31 bytes (248 bits), which fits comfortably inside the BN254 field modulus.
 */
function bytesToBigInt(hex: string): bigint {
  return BigInt("0x" + hex);
}

/** Pad a u8 value to 32 bytes big-endian for cross-circuit compatibility. */
export function padU8(value: number): string {
  return value.toString(16).padStart(64, "0");
}

/**
 * Convert a 32-byte hex hash (the format `hashHand` / `hashCard` return)
 * into the decimal integer string Noir's TS bindings expect for a `Field`.
 *
 * The on-chain `BytesN<32>` layer (see contract-calls.ts::hexToBytes32)
 * uses raw bytes — it doesn't care about the integer interpretation.
 * But the Noir witness layer reads these as `Field` (a 254-bit integer
 * modulo the BN254 scalar field), and noir_js's parser rejects hex
 * strings with "invalid digit found in string".
 *
 * The 32-byte BE hash represents a field element < p (the BN254 scalar
 * field modulus), so the BigInt conversion is loss-free.
 */
export function hexHashToDecimalField(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return BigInt("0x" + clean).toString();
}

/**
 * Hash the 15-card hand + salt using Poseidon2. Returns a 32-byte hex string
 * WITHOUT the `0x` prefix (consistent with how the contract expects bytes).
 */
export async function hashHand(hand: Card[], salt: string): Promise<string> {
  if (hand.length !== HAND_LENGTH) {
    throw new Error(`hashHand: hand must be ${HAND_LENGTH} cards, got ${hand.length}`);
  }

  const fields: bigint[] = [];
  for (const card of hand) {
    fields.push(BigInt(card.color));
    fields.push(BigInt(card.value));
    fields.push(BigInt(card.isWild));
  }
  fields.push(bytesToBigInt(salt));

  if (fields.length !== TOTAL_FIELDS) {
    throw new Error(`hashHand: expected ${TOTAL_FIELDS} fields, got ${fields.length}`);
  }

  return poseidon2Hex(fields);
}

/**
 * Compute the new commitment after `playedCardIndex` is removed from the hand.
 * The empty slot is replaced with a zero card (0, 0, 0) per the circuit spec.
 */
export async function computeNewHandHash(
  hand: Card[],
  playedCardIndex: number,
  salt: string,
): Promise<string> {
  if (playedCardIndex < 0 || playedCardIndex >= hand.length) {
    throw new Error(`computeNewHandHash: index ${playedCardIndex} out of range`);
  }
  const newHand = hand.map((card, idx) => (idx === playedCardIndex ? ZERO_CARD : card));
  return hashHand(newHand, salt);
}

/**
 * Compute the new commitment after a card is drawn into `slotIndex`.
 * Used by the `draw_card` circuit.
 */
export async function computeHandHashAfterDraw(
  hand: Card[],
  slotIndex: number,
  drawnColor: number,
  drawnValue: number,
  salt: string,
): Promise<string> {
  if (slotIndex < 0 || slotIndex >= hand.length) {
    throw new Error(`computeHandHashAfterDraw: slot ${slotIndex} out of range`);
  }
  const newHand = hand.map((card, idx) =>
    idx === slotIndex
      ? {
          color: drawnColor as Card["color"],
          value: drawnValue,
          isWild: drawnValue === 13 ? (1 as const) : (0 as const),
        }
      : card,
  );
  return hashHand(newHand, salt);
}

/**
 * Hash a single card for the `draw_card` circuit's `card_hash` public input.
 * The circuit hashes just the drawn card so the contract can verify the
 * player received a particular card without revealing which one.
 */
export async function hashCard(color: number, value: number, isWild: 0 | 1): Promise<string> {
  return poseidon2Hex([BigInt(color), BigInt(value), BigInt(isWild)]);
}
