/**
 * `useDeck` — derives (or restores from sessionStorage) a player's private
 * hand + salt for a given room. The hand is purely local; it is NEVER sent
 * to anyone. Only the commitment (`hashHand(hand, salt)`) crosses the wire.
 *
 * Inputs:
 *  - `roomId`: the on-chain room id
 *  - `publicKey`: the player's Stellar address
 *  - `seedHex`: the host's revealed seed (becomes available after `start_game`)
 *  - `playerIndex`: the player's position in the room's `players` Vec
 *    (0 = host, 1 = first joiner, etc.). Each player gets a different
 *    15-card slice of the deterministic Fisher-Yates shuffle, so passing
 *    the right index is what makes the two profiles see different hands.
 *
 * State machine:
 *  - `loading`: seed or publicKey missing, or initial derivation in flight
 *  - `ready`: hand + salt available
 *  - `error`: derivation failed (e.g. invalid seed)
 */

import { useEffect, useState } from "react";
import { derivePlayerHand, generateSalt } from "@/lib/hand";
import type { Card } from "@/lib/types";

export type DeckStatus = "loading" | "ready" | "error";

export interface UseDeckResult {
  hand: Card[];
  salt: string;
  status: DeckStatus;
  error: string | null;
}

/**
 * Build the sessionStorage cache key. We fold `playerIndex` in so a joiner
 * who first loads the page (with `playerIndex = 0` because `gameRoom.players`
 * is empty until `joinRoom` lands) gets a separate cache slot from the one
 * they end up with after `playerIndex` flips to 1. Without the index in
 * the key, the first `playerIndex = 0` derivation would be cached and the
 * second `playerIndex = 1` re-derivation would short-circuit on the cache
 * — leaving both profiles with the host's deck slice.
 */
function cacheKey(roomId: string, publicKey: string, playerIndex: number): string {
  return `zuno:hand:${roomId}:${publicKey}:p${playerIndex}`;
}

interface StoredHand {
  hand: Card[];
  salt: string;
  timestamp: number;
}

function loadCachedHand(key: string): { hand: Card[]; salt: string } | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredHand;
    if (!parsed.hand || !parsed.salt) return null;
    return { hand: parsed.hand, salt: parsed.salt };
  } catch {
    return null;
  }
}

function writeCachedHand(key: string, hand: Card[], salt: string): void {
  if (typeof window === "undefined") return;
  const payload: StoredHand = { hand, salt, timestamp: Date.now() };
  window.sessionStorage.setItem(key, JSON.stringify(payload));
}

export function useDeck(
  roomId: string | undefined,
  publicKey: string | null | undefined,
  seedHex: string | null | undefined,
  playerIndex: number = 0,
): UseDeckResult {
  const [hand, setHand] = useState<Card[]>([]);
  const [salt, setSalt] = useState<string>("");
  const [status, setStatus] = useState<DeckStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!roomId || !publicKey) {
      setStatus("loading");
      return;
    }

    const key = cacheKey(roomId, publicKey, playerIndex);

    // Prune any other `:p<n>` entries for this (roomId, publicKey)
    // pair so we never have a stale slice cached. Without this, every
    // playerIndex flip leaves a ghost entry that could be hit by a
    // hard reload from a previous session and confusingly appears as
    // "same hand" debug output.
    if (typeof window !== "undefined") {
      const prefix = `zuno:hand:${roomId}:${publicKey}:p`;
      for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
        const k = window.sessionStorage.key(i);
        if (k && k.startsWith(prefix) && k !== key) {
          window.sessionStorage.removeItem(k);
        }
      }
    }

    // If we already have a hand cached for this (room, player, index),
    // keep it — the cards never change mid-game (only commitments do).
    const cached = loadCachedHand(key);
    if (cached) {
      setHand(cached.hand);
      setSalt(cached.salt);
      setStatus("ready");
      return;
    }

    if (!seedHex) {
      // Waiting for the host to reveal the seed via `start_game`.
      setStatus("loading");
      return;
    }

    try {
      // Use the player's index in the room's roster so each profile
      // gets a different 15-card slice of the seeded deck. Falling back
      // to 0 keeps the host functional before the indexer surfaces the
      // player list — `players[0]` is always the host.
      const newHand = derivePlayerHand(seedHex, playerIndex);
      const newSalt = generateSalt();
      writeCachedHand(key, newHand, newSalt);
      setHand(newHand);
      setSalt(newSalt);
      setStatus("ready");
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to derive hand";
      setError(msg);
      setStatus("error");
    }
  }, [roomId, publicKey, seedHex, playerIndex]);

  return { hand, salt, status, error };
}
