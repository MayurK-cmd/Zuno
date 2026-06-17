'use client'

import { useWallet } from './wallet-context-provider'
import { truncateAddress } from '@/lib/stellar'
import { Button } from '@/components/ui/button'

interface ConnectWalletButtonProps {
  /** When `true`, the button is rendered in a compact form (no label, just
   *  the connect/address chip). */
  compact?: boolean
  /** Extra className passthrough so call-sites can keep their existing
   *  Tailwind sizing. */
  className?: string
}

/**
 * `ConnectWalletButton` — a Freighter‑only wallet connect button.
 *
 * Replaces `<WalletMultiButton />` from `@solana/wallet-adapter-react-ui`.
 * There is no equivalent published Freighter React component, so a small
 * local implementation is cleaner than pulling in a UI library.
 *
 * Behaviour:
 *   - Not connected → button calls `useFreighter().connect()`, which
 *     prompts Freighter for access and returns the active public key.
 *   - Connected → button shows a truncated address and a subtle hover
 *     hint to disconnect (Freighter itself doesn't expose programmatic
 *     disconnect, so we just clear local state).
 */
export function ConnectWalletButton({
  compact = false,
  className,
}: ConnectWalletButtonProps) {
  const { connected, connecting, publicKey, connect, disconnect } = useWallet()

  if (connected && publicKey) {
    if (compact) {
      return (
        <Button
          type="button"
          onClick={disconnect}
          aria-label={`Connected: ${publicKey}. Click to disconnect.`}
          className={
            'zuno-wallet-button min-h-10 rounded-lg border border-cyan-500/30 bg-slate-900/80 px-3 text-sm font-semibold text-cyan-100 ' +
            (className ?? '')
          }
        >
          {truncateAddress(publicKey)}
        </Button>
      )
    }
    return (
      <Button
        type="button"
        onClick={disconnect}
        aria-label={`Connected to ${publicKey}. Click to disconnect.`}
        className={
          'zuno-wallet-button min-h-11 w-full justify-center rounded-lg bg-gradient-to-r from-cyan-500 to-green-500 px-4 py-3 text-sm font-bold text-black ' +
          (className ?? '')
        }
      >
        {truncateAddress(publicKey)}
      </Button>
    )
  }

  const label = connecting
    ? 'Opening Freighter…'
    : compact
      ? 'Connect'
      : 'Connect Freighter'

  return (
    <Button
      type="button"
      onClick={connect}
      disabled={connecting}
      aria-busy={connecting}
      className={
        (compact
          ? 'zuno-wallet-button min-h-10 rounded-lg border border-cyan-500/30 bg-slate-900/80 px-3 text-sm font-semibold text-cyan-100 '
          : 'zuno-wallet-button min-h-11 w-full justify-center rounded-lg bg-gradient-to-r from-cyan-500 to-green-500 px-4 py-3 text-sm font-bold text-black ') +
        (className ?? '')
      }
    >
      {label}
    </Button>
  )
}