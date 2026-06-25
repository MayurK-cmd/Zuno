'use client'

import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Cog, ExternalLink, Radio } from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useZunoContract } from '@/hooks/use-zuno-contract'
import { useZunoProver } from './hooks/use-zuno-prover'
import type { WitnessInput } from './hooks/use-zuno-prover'
import { STELLAR_EXPERT_TX_URL, truncateAddress } from '@/lib/stellar'

function StatusDescription({
  icon,
  children,
}: {
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex items-start gap-2">
      {icon}
      <span>{children}</span>
    </div>
  )
}

// ── Action descriptor ────────────────────────────────────────────────────
// One `PipelineAction` describes the move the user is making. The hook
// picks the right contract method and the right witness shape based on
// `kind`.
export type PipelineAction =
  | {
      kind: 'initialize_room'
      roomId: number
      stakeXlm: number
      xlmToken: string
      seedCommitmentHex: string
    }
  | { kind: 'join_room'; roomId: number }
  | { kind: 'start_game'; roomId: number }
  | { kind: 'reveal_randomness'; roomId: number; seedRevealHex: string }
  | {
      kind: 'play_card'
      roomId: number
      playedColor: number
      playedValue: number
      playedIsWild: boolean
      declaredColor?: number
    }
  | { kind: 'draw_card'; roomId: number }
  | { kind: 'call_zuno'; roomId: number }
  | { kind: 'claim_victory'; roomId: number }
  | { kind: 'force_skip'; roomId: number }
  | { kind: 'punish_zuno'; roomId: number; target: string }

interface RunPipelineOptions {
  /** Synthetic witness values for the prover worker. In stub mode these
   *  are just metadata; in real-ZK mode they become circuit inputs. */
  witness: WitnessInput
  /** User-facing label shown after success. */
  successTitle: string
}

/**
 * `useTransactionToasts` — orchestrates the prover worker + the Soroban
 * contract invocation through the toast UI.
 *
 * Phase 2 (current): the worker runs in stub mode (sleeps ~700ms and
 * returns empty proof bytes). The contract's verifier stub accepts any
 * proof, so the full pipeline works end-to-end on Stellar Testnet.
 *
 * Phase 2 (later): swap the worker's stub body for real Noir + bb.js
 * calls; flip the contract's verifier from stub to the real BN254
 * verifier contract. The pipeline shape does not change.
 */
