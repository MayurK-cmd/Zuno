/**
 * `seed-link` — URL-hash helpers for sharing the deck seed with joiners.
 *
 * The host stashes the revealed seed in `hostMeta` (localStorage), but a
 * second Chrome profile has no access to it. Until the indexer surfaces
 * the on-chain seed, the host appends the seed to the room URL as a hash
 * fragment and shares the link out-of-band. The joiner opens the link and
 * the game page reads `#seed=…` on mount.
 *
 * Why a hash fragment and not a query param?
 *   - Fragments are NEVER sent to the server, so this is safe even if the
 *     site is ever fronted by a logging reverse-proxy.
 *   - They survive browser navigations and reloads.
 *   - The seed is short (32 bytes = 64 hex chars), so the URL stays
 *     manageable.
 *
 * The contract treats the seed as public once revealed (`reveal_randomness`
 * stores it on-chain), so leaking it through the URL is not a privacy
 * regression — anyone with the seed link could derive the same deck by
 * re-running the deterministic shuffle.
 */

const SEED_RE = /^#?seed=([0-9a-fA-F]{64})/;

/**
 * Parse a `#seed=HEX` fragment. Returns the lowercase hex seed, or `null`
 * if the fragment is missing / malformed. Tolerates a missing leading `#`.
 */
export function seedFromHash(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const m = SEED_RE.exec(hash);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Build the shareable URL the host sends to joiners. The seed is appended
 * as a hash fragment so it never touches the server.
 */
export function seedLinkFor(origin: string, roomId: string, seedHex: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(seedHex)) {
    throw new Error(`seedLinkFor: expected 64-hex seed, got ${seedHex.length} chars`);
  }
  return `${origin}/game/${roomId}#seed=${seedHex.toLowerCase()}`;
}
