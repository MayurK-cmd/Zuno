"use client"

import { useCallback, useEffect, useRef } from "react"

import type {
  ProverFailure,
  ProverProgress,
  ProverRequest,
  ProverResponse,
  ProverSuccess,
  PublicInputs,
  ZkAction,
} from "../workers/zuno-prover.worker"

/**
 * Witness input — what the caller knows about the move they're making.
 * For Phase 2 stub mode this is just metadata. When real Noir circuits are
 * wired in, `witness.hand` will be the player's full private hand array.
 */
export interface WitnessInput {
  handHash: string
  salt: string
  cardIndex: number
  playedColor?: number
  playedValue?: number
  playedIsWild?: boolean
}

export interface GeneratedProof {
  proofHex: string
  publicInputs: PublicInputs
}

export interface ProofGenerationCallbacks {
  onProgress?: (stage: ProverProgress["stage"], message: string) => void
}

/**
 * `useZunoProver` — main-thread handle for the prover Web Worker.
 *
 * Spawns a single worker on first use and reuses it across calls. Returns
 * a `generateProof` function that resolves with the proof bytes + public
 * inputs when the worker finishes, or rejects on error.
 *
 * Usage:
 *   const { generateProof, terminate } = useZunoProver()
 *   const { proofHex, publicInputs } = await generateProof(
 *     "play_card",
 *     { handHash, salt, cardIndex, playedColor, playedValue, playedIsWild },
 *     { onProgress: (stage, msg) => toast.update(...) },
 *   )
 */
export function useZunoProver() {
  const workerRef = useRef<Worker | null>(null)
  const requestCounterRef = useRef(0)

  useEffect(() => {
    // Vite-style worker import is fine; Next.js 16 supports the new Worker
    // constructor with `{ type: "module" }`. We create the worker lazily on
    // first use instead of in this effect so SSR doesn't trip on it.
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  const ensureWorker = useCallback((): Worker => {
    if (typeof window === "undefined") {
      throw new Error("useZunoProver can only run in the browser")
    }
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("../workers/zuno-prover.worker.ts", import.meta.url),
        { type: "module" },
      )
    }
    return workerRef.current
  }, [])

  const generateProof = useCallback(
    (
      action: ZkAction,
      witness: WitnessInput,
      callbacks: ProofGenerationCallbacks = {},
    ): Promise<GeneratedProof> => {
      const worker = ensureWorker()
      const requestId = `zk-${++requestCounterRef.current}-${Date.now()}`

      return new Promise<GeneratedProof>((resolve, reject) => {
        const handler = (event: MessageEvent<ProverResponse>) => {
          const msg = event.data
          if (!msg || msg.requestId !== requestId) return

          if (msg.type === "progress") {
            callbacks.onProgress?.(msg.stage, msg.message)
            return
          }

          worker.removeEventListener("message", handler)
          if (msg.type === "proof") {
            const ok = msg as ProverSuccess
            resolve({ proofHex: ok.proofHex, publicInputs: ok.publicInputs })
          } else if (msg.type === "error") {
            const err = msg as ProverFailure
            reject(new Error(err.error))
          }
        }

        worker.addEventListener("message", handler)

        const request: ProverRequest = {
          type: "generate_proof",
          requestId,
          action,
          witness,
        }
        worker.postMessage(request)
      })
    },
    [ensureWorker],
  )

  const terminate = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
  }, [])

  return { generateProof, terminate }
}