export function useTransactionToasts() {
  const { toast } = useToast()
  const zuno = useZunoContract()
  const prover = useZunoProver()

  const runTransactionPipeline = useCallback(
    async (action: PipelineAction, options: RunPipelineOptions) => {
      const explorerUrlFor = (hash: string) =>
        `${STELLAR_EXPERT_TX_URL}/${hash}?network=testnet`

      const txToast = toast({
        title: 'Generating ZK Proof... (Local)',
        description: (
          <StatusDescription
            icon={
              <Cog
                className="mt-0.5 size-4 text-cyan-300 motion-safe:animate-spin"
                aria-hidden="true"
              />
            }
          >
            Noir is proving the move against your private hand commitment.
          </StatusDescription>
        ),
      })

      try {
        // ── Stage 1: proof generation ────────────────────────────────
        // Only play_card and draw_card actually need a ZK proof. For
        // everything else we skip the worker to keep the UI snappy.
        let proofHex = '00'
        let verifierSignatureHex = ''
        let publicInputs: string[] = []

        if (action.kind === 'play_card' || action.kind === 'draw_card') {
          const result = await prover.generateProof(
            action.kind,
            options.witness,
            {
              onProgress: (stage, message) => {
                if (stage === 'prove') {
                  txToast.update({
                    id: txToast.id,
                    title: 'Generating ZK Proof... (Local)',
                    description: (
                      <StatusDescription
                        icon={
                          <Cog
                            className="mt-0.5 size-4 text-cyan-300 motion-safe:animate-spin"
                            aria-hidden="true"
                          />
                        }
                      >
                        {message}
                      </StatusDescription>
                    ),
                  })
                }
              },
            },
          )
          proofHex = result.proofHex
          verifierSignatureHex = result.signatureHex
          publicInputs = result.publicInputs.fields
        } else {
          // No ZK proof required for this move — still display the
          // "generating" toast briefly so the UX feels consistent.
          await new Promise((r) => setTimeout(r, 250))
        }

        // ── Stage 2: submit to Soroban ───────────────────────────────
        txToast.update({
          id: txToast.id,
          title: 'Confirming on Stellar...',
          description: (
            <StatusDescription
              icon={
                <Radio
                  className="mt-0.5 size-4 text-cyan-300 motion-safe:animate-pulse"
                  aria-hidden="true"
                />
              }
            >
              Submitting the verified state transition on Stellar Testnet.
            </StatusDescription>
          ),
        })

        const result = await dispatchToContract(
          zuno,
          action,
          proofHex,
          publicInputs,
          verifierSignatureHex,
        )

        // ── Stage 3: success ─────────────────────────────────────────
        txToast.update({
          id: txToast.id,
          title: options.successTitle,
          description: (
            <StatusDescription
              icon={
                <CheckCircle2
                  className="mt-0.5 size-4 text-green-300"
                  aria-hidden="true"
                />
              }
            >
              <a
                href={explorerUrlFor(result.txHash)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-cyan-200 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                Success! View on Stellar Expert
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            </StatusDescription>
          ),
        })

        return result
      } catch (err) {
        txToast.dismiss()
        showTransactionFailureWithError(toast, err)
        throw err
      }
    },
    [prover, toast, zuno],
  )

  const showTransactionFailure = useCallback(() => {
    toast({
      variant: 'destructive',
      title: 'Transaction Failed',
      description: (
        <StatusDescription
          icon={
            <AlertTriangle className="mt-0.5 size-4" aria-hidden="true" />
          }
        >
          The table state changed before your move landed. Retry with the latest
          discard pile.
        </StatusDescription>
      ),
    })
  }, [toast])

  return { runTransactionPipeline, showTransactionFailure }
}

// ── Internal: dispatch the action to the right contract method ──────────
// Each branch constructs the typed args object the hook expects and
// returns the resulting `{ txHash, result }` (or rethrows on failure).
async function dispatchToContract(
  zuno: ReturnType<typeof useZunoContract>,
  action: PipelineAction,
  proofHex: string,
  publicInputs: string[],
  verifierSignatureHex: string,
) {
  switch (action.kind) {
    case 'initialize_room':
      return zuno.initializeRoom({
        roomId: action.roomId,
        stakeXlm: action.stakeXlm,
        xlmToken: action.xlmToken,
        seedCommitmentHex: action.seedCommitmentHex,
      })
    case 'join_room':
      return zuno.joinRoom({ roomId: action.roomId })
    case 'start_game':
      return zuno.startGame({ roomId: action.roomId })
    case 'reveal_randomness':
      return zuno.revealRandomness({
        roomId: action.roomId,
        seedRevealHex: action.seedRevealHex,
      })
    case 'play_card':
      return zuno.playCard({
        roomId: action.roomId,
        proofHex,
        publicInputs,
        verifierSignatureHex,
      })
    case 'draw_card':
      return zuno.drawCard({
        roomId: action.roomId,
        proofHex,
        publicInputs,
        verifierSignatureHex,
      })
    case 'call_zuno':
      return zuno.callZuno({ roomId: action.roomId })
    case 'claim_victory':
      return zuno.claimVictory({ roomId: action.roomId })
    case 'force_skip':
      return zuno.forceSkip({ roomId: action.roomId })
    case 'punish_zuno':
      return zuno.punishZuno({ roomId: action.roomId, target: action.target })
  }
}

function showTransactionFailureWithError(
  toast: ReturnType<typeof useToast>['toast'],
  err: unknown,
) {
  const message = err instanceof Error ? err.message : 'Unknown error'
  toast({
    variant: 'destructive',
    title: 'Transaction Failed',
    description: (
      <StatusDescription
        icon={
          <AlertTriangle className="mt-0.5 size-4" aria-hidden="true" />
        }
      >
        {message}. The table state may have changed — retry with the latest
        discard pile.
      </StatusDescription>
    ),
  })
}

// Re-export for callers that want the helper directly.
export { truncateAddress }
