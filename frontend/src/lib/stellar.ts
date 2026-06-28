/**
 * Soroban RPC client + contract state helpers.
 *
 * All contract interaction goes through a single Server instance. We read
 * env vars at runtime (Vite injects `import.meta.env.VITE_*`) and provide
 * sensible fallbacks for development against Stellar Testnet.
 *
 * IMPORTANT: the on-chain `GameRoom` struct is stored under
 * `env.storage().persistent()` keyed by `(room_id, "game_room")`. To read it
 * we issue a `getContractData` call against the contract instance storage,
 * which gives us the slot. The contract is expected to expose a `view`
 * helper that returns the room as a `GameRoomView` SCVal — for the hackathon
 * we fetch the raw ledger entry and parse it on the client.
 */

import type { Card, GameRoomPlayer, GameRoomView, GameStatus } from "./types";

// Lazy-loaded SDK so that code-splitting keeps the initial bundle small.
type StellarSdk = typeof import("@stellar/stellar-sdk");
let sdkPromise: Promise<StellarSdk> | null = null;

async function getSDK(): Promise<StellarSdk> {
  if (!sdkPromise) {
    sdkPromise = import("@stellar/stellar-sdk");
  }
  return sdkPromise;
}

function env(key: string, fallback?: string): string {
  // Vite injects `import.meta.env.VITE_*` at build time.
  const fromVite = (import.meta as any).env?.[key];
  if (fromVite) return String(fromVite);
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing environment variable: ${key}`);
}

const RPC_URL = () => env("VITE_SOROBAN_RPC_URL", "https://soroban-testnet.stellar.org");
const HORIZON_URL = () => env("VITE_HORIZON_URL", "https://horizon-testnet.stellar.org");
const NETWORK_PASSPHRASE = () =>
  env("VITE_NETWORK_PASSPHRASE", "Test SDF Network ; September 2015");

export function getContractId(): string {
  return env("VITE_ZUNO_CONTRACT_ID");
}

export function getVerifierContractId(): string {
  return env("VITE_VERIFIER_CONTRACT_ID");
}

export function getXlmContractId(): string {
  return env(
    "VITE_XLM_CONTRACT_ID",
    "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC", // Stellar testnet native XLM SAC
  );
}

/**
 * Coerce a UI room id (display string like "ZUNO-A14F" or a numeric string /
 * bigint) into the on-chain `u64` key the contract stores rooms under.
 *
 * Display ids are hashed deterministically into 64 bits. Numeric strings and
 * bigints (e.g. `Date.now()` at create time) are coerced directly. Real builds
 * would store the display → numeric mapping in the indexer; for hackathon
 * scope this hash is stable enough to act as the lookup key.
 */
export function toRoomIdNumeric(roomId: bigint | string | number): bigint {
  if (typeof roomId === "bigint") return roomId;
  if (typeof roomId === "number") return BigInt(roomId);
  // Numeric string (e.g. "1719432000000") — coerce directly.
  if (/^\d+$/.test(roomId)) return BigInt(roomId);
  // Display format "ZUNO-XXXX" — hash to a stable u64.
  let hash = 0n;
  for (let i = 0; i < roomId.length; i++) {
    hash = (hash * 131n + BigInt(roomId.charCodeAt(i))) & 0xffffffffffffffffn;
  }
  return hash;
}

let serverPromise: Promise<any> | null = null;

async function getServer() {
  if (!serverPromise) {
    serverPromise = (async () => {
      // `@stellar/stellar-sdk` v16 renamed the RPC namespace from
      // `SorobanRpc` (PascalCase) to `rpc` (lowercase).
      const { rpc } = await getSDK();
      return new rpc.Server(RPC_URL(), { allowHttp: RPC_URL().startsWith("http://") });
    })();
  }
  return serverPromise;
}

/**
 * Load the source account (sequence number, balances) for a public key.
 * Used when assembling every transaction.
 */
export async function loadAccount(publicKey: string) {
  const server = await getServer();
  try {
    return await server.getAccount(publicKey);
  } catch (err) {
    throw new Error(
      `Failed to load account ${publicKey}. Has it been funded on Testnet? (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }
}

