'use client'

import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Cog, ExternalLink, Radio } from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { delay, fakeTxHash } from './game-types'

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

export function useTransactionToasts() {
  const { toast } = useToast()

  const runTransactionPipeline = async (successTitle: string) => {
    const txHash = fakeTxHash(successTitle.replace(/\W/g, '').slice(0, 6))
    const explorerUrl = `https://solscan.io/tx/${txHash}?cluster=devnet`
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

    await delay(700)

    txToast.update({
      id: txToast.id,
      title: 'Confirming on Solana...',
      description: (
        <StatusDescription
          icon={
            <Radio
              className="mt-0.5 size-4 text-cyan-300 motion-safe:animate-pulse"
              aria-hidden="true"
            />
          }
        >
          Submitting the verified state transition on devnet.
        </StatusDescription>
      ),
    })

    await delay(850)

    txToast.update({
      id: txToast.id,
      title: successTitle,
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
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-cyan-200 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            Success! View on Solscan
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </StatusDescription>
      ),
    })

    return txHash
  }

  const showTransactionFailure = () => {
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
  }

  return { runTransactionPipeline, showTransactionFailure }
}
