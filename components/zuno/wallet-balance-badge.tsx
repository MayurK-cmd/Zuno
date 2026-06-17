'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw, Wallet } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatXlmAmount, getXlmBalance } from '@/lib/stellar'
import { useWallet } from './wallet-context-provider'

type BalanceState = 'idle' | 'loading' | 'ready' | 'error'

/**
 * XLM balance badge — the Stellar equivalent of the old SOL balance pill.
 * Reads the native XLM balance (in stroops) via Horizon, formats it for
 * display, and refreshes on demand.
 */
export function WalletBalanceBadge({ compact = false }: { compact?: boolean }) {
  const { connected, publicKey } = useWallet()
  const [balance, setBalance] = useState<number | null>(null)
  const [state, setState] = useState<BalanceState>('idle')
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadBalance() {
      if (!connected || !publicKey) {
        setBalance(null)
        setState('idle')
        return
      }

      setState('loading')

      try {
        const stroops = await getXlmBalance(publicKey)

        if (!cancelled) {
          setBalance(stroops)
          setState('ready')
        }
      } catch {
        if (!cancelled) {
          setBalance(null)
          setState('error')
        }
      }
    }

    loadBalance()

    return () => {
      cancelled = true
    }
  }, [connected, publicKey, refreshKey])

  if (!connected) {
    return (
      <div className="flex min-h-10 items-center gap-2 rounded-lg border border-cyan-500/20 bg-slate-900/70 px-3 text-sm text-slate-300">
        <Wallet className="size-4 text-cyan-300" aria-hidden="true" />
        Wallet required
      </div>
    )
  }

  if (state === 'loading') {
    return (
      <div className="flex min-h-10 items-center gap-2 rounded-lg border border-cyan-500/20 bg-slate-900/70 px-3">
        <Skeleton className="h-4 w-24 bg-cyan-500/10" />
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="flex min-h-10 items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-sm text-red-200">
        <AlertTriangle className="size-4" aria-hidden="true" />
        {!compact && <span>Balance unavailable</span>}
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={refresh}
          aria-label="Retry loading XLM balance"
          className="text-red-100 hover:bg-red-400/10 hover:text-white"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-10 items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 text-sm text-slate-100">
      <Wallet className="size-4 text-cyan-300" aria-hidden="true" />
      <span className="font-mono tabular-nums">
        {formatXlmAmount(balance ?? 0)}
      </span>
      <span className="text-cyan-200">XLM</span>
      {!compact && (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={refresh}
          aria-label="Refresh XLM balance"
          className="text-cyan-100 hover:bg-cyan-400/10 hover:text-white"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}