/**
 * Read the native XLM balance for an address via Horizon. Returns a string
 * in XLM units (e.g. "123.4567890"). Returns "0" on any failure — Horizon
 * timeouts are common on the public Testnet and shouldn't take down the UI.
 */
export async function getXlmBalance(publicKey: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const horizonUrl = `${HORIZON_URL()}/accounts/${publicKey}`;
    const res = await fetch(horizonUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return "0";
    const data = (await res.json()) as {
      balances?: Array<{ asset_type?: string; balance?: string }>;
    };
    const native = data.balances?.find((b) => b.asset_type === "native");
    return native?.balance ?? "0";
  } catch {
    // Horizon timeout or 404 — treat as zero balance so the UI keeps working.
    return "0";
  }
}

/**
 * Build the contract storage key for `DataKey::GameRoom(room_id)`.
 *
 * Soroban 22.x encodes `#[contracttype]` enums with tuple variants as
 * a two-element `ScVal::Vec` whose first element is the **variant name
 * as a `Symbol`** (not a numeric discriminant). This is documented in
 * the `contracttype` macro docs:
 *
 *     "A tuple enum is stored as a two-element vector containing the
 *      name of the enum variant as a Symbol, then the value in the tuple."
 *
 * So `DataKey::GameRoom(room_id)` (see
 * `contracts/programs/zuno/src/state.rs:42-45`) encodes as:
 *
 *     ScvVec([ScvSymbol("GameRoom"), ScvU64(room_id)])
 *
 * This mirrors the encoding the contract uses when it calls
 * `env.storage().persistent().set(&DataKey::GameRoom(room_id), ...)`.
 * A wrong key here manifests as `getContractData` returning "not found"
 * even though the diagnostic events for the `initialize_room` tx show
 * `core_metrics / write_entry` firing — the room is stored at a key
 * the frontend wasn't reading.
 *
 * Note: pre-SDK-22 contracttype enums used a numeric U32 discriminant.
 * This contract was compiled with `soroban-sdk = "22.0.0"`, so the
 * symbol-name encoding is the one in effect.
 */
function gameRoomStorageKey(roomId: bigint, Sdk: StellarSdk) {
  return Sdk.xdr.ScVal.scvVec([
    Sdk.xdr.ScVal.scvSymbol("GameRoom"),
    new Sdk.ScInt(roomId, { type: "u64" }).toScVal(),
  ]);
}

/**
 * Fetch a game room's view from on-chain contract storage.
 *
 * Soroban stores `GameRoom` in `env.storage().persistent()` keyed by
 * `DataKey::GameRoom(room_id)`. We ask the Soroban RPC node for that slot
 * via `getContractData` and decode the resulting `LedgerEntryData` (a
 * `ContractDataEntry`) into a typed `GameRoomView`. Returns `null` if the
 * slot has not been written yet (room not initialised, or the contract has
 * archived it).
 */
export async function getGameRoom(
  roomId: bigint | string | number,
): Promise<GameRoomView | null> {
  const numericId = toRoomIdNumeric(roomId);
  const Sdk = await getSDK();
  const server = await getServer();

  const key = gameRoomStorageKey(numericId, Sdk);

  let entry;
  try {
    entry = await server.getContractData(
      getContractId(),
      key,
      "persistent",
    );
  } catch (err) {
    // The SDK throws either an Error or a plain object with `code` /
    // `message` fields. Unwrap both shapes so the thrown message
    // contains the actual reason, not `[object Object]`.
    let msg: string;
    if (err instanceof Error) msg = err.message;
    else if (err && typeof err === "object") msg = JSON.stringify(err);
    else msg = String(err);
    // Missing entries (room not yet created, or archived) are a normal
    // state — return null so the UI's polling hook shows the empty
    // state instead of a console error every 4 s.
    if (/not.found|entry.missing|404/i.test(msg)) return null;
    throw new Error(`getContractData failed: ${msg}`);
  }

  const data = entry.val.contractData();
  if (!data) return null;
  const rawScVal = data.val();
  const raw = Sdk.scValToNative(rawScVal);
  return parseGameRoom(raw);
}

