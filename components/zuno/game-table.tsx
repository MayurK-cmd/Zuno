'use client'

import { useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import {
  ArrowLeft,
  MessageSquare,
  Megaphone,
  Shield,
  SkipForward,
  Users,
  Zap,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { truncateAddress } from '@/lib/solana'
import { UNOCard } from './uno-card'
import { WalletBalanceBadge } from './wallet-balance-badge'
import { GameOverDialog } from './game-over-dialog'
import {
  describeCard,
  INITIAL_HAND,
  INITIAL_OPPONENTS,
  TURN_LIMIT_SECONDS,
  type GameCard,
  type GameOutcome,
  type Player,
  type StandardColor,
} from './game-types'
import { useTransactionToasts } from './transaction-toast'
import { WildColorSelector } from './wild-color-selector'

interface GameTableProps {
  playerName: string
  roomId: string
  onBack: () => void
}

export function GameTable({ playerName, roomId, onBack }: GameTableProps) {
  const { publicKey } = useWallet()
  const { runTransactionPipeline, showTransactionFailure } =
    useTransactionToasts()
  const [selectedCard, setSelectedCard] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [playerHand, setPlayerHand] = useState<GameCard[]>(INITIAL_HAND)
  const [opponents, setOpponents] = useState<Player[]>(INITIAL_OPPONENTS)
  const [currentCard, setCurrentCard] = useState<GameCard>({
    id: 'current',
    color: 'blue',
    type: 'number',
    value: 7,
    playable: true,
  })
  const [gameLog, setGameLog] = useState<string[]>([
    'Game started',
    'Bob is on the clock',
  ])
  const [turnTimer, setTurnTimer] = useState(18)
  const [zunoCalled, setZunoCalled] = useState(false)
  const [pendingWildCard, setPendingWildCard] = useState<GameCard | null>(null)
  const [wildSelectorOpen, setWildSelectorOpen] = useState(false)
  const [gameOutcome, setGameOutcome] = useState<GameOutcome | null>(null)

  const activeOpponent = opponents.find((opponent) => opponent.isCurrentTurn)
  const showZunoButton = playerHand.length > 0 && playerHand.length <= 2
  const timerProgress = (turnTimer / TURN_LIMIT_SECONDS) * 100

  useEffect(() => {
    if (!activeOpponent || isProcessing || gameOutcome || turnTimer <= 0) return

    const timerId = window.setInterval(() => {
      setTurnTimer((seconds) => Math.max(0, seconds - 1))
    }, 1000)

    return () => window.clearInterval(timerId)
  }, [activeOpponent, gameOutcome, isProcessing, turnTimer])

  const processCardPlay = async (
    card: GameCard,
    declaredColor?: StandardColor,
  ) => {
    setSelectedCard(card.id)
    setIsProcessing(true)
    setGameLog((previous) => [
      `${playerName} is generating a private play proof`,
      ...previous,
    ])

    try {
      const txHash = await runTransactionPipeline('Move confirmed')
      const nextHand = playerHand.filter((handCard) => handCard.id !== card.id)

      setCurrentCard({
        ...card,
        color: declaredColor ?? card.color,
        playable: true,
      })
      setPlayerHand(nextHand)
      setGameLog((previous) => [
        `${playerName} played ${describeCard(card, declaredColor)}`,
        ...previous,
      ])

      if (nextHand.length === 0) {
        setGameOutcome({
          result: 'win',
          winner: playerName,
          pot: 1.8,
          txHash,
          turns: 24,
          mostDrawn: 'Bob',
        })
      }
    } catch {
      showTransactionFailure()
    } finally {
      setIsProcessing(false)
      setSelectedCard(null)
      setPendingWildCard(null)
    }
  }

  const handlePlayCard = async (cardId: string) => {
    const card = playerHand.find((handCard) => handCard.id === cardId)
    if (!card || !card.playable || isProcessing) return

    if (card.type === 'wild' || card.type === 'wild-draw') {
      setSelectedCard(card.id)
      setPendingWildCard(card)
      setWildSelectorOpen(true)
      return
    }

    await processCardPlay(card)
  }

  const handleWildColor = async (color: StandardColor) => {
    if (!pendingWildCard) return

    setWildSelectorOpen(false)
    await processCardPlay(pendingWildCard, color)
  }

  const handleDrawCard = async () => {
    if (isProcessing) return

    setIsProcessing(true)
    try {
      await runTransactionPipeline('Hand updated')
      setPlayerHand((previous) => [
        ...previous,
        {
          id: `draw-${Date.now()}`,
          color: 'yellow',
          type: 'number',
          value: 4,
          playable: false,
        },
      ])
      setZunoCalled(false)
      setGameLog((previous) => [`${playerName} drew a private card`, ...previous])
    } finally {
      setIsProcessing(false)
    }
  }

  const handleCallZuno = async () => {
    if (!showZunoButton || zunoCalled || isProcessing) return

    setIsProcessing(true)
    try {
      await runTransactionPipeline('ZUNO locked')
      setZunoCalled(true)
      setGameLog((previous) => [`${playerName} called ZUNO`, ...previous])
    } finally {
      setIsProcessing(false)
    }
  }

  const handleCatchOpponent = async (opponentId: string) => {
    const opponent = opponents.find((player) => player.id === opponentId)
    if (!opponent || opponent.hasCalledZuno || opponent.cardCount !== 1) return

    setIsProcessing(true)
    try {
      await runTransactionPipeline('Penalty confirmed')
      setOpponents((previous) =>
        previous.map((player) =>
          player.id === opponentId
            ? {
                ...player,
                cardCount: player.cardCount + 2,
                hasCalledZuno: true,
                drawsTaken: player.drawsTaken + 2,
              }
            : player,
        ),
      )
      setGameLog((previous) => [
        `${playerName} caught ${opponent.name}. Penalty: +2 cards`,
        ...previous,
      ])
    } finally {
      setIsProcessing(false)
    }
  }

  const handleForceSkip = async () => {
    if (!activeOpponent || turnTimer > 0 || isProcessing) return

    const activeIndex = opponents.findIndex(
      (opponent) => opponent.id === activeOpponent.id,
    )
    const nextIndex = activeIndex >= 0 ? (activeIndex + 1) % opponents.length : 0

    setIsProcessing(true)
    try {
      await runTransactionPipeline('AFK skip confirmed')
      setOpponents((previous) =>
        previous.map((opponent, index) => {
          if (opponent.id === activeOpponent.id) {
            return {
              ...opponent,
              isCurrentTurn: false,
              cardCount: opponent.cardCount + 1,
              drawsTaken: opponent.drawsTaken + 1,
            }
          }

          return { ...opponent, isCurrentTurn: index === nextIndex }
        }),
      )
      setTurnTimer(TURN_LIMIT_SECONDS)
      setGameLog((previous) => [
        `${activeOpponent.name} timed out. Force skip executed`,
        ...previous,
      ])
    } finally {
      setIsProcessing(false)
    }
  }

  const handleClaimPot = async () => {
    if (!gameOutcome || gameOutcome.result !== 'win' || isProcessing) return

    setIsProcessing(true)
    try {
      await runTransactionPipeline('Pot claimed')
      setGameLog((previous) => [
        `${playerName} claimed ${gameOutcome.pot} SOL`,
        ...previous,
      ])
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-black">
      <div className="border-b border-cyan-500/20 bg-gradient-to-r from-slate-900/80 to-slate-800/80 px-4 py-4 backdrop-blur-xl sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <Button
              type="button"
              onClick={onBack}
              className="min-h-10 rounded-lg bg-slate-700 px-3 py-2 text-white hover:bg-slate-600"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back
            </Button>
            <div>
              <h1 className="bg-gradient-to-r from-cyan-400 to-green-400 bg-clip-text text-2xl font-black text-transparent">
                Game Room
              </h1>
              <p className="font-mono text-xs text-slate-400">{roomId}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-lg border border-cyan-500/20 bg-slate-950/50 px-3 py-2 text-right">
              <p className="text-xs text-slate-300">Playing as</p>
              <p className="font-bold text-cyan-300">
                {playerName}
                {publicKey && (
                  <span className="ml-2 font-mono text-xs font-normal text-slate-400">
                    {truncateAddress(publicKey)}
                  </span>
                )}
              </p>
            </div>
            <WalletBalanceBadge compact />
            <WalletMultiButton className="zuno-wallet-button min-h-10 rounded-lg border border-cyan-500/30 bg-slate-900/80 px-3 text-sm font-semibold text-cyan-100" />
            <div className="flex min-h-10 items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3">
              <Users className="size-4 text-cyan-300" aria-hidden="true" />
              <span className="text-sm text-slate-200">
                {opponents.length + 1} Players
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <aside className="order-2 max-h-56 overflow-y-auto border-t border-cyan-500/10 p-4 lg:order-1 lg:max-h-none lg:w-64 lg:border-r lg:border-t-0">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-400">
            Players
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {opponents.map((opponent) => (
              <PlayerPanel
                key={opponent.id}
                opponent={opponent}
                isProcessing={isProcessing}
                turnTimer={turnTimer}
                timerProgress={timerProgress}
                onCatch={handleCatchOpponent}
                onForceSkip={handleForceSkip}
              />
            ))}
          </div>
        </aside>

        <main className="order-1 flex min-h-[32rem] flex-1 flex-col items-center justify-center gap-8 overflow-y-auto p-4 sm:p-8 lg:order-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex min-h-10 items-center gap-3 rounded-lg border border-green-500/30 bg-gradient-to-r from-green-500/10 to-green-600/10 px-4 py-2 text-left text-xs font-medium text-green-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
              >
                <Shield className="size-4 text-green-300" aria-hidden="true" />
                ZK-proof verification - Hand secured by Noir
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="max-w-xs border border-cyan-500/30 bg-slate-950 text-slate-100"
            >
              Your cards are hashed locally. Only the cryptographic proof is
              sent to Solana.
            </TooltipContent>
          </Tooltip>

          <div className="grid w-full max-w-2xl grid-cols-2 items-end gap-8 sm:gap-16">
            <CardPile label="Discard">
              <UNOCard
                color={currentCard.color}
                type={currentCard.type}
                value={currentCard.value}
                size="large"
              />
            </CardPile>
            <CardPile label="Draw Deck">
              <button
                type="button"
                onClick={handleDrawCard}
                disabled={isProcessing}
                aria-busy={isProcessing}
                className="relative rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-50 motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out motion-safe:hover:scale-105 active:scale-95"
              >
                <div className="absolute inset-0 bg-cyan-500/20 blur-lg" />
                <UNOCard
                  color="blue"
                  type="number"
                  value={0}
                  backside
                  size="large"
                  className="pointer-events-none"
                />
              </button>
            </CardPile>
          </div>
        </main>

        <aside className="order-3 max-h-56 border-t border-cyan-500/10 p-4 lg:max-h-none lg:w-72 lg:border-l lg:border-t-0">
          <div className="mb-4 flex items-center gap-2">
            <MessageSquare className="size-4 text-cyan-300" aria-hidden="true" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">
              Game Log
            </h3>
          </div>
          <div className="max-h-40 space-y-2 overflow-y-auto lg:max-h-[calc(100vh-13rem)]">
            {gameLog.map((log, index) => (
              <div
                key={`${log}-${index}`}
                className="rounded border border-slate-800/70 bg-slate-900/60 p-2 text-xs text-slate-300"
              >
                {log}
              </div>
            ))}
          </div>
        </aside>
      </div>

      <div className="border-t border-cyan-500/20 bg-gradient-to-t from-slate-950 to-slate-900/50 p-4 backdrop-blur-xl sm:p-6">
        <div className="mx-auto max-w-7xl">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="text-sm font-bold uppercase tracking-wider text-slate-400">
                Your Hand
              </span>
              <p className="text-xs text-slate-500">
                {playerHand.length} card{playerHand.length !== 1 ? 's' : ''} -
                private commitment active
              </p>
            </div>
            {showZunoButton && (
              <Button
                type="button"
                onClick={handleCallZuno}
                disabled={isProcessing || zunoCalled}
                className="min-h-11 rounded-full border border-red-300/50 bg-gradient-to-r from-red-500 to-cyan-400 px-5 font-black text-black shadow-lg shadow-red-500/20 hover:from-red-400 hover:to-cyan-300"
              >
                <Megaphone className="size-4" aria-hidden="true" />
                {zunoCalled ? 'ZUNO locked' : 'ZUNO!'}
              </Button>
            )}
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {playerHand.length === 0 ? (
              <div className="flex min-h-32 w-full items-center justify-center rounded-xl border border-green-500/20 bg-green-500/10 text-sm text-green-100">
                Hand empty. Settlement is ready.
              </div>
            ) : (
              playerHand.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => handlePlayCard(card.id)}
                  disabled={!card.playable || isProcessing}
                  aria-label={`Play ${describeCard(card)}`}
                  aria-busy={selectedCard === card.id && isProcessing}
                  className="relative shrink-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed"
                >
                  <UNOCard
                    color={card.color}
                    type={card.type}
                    value={card.value}
                    isSelected={selectedCard === card.id}
                    isPlayable={card.playable}
                    size="medium"
                    className="pointer-events-none"
                  />
                  {selectedCard === card.id && isProcessing && (
                    <div className="absolute right-2 top-2 size-3 rounded-full bg-cyan-300 motion-safe:animate-pulse" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      <WildColorSelector
        open={wildSelectorOpen}
        onOpenChange={(open) => {
          setWildSelectorOpen(open)
          if (!open && !isProcessing) {
            setPendingWildCard(null)
            setSelectedCard(null)
          }
        }}
        onSelect={handleWildColor}
      />
      <GameOverDialog
        outcome={gameOutcome}
        open={Boolean(gameOutcome)}
        isClaiming={isProcessing}
        onClaim={handleClaimPot}
        onReturn={onBack}
      />
    </div>
  )
}

function PlayerPanel({
  opponent,
  isProcessing,
  turnTimer,
  timerProgress,
  onCatch,
  onForceSkip,
}: {
  opponent: Player
  isProcessing: boolean
  turnTimer: number
  timerProgress: number
  onCatch: (opponentId: string) => void
  onForceSkip: () => void
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        opponent.isCurrentTurn
          ? 'border-yellow-400/60 bg-yellow-500/10'
          : 'border-slate-700/50 bg-slate-900/50'
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold text-white">{opponent.name}</span>
        <div className="flex items-center gap-2">
          {opponent.cardCount === 1 && !opponent.hasCalledZuno && (
            <button
              type="button"
              onClick={() => onCatch(opponent.id)}
              disabled={isProcessing}
              aria-label={`Catch ${opponent.name} for missing ZUNO`}
              className="flex size-10 items-center justify-center rounded-full border border-red-400/40 bg-red-500/15 text-red-200 hover:bg-red-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Megaphone className="size-4" aria-hidden="true" />
            </button>
          )}
          {opponent.isCurrentTurn && (
            <Zap className="size-4 text-yellow-300" aria-hidden="true" />
          )}
        </div>
      </div>
      <div className="text-sm text-slate-300">
        {opponent.cardCount} card{opponent.cardCount !== 1 ? 's' : ''}
      </div>
      {opponent.cardCount === 1 && !opponent.hasCalledZuno && (
        <p className="mt-2 text-xs text-red-200">
          Missed ZUNO. Call out available.
        </p>
      )}
      {opponent.isCurrentTurn && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span>Turn timer</span>
            <span className="font-mono tabular-nums">{turnTimer}s</span>
          </div>
          <Progress
            value={timerProgress}
            className="h-1.5 bg-slate-800 [&_[data-slot=progress-indicator]]:bg-cyan-300"
          />
          {turnTimer === 0 && (
            <Button
              type="button"
              size="sm"
              onClick={onForceSkip}
              disabled={isProcessing}
              className="min-h-10 w-full rounded-lg bg-cyan-400 text-black hover:bg-cyan-300"
            >
              <SkipForward className="size-4" aria-hidden="true" />
              Force Skip
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

function CardPile({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
        {label}
      </span>
      <div className="relative">
        <div className="absolute inset-0 bg-cyan-500/20 blur-lg" />
        {children}
      </div>
    </div>
  )
}
