/**
 * Prover Web Worker.
 *
 * Runs Noir's witness generation + proof generation off the main thread so
 * the UI does not freeze during the 2-5 second proof pipeline.
 *
 * Input message (matches `ProverRequest` in `src/lib/types.ts`):
 *
 *     {
 *       action: "generate-proof",
 *       circuitName: "play_card" | "draw_card",
 *       witness: { ... }
 *     }
 *
 * Output message:
 *
 *     { status: "success", proofHex, publicInputs }
 *     { status: "error",   error: string }
 *
 * Pipeline (matches @noir-lang/noir_js@1.0.0-beta.22 + @aztec/bb.js@0.50):
 *
 *     1. Load the compiled circuit JSON from /public/circuits/<name>/target/.
 *     2. Construct Noir(circuitJson).
 *     3. noir.execute(inputs) -> { witness: Uint8Array, returnValue }
 *     4. bb.acirProveUltraHonk(acirBytes, witness) -> proof: Uint8Array
 *
 * `acirBytes` = base64Decode(circuitJson.bytecode) — that is the same
 * pre-decoded buffer that noir_js feeds to ACVM, so passing it to bb.js
 * produces the exact same VK that `acirWriteVkUltraHonk` would.
 *
 * Cached per-circuit: the loaded circuit JSON, the Noir instance, and the
 * base64-decoded ACIR byte vector. The bb.js Barretenberg instance is
 * process-singleton: spinning it up costs hundreds of ms.
 */

/// <reference lib="webworker" />

import type { ProverRequest, ProverResponse, CircuitName } from "../lib/types";

interface SuccessPayload {
  proofHex: string;
  publicInputs: string[];
}

// Lazily-loaded Noir instance + decoded ACIR per circuit.
interface CircuitCache {
  noir: any | null;
  circuit: any | null;
  acirBytes: Uint8Array | null;
}

const cache: Record<CircuitName, CircuitCache> = {
  play_card: { noir: null, circuit: null, acirBytes: null },
  draw_card: { noir: null, circuit: null, acirBytes: null },
};

// Lazily-constructed Barretenberg instance. Reused across all circuits
// because startup is expensive (WASM worker + initialisation).
type BBInstance = any;
let bbInstancePromise: Promise<BBInstance> | null = null;

async function getBB(): Promise<BBInstance> {
  if (!bbInstancePromise) {
    bbInstancePromise = (async () => {
      const bbModule: any = await import("@aztec/bb.js");
      return await bbModule.Barretenberg.new({ threads: 1 });
    })();
  }
  return bbInstancePromise;
}

async function loadCircuit(name: CircuitName): Promise<CircuitCache> {
  if (cache[name].circuit) return cache[name];

  // Fetch the compiled Noir circuit. The artifact path mirrors the output
  // of `nargo compile`: <name>/target/<name>.json placed under public/.
  const res = await fetch(`/circuits/${name}/target/${name}.json`);
  if (!res.ok) {
    throw new Error(
      `Failed to load circuit "${name}" (${res.status}). Did you run \`nargo compile\` and copy target/ into public/circuits/?`,
    );
  }
  const circuit = await res.json();
  cache[name].circuit = circuit;
  cache[name].acirBytes = base64ToBytes(circuit.bytecode);
  return cache[name];
}

async function getNoir(name: CircuitName): Promise<any> {
  const slot = await loadCircuit(name);
  if (slot.noir) return slot.noir;

  const noirModule: any = await import("@noir-lang/noir_js");
  const Noir = noirModule.Noir ?? noirModule.default;
  slot.noir = new Noir(slot.circuit);
  return slot.noir;
}

/**
 * Public inputs for the play_card circuit (7):
 *   1. top_card_color      (u32)
 *   2. top_card_value      (u32)
 *   3. old_hand_hash       (BytesN<32>)
 *   4. new_hand_hash       (BytesN<32>)
 *   5. played_card_color   (u32)
 *   6. played_card_value   (u32)
 *   7. played_card_is_wild (0 or 1)
 *
 * Public inputs for the draw_card circuit (4):
 *   1. old_hand_hash (BytesN<32>)
 *   2. new_hand_hash (BytesN<32>)
 *   3. card_hash     (BytesN<32>)
 *   4. slot_index    (u32)
 */
