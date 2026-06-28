/**
 * `room-id` — display id ↔ on-chain u64 conversion.
 *
 * The contract stores rooms under a `u64` key. The UI shows a friendly
 * id like `ZUNO-A14F`. We hash the display string deterministically
 * into 64 bits so the URL alone is enough to identify a room — host
 * and joiners both compute the same u64 from the same display id,
 * without needing any extra URL params or localStorage.
 *
 * The hash is a classic polynomial rolling hash (base 131), which fits
 * comfortably into u64 for any reasonable display id. For a demo this
 * is more than enough — collisions are vanishingly rare and the
 * contract still rejects duplicate rooms at the storage layer.
 */

/** Mask that keeps the result a u64. */
const U64_MASK = 0xffffffffffffffffn;

export function displayRoomIdToU64(displayId: string): bigint {
  let hash = 0n;
  for (let i = 0; i < displayId.length; i++) {
    hash = (hash * 131n + BigInt(displayId.charCodeAt(i))) & U64_MASK;
  }
  return hash;
}