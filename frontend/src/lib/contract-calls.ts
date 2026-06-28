/**
 * Typed wrappers for all 10 Zuno Soroban contract methods.
 *
 * Each helper:
 *  1. Loads the source account.
 *  2. Builds a Transaction with one `invokeContractFunction` operation.
 *  3. Asks Freighter to sign the XDR.
 *  4. Submits the signed transaction to Soroban RPC and returns the hash.
 *
 * Stakes use the native XLM SAC (Stellar Asset Contract). The contract is
 * responsible for transferring tokens from the player to its own escrow.
 *
 * The 10 contract methods (see `claude-docs/CLAUDE.md`):
 *   initialize_room, join_room, start_game,
 *   play_card, draw_card, call_zuno,
 *   claim_victory, force_skip, punish_zuno,
 *   consume_randomness
 */

import { getContractId, getVerifierContractId, getXlmContractId, loadAccount, waitForTransaction } from "./stellar";
import type { VerifiedProof } from "./types";

// We import the SDK lazily inside each helper so the initial bundle stays
// small and the SSR pass never hits Freighter-only code paths.
async function sdk() {
  return await import("@stellar/stellar-sdk");
}

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
// Base fee per operation. `prepareTransaction` will bump this to include the
// Soroban resource fee (CPU + footprint) computed during simulation.
const BASE_FEE = "100";
const TX_TIMEOUT_SECONDS = 300;
const POLL_TIMEOUT_MS = 30_000;

type Signer = (xdr: string) => Promise<string>;

async function buildInvokeTx(args: { publicKey: string; method: string; params: any[] }) {
  const Sdk = await sdk();
  const account = await loadAccount(args.publicKey);
  // `@stellar/stellar-sdk` v16 renamed the `invokeContractFunction`
  // options: `method` → `function`, `parameters` → `args`.
  const op = Sdk.Operation.invokeContractFunction({
    contract: getContractId(),
    function: args.method,
    args: args.params,
  });
  return new Sdk.TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();
}

async function submitAndAwait(signer: Signer, tx: any): Promise<string> {
  const Sdk = await sdk();
  const server = new Sdk.rpc.Server(
    import.meta.env.VITE_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org",
  );

  // Soroban transactions need resource-fee + footprint pre-flight, computed
  // by the RPC during simulation. `prepareTransaction` does this for us:
  // it runs `simulateTransaction`, attaches the resulting
  // `SorobanTransactionData` (resource fee + ledger footprint), and bumps
  // the fee up to the simulation's `minResourceFee`. Without this the
  // envelope is missing required fields and the RPC rejects with
  // `txMalformed`.
  const preparedTx = await server.prepareTransaction(tx);

  const signedXdr = await signer(preparedTx.toXDR());
  const signedTx = Sdk.TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);

  // Retry on transient RPC errors. Soroban testnet frequently returns
  // `TRY_AGAIN_LATER` when two txs from the same account land within
  // milliseconds of each other (the first one is still in PENDING) or
  // when the node is under load. The fee sequence is also bumped in the
  // retry by re-running prepareTransaction so we don't burn a sequence
  // number on a rejected submission.
  const transientStatuses = new Set(["TRY_AGAIN_LATER", "ERROR"]);
  let lastSendResult: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      // Re-prepare in case the source account sequence number has
      // advanced; otherwise the freshly-signed tx will use a stale seq.
      const refreshed = await server.prepareTransaction(tx);
      const refreshedXdr = await signer(refreshed.toXDR());
      const refreshedTx = Sdk.TransactionBuilder.fromXDR(refreshedXdr, NETWORK_PASSPHRASE);
      lastSendResult = await server.sendTransaction(refreshedTx);
    } else {
      lastSendResult = await server.sendTransaction(signedTx);
    }

    if (lastSendResult.status === "PENDING") break;
    if (transientStatuses.has(lastSendResult.status) && attempt < 2) {
      console.warn(
        `[contract-calls] sendTransaction returned ${lastSendResult.status}, retrying (attempt ${attempt + 1}/3)…`,
      );
      // Exponential backoff: 400ms, 1200ms.
      await new Promise((r) => setTimeout(r, 400 * Math.pow(3, attempt)));
      continue;
    }
    // Permanent failure (or final attempt). Surface it.
    console.error("sendTransaction rejected:", lastSendResult);
    throw new Error(
      `Transaction rejected (${lastSendResult.status}): ${
        typeof lastSendResult.errorResult === "string"
          ? lastSendResult.errorResult
          : JSON.stringify(lastSendResult, (_, v) =>
              typeof v === "bigint" ? v.toString() : v,
            )
      }`,
    );
  }

  const final = await waitForTransaction(lastSendResult.hash, POLL_TIMEOUT_MS);
  if (final.status !== "success") {
    throw new Error(`Transaction failed on-chain: ${final.error ?? "unknown"}`);
  }
  return lastSendResult.hash;
}

