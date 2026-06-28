import { Link } from "@tanstack/react-router";
import { Sparkles, Wallet, ChevronDown, Globe2, AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { useWallet } from "@/hooks/use-wallet";
import { toast } from "sonner";
import { UsernameDialog, getStoredUsername } from "@/components/UsernameDialog";

function shortAddr(a: string) {
  return `${a.slice(0, 4)}...${a.slice(-4)}`;
}

/**
 * Top-of-page header — wired to the real Freighter wallet via `useWallet`.
 *
 * - When Freighter is not installed the Connect button surfaces a clear hint
 *   instead of failing silently.
 * - While the wallet is being rehydrated from storage we show a subtle
 *   spinner so the UI does not flash between connected/disconnected.
 */
export function Header() {
  const { publicKey, balance, isInstalled, isLoading, isConnecting, connect, disconnect } =
    useWallet();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState<string | null>(getStoredUsername());
  const [usernameDialogOpen, setUsernameDialogOpen] = useState(false);

  // When the wallet finishes connecting for the first time, ask for a
  // display name (skipped if we already have one stored).
  useEffect(() => {
    if (publicKey && !username) setUsernameDialogOpen(true);
  }, [publicKey, username]);

  const handleConnect = async () => {
    if (!isInstalled) {
      toast.error("Freighter not detected", {
        description: "Install Freighter from freighter.app to play Zuno.",
      });
      return;
    }
    await connect();
  };

  return (
    <header className="sticky top-0 z-40 w-full">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4">
        <Link to="/" className="group flex items-center gap-2.5">
          <div className="relative grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-stellar to-crypto glow-stellar animate-pulse-glow">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-display text-xl font-bold tracking-tight">
            <span className="text-gradient-stellar">ZUNO</span>
          </span>
        </Link>

        <div className="hidden items-center gap-2 rounded-full px-3 py-1.5 glass md:flex">
          <Globe2 className="h-3.5 w-3.5 text-stellar animate-spin-slow" />
          <span className="text-xs text-muted-foreground">Stellar Testnet</span>
          <span className="ml-1 h-1.5 w-1.5 rounded-full bg-neon animate-pulse-glow" />
        </div>

        {publicKey ? (
          <div className="relative">
            <button
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-2.5 rounded-full px-2 py-1.5 glass hover:glass-strong transition"
            >
              <div
                className="h-7 w-7 rounded-full"
                style={{
                  background: `conic-gradient(from 0deg, oklch(0.78 0.16 220), oklch(0.7 0.22 305), oklch(0.85 0.16 85), oklch(0.78 0.16 220))`,
                }}
              />
              <div className="flex flex-col items-start leading-tight">
                <span className="font-mono text-xs">
                  {username ?? shortAddr(publicKey)}
                </span>
                <span className="text-[10px] text-gold">{parseFloat(balance).toFixed(2)} XLM</span>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            {open && (
              <div className="absolute right-0 mt-2 w-44 rounded-xl glass-strong p-1 shadow-2xl">
                <button
                  onClick={() => {
                    setOpen(false);
                    disconnect();
                    toast.success("Wallet disconnected");
                  }}
                  className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-white/5"
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={handleConnect}
            disabled={isConnecting || isLoading}
            className="flex items-center gap-2 rounded-full bg-gradient-to-r from-stellar to-crypto px-4 py-2 text-sm font-semibold text-primary-foreground glow-stellar hover:scale-[1.02] transition disabled:opacity-60"
          >
            {isConnecting || isLoading ? (
              <>
                <span className="h-2 w-2 rounded-full bg-foreground animate-pulse-glow" />
                Connecting...
              </>
            ) : isInstalled ? (
              <>
                <Wallet className="h-4 w-4" />
                Connect Wallet
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4" />
                Install Freighter
              </>
            )}
          </button>
        )}
      </div>

      <UsernameDialog
        open={usernameDialogOpen}
        onSaved={(name) => {
          setUsername(name);
          setUsernameDialogOpen(false);
          toast.success(`Welcome, ${name}!`);
        }}
      />
    </header>
  );
}
