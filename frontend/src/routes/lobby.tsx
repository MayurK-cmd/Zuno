import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, Plus, Copy, Users, Sparkles, Loader2 } from "lucide-react";
import { Starfield } from "@/components/Starfield";
import { Header } from "@/components/Header";
import { useWallet } from "@/hooks/use-wallet";
import { initializeRoom, joinRoom } from "@/lib/contract-calls";
import { xlmToStroops, formatXlm, getGameRoom } from "@/lib/stellar";
import { storeHostMeta, appendToRoster } from "@/lib/host-meta";
import { displayRoomIdToU64 } from "@/lib/room-id";
import { toast } from "sonner";

export const Route = createFileRoute("/lobby")({
  head: () => ({
    meta: [
      { title: "Lobby — Zuno" },
      { name: "description", content: "Create or join a Zuno game on Stellar." },
    ],
  }),
  component: Lobby,
});

interface Room {
  id: string;
  host: string;
  players: number;
  max: number;
  pot: number;
  status: "Waiting" | "In Progress";
}

function shortAddr(a: string) {
  if (a.length < 12) return a;
  return `${a.slice(0, 4)}...${a.slice(-4)}`;
}

/**
 * Generate a fresh, human-friendly room id ("ZUNO-XXXX") using a CSPRNG.
 * The on-chain room id is the numeric millisecond timestamp — this string
 * id is purely for display and the game route URL.
 */
function generateRoomId(): string {
  const buf = new Uint8Array(2);
  crypto.getRandomValues(buf);
  const code = Array.from(buf)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .toUpperCase()
    .slice(0, 4);
  return `ZUNO-${code}`;
}

