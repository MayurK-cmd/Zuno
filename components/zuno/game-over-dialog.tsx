'use client'

import type { ReactNode } from 'react'
import {
  CircleGauge,
  ExternalLink,
  Flag,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { truncateAddress } from '@/lib/solana'
import type { GameOutcome } from './game-types'

export function GameOverDialog({
  outcome,
  open,
  isClaiming,
  onClaim,
  onReturn,
}: {
  outcome: GameOutcome | null
  open: boolean
  isClaiming: boolean
  onClaim: () => void
  onReturn: () => void
}) {
  if (!outcome) return null

  const explorerUrl = `https://solscan.io/tx/${outcome.txHash}?cluster=devnet`
  const didWin = outcome.result === 'win'

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className="overflow-hidden border-cyan-500/30 bg-slate-950/95 text-white shadow-2xl shadow-cyan-500/10 backdrop-blur-2xl sm:max-w-4xl"
      >
        {didWin && <ConfettiBurst />}
        <DialogHeader className="relative text-center sm:text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-2xl border border-cyan-300/40 bg-cyan-500/10 text-cyan-200">
            {didWin ? (
              <Trophy className="size-8" aria-hidden="true" />
            ) : (
              <Flag className="size-8" aria-hidden="true" />
            )}
          </div>
          <DialogTitle className="bg-gradient-to-r from-cyan-300 to-green-300 bg-clip-text text-4xl font-black text-transparent">
            {didWin ? `YOU WIN! +${outcome.pot} SOL` : `${outcome.winner} Wins`}
          </DialogTitle>
          <DialogDescription className="mx-auto max-w-xl text-slate-300">
            {didWin
              ? 'The final hand commitment reached zero cards. Claim the settled pot back to your connected wallet.'
              : `The pot closed at ${outcome.pot} SOL. Return to the lobby for a rematch.`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-4">
          <SettlementStat
            icon={<Sparkles className="size-4" aria-hidden="true" />}
            label="Final pot"
            value={`${outcome.pot} SOL`}
          />
          <SettlementStat
            icon={<CircleGauge className="size-4" aria-hidden="true" />}
            label="Turns"
            value={outcome.turns.toString()}
          />
          <SettlementStat
            icon={<Users className="size-4" aria-hidden="true" />}
            label="Most draws"
            value={outcome.mostDrawn}
          />
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-cyan-500/20 bg-slate-900/70 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-slate-400">
              <ExternalLink className="size-4" aria-hidden="true" />
              Settlement
            </div>
            <div className="font-mono text-sm text-cyan-200">
              {truncateAddress(outcome.txHash, 5)}
            </div>
          </a>
        </div>

        <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-4">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-400">
            Post-game stats
          </h3>
          <div className="grid gap-3 text-sm text-slate-200 sm:grid-cols-3">
            <div className="rounded-lg bg-slate-950/60 p-3">
              Winner:{' '}
              <span className="font-semibold text-cyan-200">
                {outcome.winner}
              </span>
            </div>
            <div className="rounded-lg bg-slate-950/60 p-3">
              Proofs verified:{' '}
              <span className="font-mono text-green-200">18</span>
            </div>
            <div className="rounded-lg bg-slate-950/60 p-3">
              Timeout actions:{' '}
              <span className="font-mono text-yellow-200">1</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={onReturn}
            className="min-h-11 bg-slate-800 text-white hover:bg-slate-700"
          >
            Return to Lobby
          </Button>
          {didWin && (
            <Button
              type="button"
              onClick={onClaim}
              disabled={isClaiming}
              className="min-h-11 bg-gradient-to-r from-cyan-500 to-green-500 font-bold text-black hover:from-cyan-400 hover:to-green-400"
            >
              Claim Pot to Wallet
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SettlementStat({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-cyan-500/20 bg-slate-900/70 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-slate-400">
        {icon}
        {label}
      </div>
      <div className="font-mono text-lg font-bold tabular-nums text-white">
        {value}
      </div>
    </div>
  )
}

function ConfettiBurst() {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      {Array.from({ length: 18 }).map((_, index) => (
        <span key={index} className="zuno-confetti-piece" />
      ))}
    </div>
  )
}
