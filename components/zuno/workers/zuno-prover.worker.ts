/// <reference lib="webworker" />
/**
 * Zuno Prover Web Worker
 *
 * Generates a zero-knowledge proof for a `play_card` or `draw_card` move
 * against a player's private hand. Runs off the main thread because proof
 * generation is CPU-heavy (millions of constraints, takes seconds).
 *
 * The worker exposes a tiny message protocol:
 *
 *   Main thread → worker:
 *     { type: "generate_proof", requestId, action, witness }
 *
 *   Worker → main thread:
 *     { type: "progress", requestId, stage, message }
 *     { type: "proof",    requestId, proofHex, publicInputsHex[] }
 *     { type: "error",    requestId, error }
 *
 * Currently runs in STUB MODE: it sleeps for ~600ms to simulate proof
 * generation and returns an empty proof. The contract's verifier is also
 * a stub, so an empty proof is accepted.
 *
 * To switch to real ZK proofs later:
 *   1. `nargo compile` both Noir circuits to produce the ACIR JSON + bytecode.
 *   2. `noirjs` compiles those to WASM (`@noir-lang/noir_js`).
 *   3. `bb.js` (`@aztec/bb.js`) generates the actual proof.
 *   4. Replace the `STUB MODE` block below with:
 *        const noir = new Noir(circuit);
 *        const backend = new UltraPlonkBackend(circuit.bytecode);
 *        const { witness } = await noir.execute(witness);
 *        const proof = await backend.generateProof(witness);
 *   5. The contract's `VerifierClient::try_verify` must be pointing at the
 *      real verifier contract, not the stub.
 *
 * The shape of the message protocol does not change.
 */

declare const self: DedicatedWorkerGlobalScope

export type ZkAction = "play_card" | "draw_card"

/**
 * Public inputs sent to the verifier, encoded as 32-byte hex strings
 * (BN254 field elements). Order MUST match the on-chain public inputs.
 */
export interface PublicInputs {
  /** play_card (7): top_card_color, top_card_value, old_hand_hash,
   *  new_hand_hash, played_card_color, played_card_value, played_card_is_wild
   */
  /** draw_card (4): old_hand_hash, new_hand_hash, card_hash, slot_index */
  fields: string[]
}

export interface ProverRequest {
  type: "generate_proof"
  requestId: string
  action: ZkAction
  /** Witness payload — currently a thin metadata object. With real
   *  Noir circuits this becomes the circuit's input map. */
  witness: {
    handHash: string
    salt: string
    /** For play_card: the index of the played card in the hand.
     *  For draw_card: the index of the empty slot to fill. */
    cardIndex: number
    /** Color/value/wild of the played card (play_card only). */
    playedColor?: number
    playedValue?: number
    playedIsWild?: boolean
  }
}

export interface ProverProgress {
  type: "progress"
  requestId: string
  stage: "witness" | "prove" | "encode"
  message: string
}

export interface ProverSuccess {
  type: "proof"
  requestId: string
  /** Hex-encoded proof bytes. Soroban expects the proof as `Bytes`/`BytesN`. */
  proofHex: string
  publicInputs: PublicInputs
}

export interface ProverFailure {
  type: "error"
  requestId: string
  error: string
}

export type ProverResponse = ProverProgress | ProverSuccess | ProverFailure

// ---------------------------------------------------------------------------
// Stub proof generation. Replace the body of `generateProofInWorker` with
// real Noir + bb.js calls to switch to actual ZK proofs.
// ---------------------------------------------------------------------------

const STUB_PROOF_HEX = "00"

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function generateProofInWorker(
  requestId: string,
  action: ZkAction,
  witness: ProverRequest["witness"],
  postProgress: (stage: ProverProgress["stage"], message: string) => void,
): Promise<ProverSuccess> {
  // ── Stage 1: build the witness ─────────────────────────────────────
  postProgress("witness", "Building witness from private hand commitment")

  // In the real implementation, the witness is the full input map for the
  // Noir circuit (hand array, salt, public inputs, etc.). Here we just
  // emit a synthetic value that the stub verifier accepts.
  await sleep(150)

  // ── Stage 2: prove ─────────────────────────────────────────────────
  postProgress(
    "prove",
    action === "play_card"
      ? "Noir is proving the move against your private hand commitment"
      : "Noir is proving the draw against your private hand commitment",
  )
  await sleep(450)

  // ── Stage 3: encode ────────────────────────────────────────────────
  postProgress("encode", "Serializing proof for Soroban")
  await sleep(80)

  // Stub: empty proof. The contract's stub verifier returns true regardless.
  return {
    type: "proof",
    requestId,
    proofHex: STUB_PROOF_HEX,
    publicInputs: {
      // Public input layout is enforced by the contract — what we send
      // here is placeholder. The stub verifier ignores these entirely.
      fields: action === "play_card"
        ? new Array(7).fill("00")
        : new Array(4).fill("00"),
    },
  }
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

self.addEventListener("message", async (event: MessageEvent<ProverRequest>) => {
  const msg = event.data
  if (!msg || msg.type !== "generate_proof") return

  const { requestId, action, witness } = msg
  const ctx: DedicatedWorkerGlobalScope = self

  const postProgress = (stage: ProverProgress["stage"], message: string) => {
    const payload: ProverProgress = { type: "progress", requestId, stage, message }
    ctx.postMessage(payload)
  }

  try {
    const result = await generateProofInWorker(requestId, action, witness, postProgress)
    ctx.postMessage(result)
  } catch (err) {
    const payload: ProverFailure = {
      type: "error",
      requestId,
      error: err instanceof Error ? err.message : String(err),
    }
    ctx.postMessage(payload)
  }
})

// Required so TypeScript treats this file as a module.
export {}