/**
 * Wait for a transaction to land and return its final status.
 * Polls every 1s up to `timeoutMs` (default 30s).
 */
export async function waitForTransaction(
  hash: string,
  timeoutMs: number = 30_000,
): Promise<{ status: "success" | "failed"; error?: string }> {
  const server = await getServer();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const tx = await server.getTransaction(hash);
      if (tx.status === "SUCCESS") return { status: "success" };
      if (tx.status === "FAILED") {
        return { status: "failed", error: tx.resultXdr ?? "Transaction failed" };
      }
    } catch {
      // not yet known — keep polling
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Transaction ${hash} did not land within ${timeoutMs / 1000}s`);
}

/**
 * Decode the `GameRoom` SCVal returned by the contract into a typed view.
 *
 * The Rust struct `GameRoom` (see `contracts/programs/zuno/src/state.rs`)
 * has named fields, so Soroban serialises it as a `ScVal::Map` keyed by
 * the Rust field names. `scValToNative` flattens that into a plain JS
 * object: `{ host, status, stake_amount, pot, players, current_turn,
 * top_card, deck_root, verifier_contract, turn_deadline, flow_direction,
 * xlm_token, commit_reveal_seed }`.
 *
 * The inner `Card` struct (top_card) is also a named struct so it
 * surfaces as `{ color, value, is_wild }` (with `is_wild` as a JS
 * boolean). Players serialise as `Vec<Address>` → array of address
 * strings. Enums surface as their variant name (e.g. `"Active"`,
 * `"Waiting"`, `"Finished"`).
 */
export function parseGameRoom(raw: unknown): GameRoomView {
  const placeholder: Card = { color: 0, value: 0, isWild: 0 };
  const empty = {
    host: "",
    players: [] as GameRoomPlayer[],
    currentTurn: 0,
    direction: 1 as 1 | -1,
    topCard: placeholder,
    pot: 0n,
    turnDeadline: 0,
    gameStatus: "Waiting" as GameStatus,
  };

  if (!raw || typeof raw !== "object") return empty;
  const r = raw as Record<string, unknown>;

  // Map the contract's enum variant name to the UI's three-state string.
  // Soroban 22.x with `#[contracttype] enum` of unit variants deserialises
  // each variant as a **single-element array** whose only entry is the
  // variant name string (e.g. `["Active"]`). Older Soroban versions used
  // a Map shape `{ Active: null }`. We accept all three shapes (array,
  // object-keyed, plain string) so a UI built against one SDK version
  // still works when the on-chain data was written by another.
  let statusStr: string | undefined;
  const statusRaw = r.status;
  if (typeof statusRaw === "string") {
    statusStr = statusRaw;
  } else if (Array.isArray(statusRaw) && typeof statusRaw[0] === "string") {
    statusStr = statusRaw[0];
  } else if (statusRaw && typeof statusRaw === "object") {
    const keys = Object.keys(statusRaw);
    if (keys.length === 1 && typeof (statusRaw as Record<string, unknown>)[keys[0]] === "string") {
      statusStr = (statusRaw as Record<string, string>)[keys[0]];
    } else {
      // Some SDK versions surface unit variants as `{ VariantName: null }`.
      statusStr = keys[0];
    }
  }
  const gameStatus: GameStatus =
    statusStr === "Active"         ? "InProgress" :
    statusStr === "Finished"       ? "Finished"   :
    // `AwaitingReveal` (host committed, seed not yet on chain) collapses
    // to `Waiting` for the UI: the host banner is gated on player count,
    // not on the contract's status, so no surface needs to distinguish
    // these two states.
    "Waiting";

  const playersRaw = Array.isArray(r.players) ? (r.players as unknown[]) : [];
  const players: GameRoomPlayer[] = playersRaw
    .filter((a): a is string => typeof a === "string" && a.length > 0)
    .map((address) => ({
      address,
      // Per-player hand size requires a separate `PlayerState` lookup
      // (one `getContractData` per address). For now we render the
      // on-chain roster without hand sizes — opponent cards stay at 0
      // until the indexer / websocket lands.
      handSize: 0,
      handCommitment: "",
    }));

  const tcRaw = (r.top_card ?? {}) as Record<string, unknown>;
  const topCard: Card = {
    color: Number(tcRaw.color ?? 0) as Card["color"],
    value: Number(tcRaw.value ?? 0),
    isWild: tcRaw.is_wild ? 1 : 0,
  };

  const flow = Number(r.flow_direction ?? 1);

  return {
    host: typeof r.host === "string" ? r.host : "",
    players,
    currentTurn: Number(r.current_turn ?? 0),
    direction: flow >= 0 ? 1 : -1,
    topCard,
    pot: BigInt((r.pot as bigint | number | string | undefined) ?? 0),
    turnDeadline: Number(r.turn_deadline ?? 0),
    gameStatus,
    // `commit_reveal_seed` is an `Option<BytesN<32>>` on the contract;
    // `scValToNative` surfaces it as the raw bytes (Uint8Array) when
    // present, or `undefined` when not. Expose it as lowercase hex so
    // the joiner no longer needs the URL-hash seed-sharing workaround
    // for the common case.
    seed: bytesToHexLower(r.commit_reveal_seed),
  };
}

