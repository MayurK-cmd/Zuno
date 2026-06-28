/**
 * `host-meta` — localStorage helpers for the host's per-room metadata.
 *
 * The contract stores the game state on-chain, but the seed reveal +
 * "is the current user the host?" question lives in the browser until
 * the indexer is wired up. We stash a small JSON blob per room id so
 * the game page knows:
 *   - Whether the current wallet is the host of this room.
 *   - The seed (and salt) to reveal in `reveal_randomness` once the
 *     host is ready to start the game.
 *
 * Stored under key `zuno:host-meta:<roomId>`. Other players' browsers
 * won't have an entry, which is how the game page distinguishes host
 * from joiner.
 */

const STORAGE_PREFIX = "zuno:host-meta:";

export interface HostMeta {
  host: string;
  seedHex: string;
  /**
   * The on-chain `room_id` (u64) the contract stored the room under.
   * The lobby uses `BigInt(Date.now())` at create time, while the URL
   * uses a friendly display id like "ZUNO-A14F". The two are different
   * numbers — the game page MUST use this one for every contract call,
   * otherwise `start_game` will fail with `RoomNotFound` (#22).
   */
  roomIdNumeric: string;
  /** When the host pressed "Start Game" — used to gate "Reveal Seed". */
  startedAt?: number;
}

export function storeHostMeta(roomId: string, meta: HostMeta): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + roomId, JSON.stringify(meta));
  } catch {
    // Quota / private mode — fall through; the game page just won't
    // know it's the host and the host UX degrades gracefully.
  }
}

export function loadHostMeta(roomId: string): HostMeta | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_PREFIX + roomId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<HostMeta>;
    if (!parsed || typeof parsed.host !== "string" || typeof parsed.seedHex !== "string") {
      return null;
    }
    return parsed as HostMeta;
  } catch {
    return null;
  }
}

export function clearHostMeta(roomId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_PREFIX + roomId);
}

// ── Participant roster ─────────────────────────────────────────────────────
//
// Cross-profile state isn't truly possible with just localStorage (each
// Chrome profile has its own), but we keep a small "public" roster under
// a separate key so the host's address is reachable to anyone who lands
// on the room page. Real cross-profile player counts need the indexer.

const ROSTER_PREFIX = "zuno:room-roster:";

export interface RosterEntry {
  address: string;
  /** Unix ms when the entry was recorded. */
  joinedAt: number;
}

export function readRoster(roomId: string): RosterEntry[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(ROSTER_PREFIX + roomId);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RosterEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendToRoster(roomId: string, entry: RosterEntry): void {
  if (typeof window === "undefined") return;
  const existing = readRoster(roomId);
  if (existing.some((e) => e.address === entry.address)) return;
  const next = [...existing, entry].slice(-16); // cap at 16 entries
  try {
    window.localStorage.setItem(ROSTER_PREFIX + roomId, JSON.stringify(next));
  } catch {
    /* quota — fall through */
  }
}