function Lobby() {
  const { publicKey, sign } = useWallet();
  const navigate = useNavigate();
  const [stake, setStake] = useState(5);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [myRooms, setMyRooms] = useState<Room[]>([]);

  // Rooms created by the current player appear under "Your Rooms" above.
  // Other players' rooms can only be joined via a shared invite link —
  // there is no global on-chain room index yet. The "Join a Game" list is
  // therefore empty by design.
  const discoveredRooms = useMemo<Room[]>(() => [], []);

  const filtered = useMemo(
    () =>
      discoveredRooms.filter(
        (r) =>
          !query ||
          r.id.toLowerCase().includes(query.toLowerCase()) ||
          r.host.toLowerCase().includes(query.toLowerCase()),
      ),
    [query, discoveredRooms],
  );

  const createRoom = async () => {
    if (!publicKey) {
      toast.error("Connect your wallet first");
      return;
    }
    setCreating(true);

    try {
      const id = generateRoomId();
      // Use the hash of the display id as the on-chain room id. This way
      // the URL alone (e.g. /game/ZUNO-A14F) is enough for joiners to
      // compute the same id without any extra metadata — and the host
      // doesn't need to share a separate numeric id via localStorage.
      const roomIdNumeric = displayRoomIdToU64(id);
      const stakeStroops = xlmToStroops(stake);
      // The current contract stores the seed bytes verbatim under
      // `commit_reveal_seed` and `reveal_randomness` byte-compares the
      // reveal against that. So we must pass the raw 32-byte seed, NOT a
      // Poseidon2 commitment hash of it. The Poseidon2 commit-reveal
      // protocol is on the Phase 2 roadmap once the Soroban host
      // exposes the BN254 primitive (see reveal_randomness.rs TODO).
      const seedBytes = new Uint8Array(32);
      crypto.getRandomValues(seedBytes);
      const seedHex = Array.from(seedBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const txHash = await initializeRoom(sign, {
        host: publicKey,
        roomId: roomIdNumeric,
        stakeStroops,
        seedCommitment: seedHex,
      });

      // ── Verify the room actually landed on-chain ────────────────
      // `submitAndAwait` polls the tx to SUCCESS before returning, so we
      // know the host's `initialize_room` call was accepted. But the
      // public Soroban testnet RPC indexes storage writes asynchronously,
      // so a freshly-landed tx can be missing from `getContractData` for
      // a few seconds. Retry briefly to ride out that race before
      // giving up — this prevents false "Room was not created on-chain"
      // toasts when the room is actually there.
      let verifyRoom = await getGameRoom(roomIdNumeric);
      for (let i = 0; i < 5 && (!verifyRoom || verifyRoom.players.length === 0); i++) {
        // 600ms, 1.2s, 1.8s, 2.4s — total ~6s of retries.
        await new Promise((r) => setTimeout(r, 600 * (i + 1)));
        verifyRoom = await getGameRoom(roomIdNumeric);
      }
      if (!verifyRoom || verifyRoom.players.length === 0) {
        throw new Error(
          `Room was not created on-chain. tx=${txHash} ` +
            "(full hash for Stellar Expert lookup). " +
            "Common causes: missing XLM SAC trustline, or stake below the contract's minimum.",
        );
      }

      // Stash the host's seed locally so the game page can reveal it
      // once everyone has joined. Other players don't have this entry.
      // NOTE: `roomIdNumeric` is the on-chain u64 the contract stored the
      // room under. The game page MUST use this (not a hash of the display
      // string) when calling `start_game` / `reveal_randomness`, otherwise
      // the contract returns `RoomNotFound` (#22).
      storeHostMeta(id, { host: publicKey, seedHex, roomIdNumeric: roomIdNumeric.toString() });
      // Record the host in the public roster so the game page can render
      // the host on a fresh joiner's screen.
      appendToRoster(id, { address: publicKey, joinedAt: Date.now() });

      const room: Room = {
        id,
        host: shortAddr(publicKey),
        players: 1,
        max: 4,
        pot: stake,
        status: "Waiting",
      };
      setMyRooms((rs) => [room, ...rs]);
      toast.success("Room created!", {
        description: `TX ${txHash.slice(0, 8)}... — share ${location.origin}/game/${id} to invite players.`,
      });
      // Drop the host straight into the game page so they can hit "Start"
      // and reveal the seed for opponents joining via the shared link.
      navigate({ to: "/game/$roomId", params: { roomId: id } });
    } catch (err) {
      console.error(err);
      toast.error("Failed to create room", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCreating(false);
    }
  };

  const copyLink = (id: string) => {
    navigator.clipboard.writeText(`${location.origin}/game/${id}`);
    toast.success("Link copied to clipboard");
  };

  const joinExisting = async (id: string) => {
    if (!publicKey) {
      toast.error("Connect your wallet first");
      return;
    }
    setJoining(id);
    try {
      // For the hackathon we navigate directly; the contract will reject
      // the join if the room is full or not in the Waiting state.
      navigate({ to: "/game/$roomId", params: { roomId: id } });
      // When the on-chain room list becomes queryable, we'd call `joinRoom`
      // here and await its result before navigating.
      void joinRoom;
    } finally {
      setJoining(null);
    }
  };

  // Pre-compute a friendly pot string for the display side panel.
  const potDisplay = useMemo(() => formatXlm(xlmToStroops(stake)), [stake]);

  return (
    <div className="relative min-h-screen">
      <Starfield />
      <Header />

      <main className="mx-auto max-w-7xl px-4 pb-16">
        <div className="mb-8 mt-4">
          <h1 className="font-display text-3xl font-bold md:text-4xl">Game Lobby</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a new game or jump into an existing one.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
          {/* Left: create + my rooms */}
          <div className="space-y-6">
            <div className="rounded-2xl p-6 glass">
              <h2 className="font-display text-lg font-semibold">Create a New Game</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Set your stake. Winner takes the pot.
                <span className="ml-2 text-gold font-mono">{potDisplay} XLM</span>
              </p>

              <label className="mt-5 block text-xs font-medium text-muted-foreground">
                Stake amount (XLM)
              </label>
              <div className="mt-2 flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
                <Sparkles className="h-4 w-4 text-stellar" />
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={stake}
                  onChange={(e) =>
                    setStake(Math.max(1, Math.min(100, Number(e.target.value) || 1)))
                  }
                  className="w-full bg-transparent text-lg font-mono font-semibold outline-none"
                />
                <span className="text-xs text-gold">XLM</span>
              </div>
              <input
                type="range"
                min={1}
                max={100}
                value={stake}
                onChange={(e) => setStake(Number(e.target.value))}
                className="mt-3 w-full accent-stellar"
              />
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>1 XLM</span>
                <span>100 XLM</span>
              </div>

              <button
                onClick={createRoom}
                disabled={creating || !publicKey}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-stellar to-crypto px-4 py-3 text-sm font-semibold text-primary-foreground glow-stellar hover:scale-[1.01] transition disabled:opacity-60"
              >
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Initializing room on-chain...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" /> Create Game
                  </>
                )}
              </button>
            </div>

            <div>
              <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Your Rooms
              </h2>
              {myRooms.length === 0 ? (
                <div className="rounded-2xl p-6 glass text-sm text-muted-foreground">
                  You haven't created any rooms yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {myRooms.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded-2xl p-4 glass glow-stellar"
                    >
                      <div>
                        <div className="font-mono text-sm font-semibold">{r.id}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {r.players}/{r.max} players ·{" "}
                          <span className="text-gold">{r.pot} XLM</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => copyLink(r.id)}
                          className="rounded-lg px-3 py-1.5 text-xs glass hover:glass-strong transition inline-flex items-center gap-1.5"
                        >
                          <Copy className="h-3 w-3" /> Copy
                        </button>
                        <Link
                          to="/game/$roomId"
                          params={{ roomId: r.id }}
                          className="rounded-lg bg-stellar px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:scale-105 transition"
                        >
                          Enter
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: available games */}
          <div>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-display text-lg font-semibold">Join a Game</h2>
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by Room ID or player"
                  className="w-56 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="rounded-2xl p-10 glass text-center">
                <Users className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">
                  No games available. Create one to get started, or join a friend via the invite link they share with you.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {filtered.map((r) => (
                  <div
                    key={r.id}
                    className="group rounded-2xl p-4 glass transition hover:-translate-y-1 hover:glass-strong"
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <div className="font-mono text-sm font-semibold">{r.id}</div>
                        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                          host {r.host}
                        </div>
                      </div>
                      <span
                        className={
                          r.status === "Waiting"
                            ? "rounded-full bg-neon/15 px-2 py-0.5 text-[10px] font-semibold text-neon ring-1 ring-neon/40 animate-pulse-glow"
                            : "rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-semibold text-gold ring-1 ring-gold/40"
                        }
                      >
                        {r.status}
                      </span>
                    </div>

                    <div className="mt-4 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        {Array.from({ length: r.max }).map((_, i) => (
                          <div
                            key={i}
                            className={`h-5 w-5 rounded-full ${
                              i < r.players
                                ? "bg-gradient-to-br from-stellar to-crypto ring-1 ring-white/30"
                                : "bg-white/5 ring-1 ring-white/10"
                            }`}
                          />
                        ))}
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          {r.players}/{r.max}
                        </span>
                      </div>
                      <div className="text-sm font-bold text-gold">{r.pot} XLM</div>
                    </div>

                    <button
                      onClick={() => joinExisting(r.id)}
                      disabled={r.status === "In Progress" || joining === r.id}
                      className="mt-4 w-full rounded-xl bg-stellar/90 px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-stellar disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
                    >
                      {joining === r.id ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" /> Joining...
                        </>
                      ) : r.status === "In Progress" ? (
                        "In Progress"
                      ) : (
                        "Join"
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
