'use client'

import { createContext, useContext, type ReactNode } from 'react'

import { useFreighter, type UseFreighter } from '@/hooks/use-freighter'

/**
 * Freighter-based wallet context for the whole app.
 *
 * The previous Solana implementation used `@solana/wallet-adapter-react`'s
 * `WalletProvider` and exposed a `useWallet()` hook to every component.
 * This file replaces that with a thin context layer around `useFreighter`,
 * so existing call-sites that imported `useWallet` from
 * `@solana/wallet-adapter-react` can be migrated by changing just the
 * import path.
 */
const FreighterContext = createContext<UseFreighter | null>(null)

export function WalletContextProvider({ children }: { children: ReactNode }) {
  const freighter = useFreighter()
  return (
    <FreighterContext.Provider value={freighter}>
      {children}
    </FreighterContext.Provider>
  )
}

/**
 * `useWallet` — uniform wallet interface used throughout the app.
 * Returns the same shape the old Solana hook did (`connected`,
 * `publicKey`, `sign`, etc.) so component-level migrations are minimal.
 */
export function useWallet(): UseFreighter {
  const v = useContext(FreighterContext)
  if (!v) {
    throw new Error('useWallet must be used inside WalletContextProvider')
  }
  return v
}