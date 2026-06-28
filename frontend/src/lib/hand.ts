/**
 * Deck logic — UNO deck generation, deterministic shuffling, hand derivation,
 * sessionStorage persistence.
 *
 * The hand itself (cards + salt) is private: it NEVER leaves the browser.
 * Only the Poseidon commitment of the hand hits the chain (see
 * `commitment.ts`). The salt is generated locally via `crypto.getRandomValues`
 * and stored in `sessionStorage` keyed by `(roomId, publicKey)` so that the
 * same browser retains its hand across reloads within a single game.
 */

import type { Card, CardColor, CardValue } from "./types";

// Card constants (must match the on-chain `state.rs`).
export const COLOR_RED = 0 as const;
export const COLOR_GREEN = 1 as const;
export const COLOR_BLUE = 2 as const;
export const COLOR_YELLOW = 3 as const;
export const COLOR_WILD = 4 as const;

export const VALUE_SKIP = 10;
export const VALUE_REVERSE = 11;
export const VALUE_DRAW_TWO = 12;
export const VALUE_WILD_DRAW_FOUR = 13;

export const HAND_SIZE = 15;
const SALT_BYTES = 31;

/**
 * Build a full 108-card UNO deck in the numeric representation used by the
 * circuits & contract.
 *
 *  - Numbered cards 0-9 in Red/Green/Blue/Yellow (one 0 per color, two of 1-9).
 *  - 2× Skip, 2× Reverse, 2× DrawTwo per color.
 *  - 4× Wild, 4× WildDrawFour.
 */
export function buildDeck(): Card[] {
  const deck: Card[] = [];

  for (let color = COLOR_RED; color <= COLOR_YELLOW; color++) {
    deck.push({ color: color as CardColor, value: 0, isWild: 0 });
    for (let n = 1; n <= 9; n++) {
      deck.push({ color: color as CardColor, value: n, isWild: 0 });
      deck.push({ color: color as CardColor, value: n, isWild: 0 });
    }
    for (let i = 0; i < 2; i++) {
      deck.push({ color: color as CardColor, value: VALUE_SKIP, isWild: 0 });
      deck.push({ color: color as CardColor, value: VALUE_REVERSE, isWild: 0 });
      deck.push({ color: color as CardColor, value: VALUE_DRAW_TWO, isWild: 0 });
    }
  }

  for (let i = 0; i < 4; i++) {
    deck.push({ color: COLOR_WILD, value: 0, isWild: 1 });
    deck.push({ color: COLOR_WILD, value: VALUE_WILD_DRAW_FOUR, isWild: 1 });
  }

  return deck;
}

/** A constant exported for tests / debugging only — use `buildDeck()` in app code. */
export const DECK_108: Card[] = buildDeck();

/**
 * Generate a cryptographically random salt for hand commitments.
 * Returns a 31-byte hex string (62 chars, no `0x` prefix) — fits the BN254
 * field modulus with comfortable headroom.
 */
export function generateSalt(): string {
  const bytes = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Fisher-Yates shuffle seeded by the provided hex string. The same seed
 * always produces the same permutation, so all players in a room agree on
 * the deck ordering without trusting any single party.
 *
 * For hackathon scope this is a non-cryptographic seed-to-bytes mapping;
 * it gives every player the same deterministic output for the same seed.
 */
export function fisherYatesShuffle(deck: Card[], seedHex: string): Card[] {
  if (!seedHex) throw new Error("fisherYatesShuffle requires a non-empty seed");
  const seedBytes: number[] = [];
  for (let i = 0; i < seedHex.length; i += 2) {
    seedBytes.push(parseInt(seedHex.slice(i, i + 2), 16));
  }
  if (seedBytes.length === 0) throw new Error("Invalid hex seed");

  const shuffled = [...deck];
  let seedIndex = 0;
  for (let i = shuffled.length - 1; i > 0; i--) {
    const byte = seedBytes[seedIndex % seedBytes.length];
    const j = byte % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    seedIndex++;
  }
  return shuffled;
}

/**
 * Derive `HAND_SIZE` cards for a given player index from the shared seed.
 * Players occupy non-overlapping slices of the shuffled deck.
 */
export function derivePlayerHand(seedHex: string, playerIndex: number): Card[] {
  const shuffled = fisherYatesShuffle(buildDeck(), seedHex);
  const start = playerIndex * HAND_SIZE;
  if (start + HAND_SIZE > shuffled.length) {
    throw new Error(
      `Player ${playerIndex} slice exceeds deck size (need ${HAND_SIZE * (playerIndex + 1)} cards)`,
    );
  }
  return shuffled.slice(start, start + HAND_SIZE);
}

interface StoredHand {
  hand: Card[];
  salt: string;
  timestamp: number;
}

function sessionKey(roomId: string, publicKey: string): string {
  return `zuno:hand:${roomId}:${publicKey}`;
}

/** Persist the local hand + salt for the current browser session. */
export function saveHandToSession(
  roomId: string,
  publicKey: string,
  hand: Card[],
  salt: string,
): void {
  if (typeof window === "undefined") return;
  const payload: StoredHand = { hand, salt, timestamp: Date.now() };
  window.sessionStorage.setItem(sessionKey(roomId, publicKey), JSON.stringify(payload));
}

/** Load the persisted hand for this player, or null if none is stored. */
export function loadHandFromSession(
  roomId: string,
  publicKey: string,
): { hand: Card[]; salt: string } | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(sessionKey(roomId, publicKey));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredHand;
    if (!parsed.hand || !parsed.salt) return null;
    return { hand: parsed.hand, salt: parsed.salt };
  } catch {
    return null;
  }
}

/** Remove the locally stored hand (used when leaving a room). */
export function clearHandFromSession(roomId: string, publicKey: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(sessionKey(roomId, publicKey));
}

/** True when the card can legally be played on top of `topCard`. */
export function isLegalPlay(played: Card, topCard: Card): boolean {
  if (played.isWild === 1) return true;
  if (played.color === topCard.color) return true;
  if (played.value === topCard.value) return true;
  return false;
}