function bytesToHexLower(v: unknown): string | undefined {
  // `commit_reveal_seed` is `Option<BytesN<32>>` on-chain. Soroban's JS
  // SDK surfaces `Option<T>` either as the inner `T` directly (most
  // types) or as a one-element array containing `T` (when the SCVal
  // was a Vec). Both shapes appear in the wild depending on SDK
  // version and whether the value was wrapped in a Map. We accept
  // both so the joiner's seed resolution works regardless of which
  // deserialisation path the SDK takes.
  let bytes: Uint8Array | undefined;
  if (v instanceof Uint8Array) {
    bytes = v;
  } else if (Array.isArray(v) && v.length === 1 && v[0] instanceof Uint8Array) {
    bytes = v[0];
  } else if (Array.isArray(v) && v.length === 0) {
    return undefined; // None
  }
  if (bytes && bytes.length === 32) {
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
    return s;
  }
  return undefined;
}

/** Format an XLM stroop amount (i128) into a human-readable XLM string. */
export function formatXlm(stroops: bigint | number): string {
  const stroopsBig = typeof stroops === "bigint" ? stroops : BigInt(stroops);
  const whole = stroopsBig / 10_000_000n;
  const frac = stroopsBig % 10_000_000n;
  const fracStr = frac.toString().padStart(7, "0").replace(/0+$/, "");
  return fracStr.length > 0 ? `${whole}.${fracStr}` : `${whole}`;
}

/** Convert a UI XLM amount (string/number) into stroops as bigint. */
export function xlmToStroops(xlm: string | number): bigint {
  const num = typeof xlm === "string" ? parseFloat(xlm) : xlm;
  if (!Number.isFinite(num)) throw new Error("Invalid XLM amount");
  // Avoid floating-point drift by scaling via string manipulation.
  const [whole, frac = ""] = String(num).split(".");
  const fracPadded = (frac + "0000000").slice(0, 7);
  return BigInt(whole) * 10_000_000n + BigInt(fracPadded);
}
