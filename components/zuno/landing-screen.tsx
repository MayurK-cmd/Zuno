'use client'

import { useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { ShieldCheck, WalletCards } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { truncateAddress } from '@/lib/solana'

interface LandingScreenProps {
  onStart: (name: string) => void
}

export function LandingScreen({ onStart }: LandingScreenProps) {
  const { connected, connecting, publicKey } = useWallet()
  const [playerName, setPlayerName] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = playerName.trim()

    if (!connected) {
      setError('Connect a wallet first')
      return
    }

    if (!trimmed) {
      setError('Please enter your name')
      return
    }

    if (trimmed.length < 2) {
      setError('Name must be at least 2 characters')
      return
    }

    if (trimmed.length > 20) {
      setError('Name must be less than 20 characters')
      return
    }

    onStart(trimmed)
  }

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-y-auto bg-slate-950 px-4 py-10">
      <video
        aria-hidden="true"
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-80 motion-reduce:hidden"
      >
        <source src="/bg.mp4" type="video/mp4" />
      </video>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-slate-950/85 via-slate-950/45 to-black/85" />

      <div className="relative z-10 flex w-full flex-col items-center justify-center">
        <div className="mb-10 text-center">
          <div className="mb-6 inline-block">
            <div className="relative">
              <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-cyan-500 to-green-500 opacity-30 blur-3xl motion-safe:animate-pulse" />
              <div className="relative bg-gradient-to-br from-cyan-500 to-green-500 bg-clip-text text-6xl font-black tracking-tighter text-transparent sm:text-8xl">
                ZUNO
              </div>
            </div>
          </div>
          <p className="mt-4 text-base font-light text-slate-300 sm:text-lg">
            Zero-knowledge UNO on Solana
          </p>
        </div>

        <div className="w-full max-w-md">
          <div className="rounded-xl border border-cyan-500/20 bg-gradient-to-b from-slate-800/65 to-slate-950/75 p-6 backdrop-blur-xl sm:p-8">
            <div className="mb-8 flex items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-500/10 text-cyan-200">
                <WalletCards className="size-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">Connect to Play</h2>
                <p className="mt-1 text-sm text-slate-300">
                  Bind your Zuno identity to a Solana wallet before joining a
                  table.
                </p>
              </div>
            </div>

            <div className="mb-6 rounded-lg border border-cyan-500/20 bg-slate-950/80 p-4 text-center">
              <div className="mb-3 flex items-center justify-center gap-2 text-sm font-semibold text-cyan-200">
                <ShieldCheck className="size-4" aria-hidden="true" />
                Wallet authentication
              </div>
              <WalletMultiButton className="zuno-wallet-button min-h-11 w-full justify-center rounded-lg bg-gradient-to-r from-cyan-500 to-green-500 px-4 py-3 text-sm font-bold text-black motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out motion-safe:hover:scale-[1.02]" />
              <p className="mt-3 text-xs text-slate-400">
                {connected && publicKey
                  ? `Connected: ${truncateAddress(publicKey)}`
                  : connecting
                    ? 'Waiting for your wallet approval...'
                    : 'Phantom, Solflare, and wallet-standard providers are supported.'}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="player-name"
                  className="mb-2 block text-sm font-medium text-slate-200"
                >
                  Player name
                </label>
                <input
                  id="player-name"
                  type="text"
                  value={playerName}
                  onChange={(e) => {
                    setPlayerName(e.target.value)
                    setError('')
                  }}
                  disabled={!connected}
                  placeholder="Enter your name"
                  autoComplete="nickname"
                  aria-invalid={Boolean(error)}
                  aria-describedby="player-name-help"
                  className="min-h-11 w-full rounded-lg border border-cyan-500/30 bg-slate-900/80 px-4 py-3 text-white placeholder:text-slate-500 focus-visible:border-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-50"
                  maxLength={20}
                />
                <div className="mt-2 flex justify-between gap-4">
                  <span
                    id="player-name-help"
                    role={error ? 'alert' : undefined}
                    className={`text-xs ${error ? 'text-red-300' : 'text-slate-400'}`}
                  >
                    {error ||
                      (connected
                        ? 'Your on-chain table identity'
                        : 'Connect a wallet to register your name')}
                  </span>
                  <span className="text-xs text-slate-500">
                    {playerName.length}/20
                  </span>
                </div>
              </div>

              <Button
                type="submit"
                disabled={!connected}
                className="h-12 w-full rounded-lg bg-gradient-to-r from-cyan-500 to-green-500 text-lg font-bold text-black motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out motion-safe:hover:scale-[1.02] active:scale-95 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-400"
              >
                {connected ? 'Join Lobby' : 'Connect Wallet First'}
              </Button>
            </form>

            <div className="mt-8 border-t border-slate-700 pt-8">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-cyan-400">1,234</div>
                  <div className="mt-1 text-xs text-slate-400">Games Played</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-400">5,678</div>
                  <div className="mt-1 text-xs text-slate-400">SOL Wagered</div>
                </div>
              </div>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-slate-400">
            Powered by Solana - zero-knowledge proofs - open source
          </p>
        </div>
      </div>
    </div>
  )
}