/**
 * Convert a hex string (with or without `0x`) into a Uint8Array of bytes.
 * The browser has no `Buffer` global, so we roll our own.
 */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("hex string must have even length");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Convert a hex string into an SCVal bytes representation. Used for proof
 * bytes, public inputs, and seed commitments.
 */
function hexToBytesScVal(Sdk: any, hex: string) {
  return Sdk.nativeToScVal(hexToBytes(hex), { type: "bytes" });
}

/**
 * Decode a 64-char hex string into exactly 32 raw bytes.
 *
 * The contract's `BytesN<32>` decoders (`decode_bytes32` in
 * `contracts/programs/zuno/src/instructions/{play_card,draw_card}.rs`)
 * read 32 raw bytes out of the `Bytes` value. The worker's
 * `extractPublicInputs` emits hex strings, so we have to convert here
 * at the contract-call boundary. `hashHand` in `commitment.ts` already
 * returns 64-char hex of 32 raw bytes, so this is the right format.
 */
function hexToBytes32(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      `hexToBytes32: expected 64-char hex string, got ${hex.length} chars`,
    );
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Convert the 7 public-input strings emitted by `prover.worker.ts` for the
 * `play_card` circuit into the per-element `ScVal`s the contract expects:
 *
 *   [0] top_card_color      (u32, in 0..=4)
 *   [1] top_card_value      (u32, in 0..=13)
 *   [2] old_hand_hash       (Bytes, exactly 32 bytes)
 *   [3] new_hand_hash       (Bytes, exactly 32 bytes)
 *   [4] played_card_color   (u32)
 *   [5] played_card_value   (u32)
 *   [6] played_card_is_wild (u32, 0 or 1)
 *
 * Returning a plain JS array (NOT a single wrapping `ScVal::Vec`) is what
 * the Soroban SDK expects for `Vec<Val>` parameters — the SDK serialises
 * a JS array of SCVals into a host-side `Vec<Val>`, preserving each
 * element's `ScVal` type. The contract then decodes the bag with
 * `decode_u32` for the small ints and `decode_bytes32` for the hashes.
 *
 * The order MUST match `instructions/play_card.rs::handler` (and the
 * circuit's public-input order). The previous implementation packed all
 * 7 fields into one `ScVal::Vec<ScVal::Bytes>`, which made the contract's
 * `decode_u32` calls fail with `PublicInputMismatch (#20)`.
 */
function encodePlayCardPublicInputs(Sdk: any, items: string[]): any[] {
  if (items.length !== 7) {
    throw new Error(
      `play_card public_inputs: expected 7, got ${items.length}`,
    );
  }
  return [
    Sdk.nativeToScVal(parseInt(items[0], 10), { type: "u32" }),
    Sdk.nativeToScVal(parseInt(items[1], 10), { type: "u32" }),
    Sdk.nativeToScVal(hexToBytes32(items[2]), { type: "bytes" }),
    Sdk.nativeToScVal(hexToBytes32(items[3]), { type: "bytes" }),
    Sdk.nativeToScVal(parseInt(items[4], 10), { type: "u32" }),
    Sdk.nativeToScVal(parseInt(items[5], 10), { type: "u32" }),
    Sdk.nativeToScVal(parseInt(items[6], 10), { type: "u32" }),
  ];
}

/**
 * Convert the 4 public-input strings emitted by `prover.worker.ts` for the
 * `draw_card` circuit into the per-element `ScVal`s the contract expects:
 *
 *   [0] old_hand_hash (Bytes, exactly 32 bytes)
 *   [1] new_hand_hash (Bytes, exactly 32 bytes)
 *   [2] card_hash     (Bytes, exactly 32 bytes)
 *   [3] slot_index    (u32)
 *
 * See `encodePlayCardPublicInputs` for why we return a JS array of SCVals
 * rather than a wrapping `ScVal::Vec`.
 */
function encodeDrawCardPublicInputs(Sdk: any, items: string[]): any[] {
  if (items.length !== 4) {
    throw new Error(
      `draw_card public_inputs: expected 4, got ${items.length}`,
    );
  }
  return [
    Sdk.nativeToScVal(hexToBytes32(items[0]), { type: "bytes" }),
    Sdk.nativeToScVal(hexToBytes32(items[1]), { type: "bytes" }),
    Sdk.nativeToScVal(hexToBytes32(items[2]), { type: "bytes" }),
    Sdk.nativeToScVal(parseInt(items[3], 10), { type: "u32" }),
  ];
}

// ----- 1. initialize_room -----
export interface InitializeRoomArgs {
  host: string;
  roomId: bigint;
  stakeStroops: bigint;
  seedCommitment: string; // hex
}
export async function initializeRoom(signer: Signer, args: InitializeRoomArgs): Promise<string> {
  const Sdk = await sdk();
  const tx = await buildInvokeTx({
    publicKey: args.host,
    method: "initialize_room",
    params: [
      Sdk.nativeToScVal(args.host, { type: "address" }),
      Sdk.nativeToScVal(args.roomId, { type: "u64" }),
      Sdk.nativeToScVal(args.stakeStroops, { type: "i128" }),
      Sdk.nativeToScVal(getXlmContractId(), { type: "address" }),
      Sdk.nativeToScVal(getVerifierContractId(), { type: "address" }),
      hexToBytesScVal(Sdk, args.seedCommitment),
    ],
  });
  return submitAndAwait(signer, tx);
}

// ----- 2. join_room -----
export async function joinRoom(signer: Signer, player: string, roomId: bigint): Promise<string> {
  const Sdk = await sdk();
  const tx = await buildInvokeTx({
    publicKey: player,
    method: "join_room",
    params: [
      Sdk.nativeToScVal(player, { type: "address" }),
      Sdk.nativeToScVal(roomId, { type: "u64" }),
    ],
  });
  return submitAndAwait(signer, tx);
}

// ----- 3. start_game -----
// Transitions Waiting -> AwaitingReveal. The host reveals the seed in a
// follow-up `reveal_randomness` call.
export async function startGame(
  signer: Signer,
  host: string,
  roomId: bigint,
): Promise<string> {
  const Sdk = await sdk();
  const tx = await buildInvokeTx({
    publicKey: host,
    method: "start_game",
    params: [
      Sdk.nativeToScVal(host, { type: "address" }),
      Sdk.nativeToScVal(roomId, { type: "u64" }),
    ],
  });
  return submitAndAwait(signer, tx);
}

// ----- 3b. reveal_randomness -----
// The host discloses the random seed they committed during
// `initialize_room`. Contract verifies it matches the stored commitment
// and transitions AwaitingReveal -> Active.
export async function revealRandomness(
  signer: Signer,
  host: string,
  roomId: bigint,
  seedRevealHex: string,
): Promise<string> {
  const Sdk = await sdk();
  const tx = await buildInvokeTx({
    publicKey: host,
    method: "reveal_randomness",
    params: [
      Sdk.nativeToScVal(host, { type: "address" }),
      Sdk.nativeToScVal(roomId, { type: "u64" }),
      hexToBytesScVal(Sdk, seedRevealHex),
    ],
  });
  return submitAndAwait(signer, tx);
}

// ----- 4. play_card -----
export async function playCard(
  signer: Signer,
  player: string,
  roomId: bigint,
  proof: VerifiedProof,
): Promise<string> {
  const Sdk = await sdk();
  const tx = await buildInvokeTx({
    publicKey: player,
    method: "play_card",
    params: [
      Sdk.nativeToScVal(player, { type: "address" }),
      Sdk.nativeToScVal(roomId, { type: "u64" }),
      hexToBytesScVal(Sdk, proof.proofHex),
      encodePlayCardPublicInputs(Sdk, proof.publicInputs),
      hexToBytesScVal(Sdk, proof.signatureHex),
    ],
  });
  return submitAndAwait(signer, tx);
}

// ----- 5. draw_card -----
export async function drawCard(
  signer: Signer,
  player: string,
  roomId: bigint,
  proof: VerifiedProof,
): Promise<string> {
  const Sdk = await sdk();
  const tx = await buildInvokeTx({
    publicKey: player,
    method: "draw_card",
    params: [
      Sdk.nativeToScVal(player, { type: "address" }),
      Sdk.nativeToScVal(roomId, { type: "u64" }),
      hexToBytesScVal(Sdk, proof.proofHex),
      encodeDrawCardPublicInputs(Sdk, proof.publicInputs),
      hexToBytesScVal(Sdk, proof.signatureHex),
    ],
  });
  return submitAndAwait(signer, tx);
}

// ----- 6. call_zuno -----
export async function callZuno(signer: Signer, player: string, roomId: bigint): Promise<string> {
  const Sdk = await sdk();
  const tx = await buildInvokeTx({
    publicKey: player,
    method: "call_zuno",
    params: [
      Sdk.nativeToScVal(player, { type: "address" }),
      Sdk.nativeToScVal(roomId, { type: "u64" }),
    ],
  });
  return submitAndAwait(signer, tx);
}

// ----- 7. claim_victory -----
export async function claimVictory(
  signer: Signer,
  winner: string,
  roomId: bigint,
): Promise<string> {
  const Sdk = await sdk();
  const tx = await buildInvokeTx({
    publicKey: winner,
    method: "claim_victory",
    params: [
      Sdk.nativeToScVal(winner, { type: "address" }),
      Sdk.nativeToScVal(roomId, { type: "u64" }),
    ],
  });
  return submitAndAwait(signer, tx);
}

// ----- 8. force_skip -----
export async function forceSkip(signer: Signer, caller: string, roomId: bigint): Promise<string> {
  const Sdk = await sdk();
  const tx = await buildInvokeTx({
    publicKey: caller,
    method: "force_skip",
    params: [
      Sdk.nativeToScVal(caller, { type: "address" }),
      Sdk.nativeToScVal(roomId, { type: "u64" }),
    ],
  });
  return submitAndAwait(signer, tx);
}

// ----- 9. punish_zuno -----
export async function punishZuno(
  signer: Signer,
  caller: string,
  target: string,
  roomId: bigint,
): Promise<string> {
  const Sdk = await sdk();
  const tx = await buildInvokeTx({
    publicKey: caller,
    method: "punish_zuno",
    params: [
      Sdk.nativeToScVal(caller, { type: "address" }),
      Sdk.nativeToScVal(target, { type: "address" }),
      Sdk.nativeToScVal(roomId, { type: "u64" }),
    ],
  });
  return submitAndAwait(signer, tx);
}

// ----- 10. consume_randomness -----
/**
 * Optional helper — some contracts emit VRF results via a separate method
 * that players must call to advance the game state. We expose this for
 * completeness; most builds will not need it.
 */
export async function consumeRandomness(
  signer: Signer,
  player: string,
  roomId: bigint,
  randomness: string,
): Promise<string> {
  const Sdk = await sdk();
  const tx = await buildInvokeTx({
    publicKey: player,
    method: "consume_randomness",
    params: [
      Sdk.nativeToScVal(player, { type: "address" }),
      Sdk.nativeToScVal(roomId, { type: "u64" }),
      hexToBytesScVal(Sdk, randomness),
    ],
  });
  return submitAndAwait(signer, tx);
}
