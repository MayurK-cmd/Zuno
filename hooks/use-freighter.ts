"use client"

import { useCallback, useEffect, useState } from "react"

import {
  isConnected,
  getAddress,
  getNetwork,
  signTransaction as freighterSignTransaction,
  WatchWalletChanges,
  requestAccess,
} from "@stellar/freighter-api"
/**
 * Minimal Freighter wallet hook — gives the rest of the app a uniform
 * `connected / publicKey / signTransaction` interface modelled on
 * `@solana/wallet-adapter-react`'s `useWallet` so call-sites can be
 * migrated cleanly.
 *
 * The full Freighter API also exposes hardware wallet support, multiple
 * accounts, etc.; we only need the basics to play Zuno.
 */
export interface UseFreighter {
  connected: boolean
  connecting: boolean
  publicKey: string | null
  network: string | null
  networkPassphrase: string | null
  error: string | null
  connect: () => Promise<void>
  disconnect: () => void
  sign: (xdr: string, networkPassphrase?: string) => Promise<string>
}

export function useFreighter(): UseFreighter {
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [network, setNetwork] = useState<string | null>(null)
  const [networkPassphrase, setNetworkPassphrase] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // On mount, ask Freighter if it already has an active session.
  useEffect(() => {
    let cancelled = false

    async function probe() {
      if (typeof window === "undefined") return
      try {
        const status = await isConnected()
        if (cancelled || status.error) return
        if (!status.isConnected) return

        const addrResult = await getAddress()
        if (cancelled || addrResult.error) return
        setPublicKey(addrResult.address)
        setConnected(true)

        const net = await getNetwork()
        if (cancelled || net.error) return
        setNetwork(net.network)
        setNetworkPassphrase(net.networkPassphrase)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    }

    probe()
    return () => {
      cancelled = true
    }
  }, [])

  // Watch for wallet change events (account switch, lock, etc.)
  useEffect(() => {
    if (typeof window === "undefined") return

    const watcher = new WatchWalletChanges(1000)
    const result = watcher.watch((params) => {
      if (params.error) return
      setPublicKey(params.address || null)
      setNetwork(params.network || null)
      setNetworkPassphrase(params.networkPassphrase || null)
      setConnected(Boolean(params.address))
    })

    return () => {
      if (!result.error) watcher.stop()
    }
  }, [])

  const connect = useCallback(async () => {
    setConnecting(true)
    setError(null)
    try {
      // requestAccess prompts the user if the site isn't authorised yet.
      const access = await requestAccess()
      if (access.error) {
        setError(access.error.message ?? "Freighter denied access")
        setConnecting(false)
        return
      }
      setPublicKey(access.address)
      setConnected(true)

      const net = await getNetwork()
      if (!net.error) {
        setNetwork(net.network)
        setNetworkPassphrase(net.networkPassphrase)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    // Freighter doesn't expose a programmatic disconnect — clearing local
    // state is the best we can do. The user can lock from the extension UI.
    setConnected(false)
    setPublicKey(null)
    setNetwork(null)
    setNetworkPassphrase(null)
  }, [])

  const sign = useCallback(
    async (xdr: string, networkPassphrase?: string) => {
      const result = await freighterSignTransaction(xdr, {
        networkPassphrase: networkPassphrase ?? networkPassphrase ?? undefined,
      })
      if (result.error) {
        throw new Error(result.error.message ?? "Freighter rejected signing")
      }
      return result.signedTxXdr
    },
    [networkPassphrase],
  )

  return {
    connected,
    connecting,
    publicKey,
    network,
    networkPassphrase,
    error,
    connect,
    disconnect,
    sign,
  }
}