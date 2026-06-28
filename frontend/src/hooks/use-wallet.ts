/**
 * `useWallet` — manages the Freighter wallet connection for the current
 * browser session. Persists the public key to localStorage so the user does
 * not have to reconnect on every page reload.
 */

import { useCallback, useEffect, useState } from "react";
import {
  connectWallet as freighterConnect,
  disconnectWallet as freighterDisconnect,
  getConnectedWallet,
  getStoredPublicKey,
  signTransaction,
  waitForFreighter,
} from "@/lib/wallet";
import { getXlmBalance } from "@/lib/stellar";

export interface UseWalletResult {
  publicKey: string | null;
  balance: string; // XLM as string
  isInstalled: boolean;
  isConnecting: boolean;
  isLoading: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  sign: (xdr: string) => Promise<string>;
  refreshBalance: () => Promise<void>;
}

export function useWallet(): UseWalletResult {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [balance, setBalance] = useState<string>("0");
  // Start as `false` — the actual detection runs in the effect below so we
  // don't get a stale "not installed" answer from a synchronous check that
  // races Freighter's content-script injection.
  const [isInstalled, setIsInstalled] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // On mount: poll for `window.freighter` to be injected, then try to
  // restore the previous session from storage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const installed = await waitForFreighter();
      if (cancelled) return;
      setIsInstalled(installed);

      const stored = getStoredPublicKey();
      if (!stored) {
        setIsLoading(false);
        return;
      }
      // Optimistically restore so the UI does not flicker, then verify
      // that Freighter still recognises this address.
      if (!cancelled) setPublicKey(stored);

      try {
        const live = await getConnectedWallet();
        if (cancelled) return;
        if (live && live === stored) {
          const bal = await getXlmBalance(stored);
          if (!cancelled) setBalance(bal);
        } else if (!live) {
          // Freighter no longer has this address authorised — drop it.
          if (!cancelled) {
            freighterDisconnect();
            setPublicKey(null);
          }
        }
      } catch {
        // Network error — keep the optimistic state so the UI still works.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const key = await freighterConnect();
      setPublicKey(key);
      const bal = await getXlmBalance(key);
      setBalance(bal);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to connect wallet";
      setError(msg);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    freighterDisconnect();
    setPublicKey(null);
    setBalance("0");
    setError(null);
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!publicKey) return;
    const bal = await getXlmBalance(publicKey);
    setBalance(bal);
  }, [publicKey]);

  const sign = useCallback(async (xdr: string) => signTransaction(xdr), []);

  return {
    publicKey,
    balance,
    isInstalled,
    isConnecting,
    isLoading,
    error,
    connect,
    disconnect,
    sign,
    refreshBalance,
  };
}