async function generateProof(request: ProverRequest): Promise<SuccessPayload> {
  const slot = await loadCircuit(request.circuitName);
  const noir = await getNoir(request.circuitName);
  const inputs = mapWitness(request);

  // Dump the FULL hand so we can spot any field with the wrong type / value.
  // A `unreachable` panic with valid types typically means the WASM is in a
  // bad state (e.g. corrupted memory, page fault) — the inputs above are
  // usually fine, but we log them anyway so any regression is obvious.
  const handFull = Array.isArray(inputs.hand_array)
    ? inputs.hand_array.map((c: any, i: number) => ({
        i,
        keys: Object.keys(c).sort(),
        color: c.color,
        value: c.value,
        is_wild: c.is_wild,
        // surface the JS type of each field so a `number` vs `string` mismatch
        // is visible immediately
        ctype: typeof c.color,
        vtype: typeof c.value,
        wtype: typeof c.is_wild,
      }))
    : null;
  // eslint-disable-next-line no-console
  console.log(
    "[worker] inputs before execute:",
    JSON.stringify({
      circuit: request.circuitName,
      top_card_color: inputs.top_card_color,
      top_card_value: inputs.top_card_value,
      played_card_color: inputs.played_card_color,
      played_card_value: inputs.played_card_value,
      played_card_is_wild: inputs.played_card_is_wild,
      played_card_index: inputs.played_card_index,
      salt_len: String(inputs.salt).length,
      old_hash_len: String(inputs.old_hand_hash).length,
      new_hash_len: String(inputs.new_hand_hash).length,
      hand_len: Array.isArray(inputs.hand_array) ? inputs.hand_array.length : "?",
      hand_full: handFull,
      // also dump the FULL old/new hashes (not just lengths) so we can spot
      // any non-numeric characters or missing values
      salt_start: String(inputs.salt).slice(0, 20),
      old_hash_start: String(inputs.old_hand_hash).slice(0, 20),
      new_hash_start: String(inputs.new_hand_hash).slice(0, 20),
    }, null, 0),
  );

  // 1) Execute the circuit — produces the ACIR witness buffer + return value.
  // If `noir.execute` throws, surface its enriched form (which contains
  // `rawAssertionPayload` + `noirCallStack`) so we can tell whether it's
  // an assertion failure or an ACVM WASM panic like "unreachable".
  let witness: Uint8Array;
  let returnValue: any;
  try {
    ({ witness, returnValue } = await noir.execute(inputs));
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.log(
      "[worker] noir.execute FAILED:",
      err?.message,
      "rawAssertionPayload=", err?.rawAssertionPayload,
      "noirCallStack=", err?.noirCallStack,
      "decoded=", err?.decodedAssertionPayload,
    );
    throw err;
  }
  void returnValue;

  if (!(witness instanceof Uint8Array) || witness.length === 0) {
    throw new Error("Noir.execute returned an empty witness — check the input mapping.");
  }

  // 2) Generate the proof with bb.js. The acirVec is the raw (base64-decoded)
  //    ACIR bytecode — bb.js hashes it internally to derive the VK.
  const bb = await getBB();
  const proof: Uint8Array = await bb.acirProveUltraHonk(slot.acirBytes!, witness);

  return {
    proofHex: bytesToHex(proof),
    // `acirProveUltraHonk` does not surface public inputs on its own; the
    // contract's verifier_stub accepts any shape for the public_inputs
    // Vec<Val>, so we pass the witness fields through directly. The
    // contract enforces structural validity (length, range, hash equality)
    // before the (currently stubbed) verifier call.
    publicInputs: extractPublicInputs(inputs),
  };
}

function mapWitness(request: ProverRequest) {
  if (request.circuitName === "play_card") {
    const w = request.witness as any;
    return {
      top_card_color: w.top_card_color,
      top_card_value: w.top_card_value,
      old_hand_hash: w.old_hand_hash,
      new_hand_hash: w.new_hand_hash,
      played_card_color: w.played_card_color,
      played_card_value: w.played_card_value,
      played_card_is_wild: w.played_card_is_wild,
      hand_array: w.hand_array,
      played_card_index: w.played_card_index,
      salt: w.salt,
    };
  }
  const w = request.witness as any;
  return {
    old_hand_hash: w.old_hand_hash,
    new_hand_hash: w.new_hand_hash,
    card_hash: w.card_hash,
    slot_index: w.slot_index,
    hand_array: w.hand_array,
    drawn_card_color: w.drawn_card_color,
    drawn_card_value: w.drawn_card_value,
    salt: w.salt,
  };
}

function extractPublicInputs(inputs: Record<string, unknown>): string[] {
  // Order must match the contract's decode order in
  // programs/zuno/src/instructions/{play_card,draw_card}.rs.
  if ("played_card_color" in inputs) {
    return [
      String(inputs.top_card_color),
      String(inputs.top_card_value),
      String(inputs.old_hand_hash),
      String(inputs.new_hand_hash),
      String(inputs.played_card_color),
      String(inputs.played_card_value),
      String(inputs.played_card_is_wild),
    ];
  }
  // draw_card: contract expects exactly 4 public inputs:
  // [old_hand_hash, new_hand_hash, card_hash, slot_index]
  return [
    String(inputs.old_hand_hash),
    String(inputs.new_hand_hash),
    String(inputs.card_hash),
    String(inputs.slot_index),
  ];
}

function bytesToHex(buf: Uint8Array): string {
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    out += buf[i].toString(16).padStart(2, "0");
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }
  throw new Error("No base64 decoder available in this worker environment.");
}

self.addEventListener("message", async (event: MessageEvent<ProverRequest>) => {
  const request = event.data;
  try {
    if (request.action !== "generate-proof") {
      throw new Error(`Unknown worker action: ${(request as any).action}`);
    }
    const result = await generateProof(request);
    const response: ProverResponse = { status: "success", ...result };
    (self as DedicatedWorkerGlobalScope).postMessage(response);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // Surface the full stack + any extra properties (`noirCallStack`,
    // `decodedAssertionPayload`, etc.) so the main thread can show WHY
    // `noir.execute` threw. Without this we lose context — `unreachable`
    // is the ACVM WASM's panic message with no source location attached.
    const stack = err instanceof Error ? err.stack : undefined;
    const noirCallStack = (err as any)?.noirCallStack as string[] | undefined;
    const decoded = (err as any)?.decodedAssertionPayload;
    const detailed = [
      `message: ${raw}`,
      stack ? `stack: ${stack.slice(0, 800)}` : "",
      noirCallStack ? `noirCallStack: ${noirCallStack.join(" | ")}` : "",
      decoded !== undefined ? `decoded: ${JSON.stringify(decoded)}` : "",
    ].filter(Boolean).join("\n");
    // Noir's errors can dump ACIR / wasm backtraces; truncate so the
    // toast on the main thread stays readable.
    const truncated = detailed.length > 4000 ? detailed.slice(0, 4000) + "…" : detailed;
    const response: ProverResponse = { status: "error", error: truncated };
    (self as DedicatedWorkerGlobalScope).postMessage(response);
  }
});

// Make this file a module so Vite emits a separate worker chunk.
export {};