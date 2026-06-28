import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Copy, Lock, Sparkles, Trophy, Loader2 } from "lucide-react";
import { Starfield } from "@/components/Starfield";
import { Header } from "@/components/Header";
import { useWallet } from "@/hooks/use-wallet";
import { useGameState } from "@/hooks/use-game-state";
import { useDeck } from "@/hooks/use-deck";
import { useProver } from "@/hooks/use-prover";
import { UnoCard, type UnoCardData, type CardColor, type CardValue } from "@/components/UnoCard";
import {
  callZuno as contractCallZuno,
  claimVictory as contractClaimVictory,
  drawCard as contractDrawCard,
  forceSkip as contractForceSkip,
  joinRoom as contractJoinRoom,
  playCard as contractPlayCard,
  revealRandomness as contractRevealRandomness,
  startGame as contractStartGame,
} from "@/lib/contract-calls";
import { computeNewHandHash, hashHand, hashCard, hexHashToDecimalField } from "@/lib/commitment";
import { isLegalPlay } from "@/lib/hand";
import { formatXlm } from "@/lib/stellar";
import {
  loadHostMeta,
  storeHostMeta,
  appendToRoster,
  readRoster,
  type HostMeta,
  type RosterEntry,
} from "@/lib/host-meta";
import { displayRoomIdToU64 } from "@/lib/room-id";
import { seedFromHash, seedLinkFor } from "@/lib/seed-link";
import { toast } from "sonner";
import type { Card, PlayCardWitness } from "@/lib/types";

export const Route = createFileRoute("/game/$roomId")({
  head: ({ params }) => ({
    meta: [
      { title: `Game ${params.roomId} — Zuno` },
      { name: "description", content: "Active Zuno game on Stellar." },
    ],
  }),
  component: GameTable,
});

// Display ↔ on-chain color mapping.
const COLOR_TO_NUM: Record<CardColor, number> = {
  red: 0,
  green: 1,
  blue: 2,
  yellow: 3,
  wild: 4,
};

function valueToNum(v: CardValue): number {
  if (v === "skip") return 10;
  if (v === "reverse") return 11;
  if (v === "+2") return 12;
  if (v === "wild") return 0;
  if (v === "+4") return 13;
  return typeof v === "number" ? v : 0;
}

function cardToChain(c: { color: CardColor; value: CardValue }): Card {
  return {
    color: COLOR_TO_NUM[c.color] as Card["color"],
    value: valueToNum(c.value),
    isWild: c.color === "wild" ? 1 : 0,
  };
}

interface LogEntry {
  id: number;
  text: string;
  color?: CardColor;
  highlight?: boolean;
  zuno?: boolean;
}

// On-chain color encoding (from `contracts/programs/zuno/src/state.rs`):
//   0 = Red, 1 = Green, 2 = Blue, 3 = Yellow, 4 = Wild.
// `COLORS[i]` must match that mapping exactly. The previous version had
// `"blue"` and `"green"` swapped at indices 1 and 2, which made any
// `deckCards[i].color === 1` (Green) render as blue in the UI and vice
// versa — clicking the visually-displayed "green" card then triggered
// the `Card out of sync` sanity guard because `deckCards[idx].color`
// was actually 2 (Blue), not 1 (Green).
const COLORS: CardColor[] = ["red", "green", "blue", "yellow"];

function GameTable() {
  const { roomId } = Route.useParams();
  const navigate = useNavigate();
  const { publicKey, sign } = useWallet();

  // Poll the on-chain game state. Until the indexer is live, this falls
  // back to a placeholder view (see `lib/stellar.ts::getGameRoom`).
  const { gameRoom, refetch: refetchGame } = useGameState(roomId);

  // Host-side bookkeeping: only the host's browser knows their seed and
  // that they're the host. Read once on mount — synchronously so the
  // first render already has the right roomIdNumeric (otherwise a quick
  // Start click fires before the effect runs and uses the wrong id).
  const [hostMeta, setHostMeta] = useState<HostMeta | null>(() => loadHostMeta(roomId));
  const [roster, setRoster] = useState<RosterEntry[]>(() => readRoster(roomId));
  useEffect(() => {
    setHostMeta(loadHostMeta(roomId));
    setRoster(readRoster(roomId));
  }, [roomId]);
  // Record ourselves in the public roster so the host's screen reflects
  // our presence. This is per-browser only — true cross-profile discovery
  // needs the indexer.
  useEffect(() => {
    if (!publicKey) return;
    appendToRoster(roomId, { address: publicKey, joinedAt: Date.now() });
    setRoster(readRoster(roomId));
  }, [publicKey, roomId]);
  const isHost = !!publicKey && !!hostMeta && hostMeta.host === publicKey;

  // Read the URL hash on mount. The host can share a `#seed=HEX` link with
  // joiners so they can derive their hand without needing the indexer. We
  // re-check on every render because React Router does not re-render this
  // component when only the hash changes (the path is the same).
  const [seedFromUrl, setSeedFromUrl] = useState<string | null>(() =>
    seedFromHash(typeof location !== "undefined" ? location.hash : ""),
  );
  useEffect(() => {
    const refresh = () => setSeedFromUrl(seedFromHash(location.hash));
    window.addEventListener("hashchange", refresh);
    return () => window.removeEventListener("hashchange", refresh);
  }, []);

  // Compute the on-chain u64 from the display id alone. The lobby now
// uses the same hash, so the URL is sufficient — no localStorage lookup
// required for joiners. `hostMeta.roomIdNumeric` is kept for back-compat
// with rooms created before the rename but should equal this value for
// any room created with the current lobby.
const numericRoomId = useMemo(() => displayRoomIdToU64(roomId), [roomId]);

  // Each profile gets a distinct 15-card slice of the seeded deck based
  // on its position in `gameRoom.players` (host = 0, first joiner = 1, …).
  // Until `gameRoom` populates (or for hosts before the joiner joins),
  // fall back to 0 — that's still correct for the host because
  // `initialize_room` always inserts the host first.
  const playerIndex = useMemo(() => {
    if (!gameRoom?.players || !publicKey) return 0;
    const idx = gameRoom.players.findIndex((p) => p.address === publicKey);
    return idx >= 0 ? idx : 0;
  }, [gameRoom?.players, publicKey]);

  // Joiner flow. Auto-joining silently was hiding errors like
  // "insufficient XLM" or transient RPC failures behind a #7 swallow.
  // Now: surface the actual error in a persistent banner with a Retry
  // button, so the user can see what went wrong and recover.
  type JoinState =
    | { kind: "idle" }
    | { kind: "joining" }
    | { kind: "joined"; txHash: string }
    | { kind: "already" }
    | { kind: "error"; message: string };
  const [joinState, setJoinState] = useState<JoinState>({ kind: "idle" });

  const tryJoin = async () => {
    if (!publicKey || !sign || isHost) return;
    setJoinState({ kind: "joining" });
    try {
      const hash = await contractJoinRoom(sign, publicKey, numericRoomId);
      setJoinState({ kind: "joined", txHash: hash });
      toast.success("Joined the room", { description: `TX ${hash.slice(0, 8)}...` });
      await refetchGame();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Contract error #7 = AlreadyInRoom, #6 = NotHost — both mean we're
      // already in the room. Treat as a non-error so the banner doesn't
      // look like a failure.
      if (/#7\b|#6\b/.test(msg)) {
        setJoinState({ kind: "already" });
        toast.info("Already in this room");
        return;
      }
      setJoinState({ kind: "error", message: msg });
      toast.error("Failed to join room", { description: msg });
    }
  };

  const { generateProof, generating } = useProver();

  // Derive (or restore) the local hand once the seed is available.
  // Until the indexer is live, only the host has the seed (in hostMeta).
  // Joiners get it from the URL hash the host shares after reveal. The
  // precedence order is:
  //   1. gameRoom.seed  — surfaced by the indexer (future).
  //   2. seedFromUrl    — `#seed=HEX` in location.hash (current).
  //   3. hostMeta.seedHex — host's localStorage (current).
  const seedForDeck = gameRoom?.seed ?? seedFromUrl ?? hostMeta?.seedHex ?? null;
  // eslint-disable-next-line no-console
  console.log(
    "[seed]",
    "gameRoom=", gameRoom?.seed?.slice(0, 8) ?? "null",
    "url=", seedFromUrl?.slice(0, 8) ?? "null",
    "hostMeta=", hostMeta?.seedHex?.slice(0, 8) ?? "null",
    "resolved=", seedForDeck?.slice(0, 8) ?? "null",
    "playerIndex=", playerIndex,
  );
  const {
    hand: deckCards,
    salt,
    status: deckStatus,
    error: deckError,
  } = useDeck(roomId, publicKey, seedForDeck, playerIndex);
  // eslint-disable-next-line no-console
  console.log(
    "[deck]",
    "deckCards.length=", deckCards.length,
    "salt prefix=", salt?.slice(0, 8) ?? "null",
    "salt.length=", salt?.length ?? 0,
    "deckStatus=", deckStatus,
    "deckError=", deckError,
    "deckCards[0..2]=", deckCards.slice(0, 3).map(c => `${c.color}/${c.value}/w${c.isWild}`).join(","),
  );
  const [hostBusy, setHostBusy] = useState<null | "starting" | "revealing">(null);
  const [hostStage, setHostStage] = useState<"Waiting" | "AwaitingReveal" | "Active">(
    "Waiting",
  );

  const handleStartGame = async () => {
    if (!publicKey || !sign || !isHost) return;
    // The numeric room id is now derived from the URL display id, so
    // hostMeta is only needed for the seed. Re-read in case it's stale.
    const meta = loadHostMeta(roomId);
    if (!meta?.seedHex) {
      toast.error("Missing seed for this room", {
        description: "Reload the page or re-create the room as host.",
      });
      return;
    }
    setHostBusy("starting");
    try {
      await contractStartGame(sign, publicKey, numericRoomId);
      storeHostMeta(roomId, { ...meta, startedAt: Date.now() });
      setHostMeta((prev) => (prev ? { ...prev, startedAt: Date.now() } : prev));
      setHostStage("AwaitingReveal");
      toast.success("Room started", { description: "Waiting for opponents, then reveal the seed." });
      await refetchGame();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Translate the Soroban contract error codes into human messages
      // so the host knows what to do. The full event-log dump is not
      // useful during a live demo.
      const friendly = translateContractError(msg);
      toast.error("Start game failed", { description: friendly });
    } finally {
      setHostBusy(null);
    }
  };

  const handleRevealSeed = async () => {
    if (!publicKey || !sign) return;
    const meta = loadHostMeta(roomId);
    if (!meta?.seedHex) {
      toast.error("Missing seed for this room");
      return;
    }
    setHostBusy("revealing");
    try {
      await contractRevealRandomness(sign, publicKey, numericRoomId, meta.seedHex);
      setHostStage("Active");
      toast.success("Seed revealed", { description: "Deck is live — game on!" });
      await refetchGame();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Reveal failed", { description: translateContractError(msg) });
    } finally {
      setHostBusy(null);
    }
  };

  const handleShareSeed = async () => {
    if (!isHost) return;
    const meta = loadHostMeta(roomId);
    if (!meta?.seedHex) {
      toast.error("Seed missing — reveal it first.");
      return;
    }
    const link = seedLinkFor(location.origin, roomId, meta.seedHex);
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Seed link copied", {
        description: "Send this exact URL to joiners (it contains #seed=…). They must reopen this link for their hand to derive.",
      });
    } catch (err) {
      // Fallback: open a prompt so the user can copy manually.
      window.prompt("Copy this seed link:", link);
    }
  };

  const [displayHand, setDisplayHand] = useState<UnoCardData[]>([]);
  const [topCard, setTopCard] = useState<UnoCardData>({ id: "top", color: "blue", value: 5 });
  const [turn, setTurn] = useState(3);
  const [timer, setTimer] = useState(45);
  const [selected, setSelected] = useState<string | null>(null);
  const [gameOver, setGameOver] = useState<{ winner: string; reward: number } | null>(null);
  const [log, setLog] = useState<LogEntry[]>([
    { id: 1, text: "Room joined — waiting for host to start", highlight: true },
  ]);

  // Mirror deck cards into the UI display model. The hand must stay
  // blank until the host reveals the deck seed (hostStage flips to
  // "Active"). After that, re-mirror whenever deckCards identity
  // changes — the most important case being a joiner whose
  // `playerIndex` flips from 0 to 1 once `joinRoom` lands on-chain.
  // The id encodes the deckCards slot (`c<i>` -> `deckCards[i]`), so
  // playSelected's sanity guard sees a consistent hand after a flip.
  useEffect(() => {
    if (hostStage !== "Active") {
      // eslint-disable-next-line no-console
      console.log(
        "[mirror] hostStage=!Active (", hostStage, "), displayHand.len=",
        displayHand.length, " deckStatus=", deckStatus,
      );
      if (displayHand.length > 0) setDisplayHand([]);
      return;
    }
    if (deckStatus !== "ready") {
      // eslint-disable-next-line no-console
      console.log("[mirror] hostStage=Active but deckStatus=", deckStatus);
      return;
    }
    // eslint-disable-next-line no-console
    console.log(
      "[mirror] populating displayHand from deckCards[0..7):",
      deckCards.slice(0, 7).map((c) => `${c.color}/${c.value}`).join(","),
      "salt prefix:", salt.slice(0, 8),
      "playerIndex=", playerIndex,
    );
    const display: UnoCardData[] = deckCards.slice(0, 7).map((c, i) => {
      const color = COLORS[c.color] ?? "wild";
      const value = cardDisplayValue(c);
      return { id: `c${i}`, color, value };
    });
    setDisplayHand(display);
  }, [deckCards, deckStatus, hostStage, salt, playerIndex]);

  // Surface deck derivation errors.
  useEffect(() => {
    if (deckError) {
      toast.error("Hand derivation failed", { description: deckError });
    }
  }, [deckError]);

  // Wire the on-chain top card into the local display once it arrives.
  useEffect(() => {
    if (!gameRoom?.topCard) return;
    const color = COLORS[gameRoom.topCard.color] ?? "wild";
    const value = cardDisplayValue(gameRoom.topCard);
    setTopCard({ id: "top", color, value });
  }, [gameRoom?.topCard]);

  // Timer countdown — purely visual until we wire it to the on-chain deadline.
  // When it expires the host can call `force_skip` to advance the turn past
  // an AFK player (see `programs/zuno/src/instructions/force_skip.rs`).
  // Gated on `hostStage === "Active"` so the clock doesn't burn down while
  // the joiner is still loading the seed or waiting for the host to reveal.
  const [timerExpired, setTimerExpired] = useState(false);
  useEffect(() => {
    if (gameOver || generating || hostStage !== "Active") return;
    const t = setInterval(() => {
      setTimer((v) => {
        if (v <= 1) {
          setTimerExpired(true);
          return 0;
        }
        return v - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [gameOver, generating, hostStage]);

  // Reset the countdown whenever the game becomes live (host revealed
  // the seed). Without this the timer keeps its previous value and the
  // UI flashes "Turn expired" the moment the joiner connects.
  useEffect(() => {
    if (hostStage === "Active") {
      setTimer(45);
      setTimerExpired(false);
    }
  }, [hostStage]);

  // Keep `hostStage` in sync with the on-chain status. The host drives
  // this locally via `setHostStage("Active")` after their own reveal,
  // but the joiner only sees the transition when the 4s poll surfaces
  // `gameRoom.gameStatus === "InProgress"`. Without this, the joiner's
  // hand stays blank and timer stays at 45 even after the host reveals.
  useEffect(() => {
    if (!gameRoom) {
      // eslint-disable-next-line no-console
      console.log("[stage-sync] no gameRoom yet");
      return;
    }
    // eslint-disable-next-line no-console
    console.log(
      "[stage-sync] gameRoom.gameStatus=", gameRoom.gameStatus,
      "current hostStage=", hostStage,
    );
    if (gameRoom.gameStatus === "InProgress" && hostStage !== "Active") {
      // eslint-disable-next-line no-console
      console.log("[stage-sync] flipping hostStage -> Active");
      setHostStage("Active");
    }
  }, [gameRoom?.gameStatus, hostStage, gameRoom]);

  const handleForceSkip = async () => {
    if (!publicKey || !sign) return;
    try {
      await contractForceSkip(sign, publicKey, numericRoomId);
      setTimer(45);
      setTimerExpired(false);
      toast.success("Turn skipped", { description: "Advanced past the AFK player." });
      await refetchGame();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Force skip failed", { description: translateContractError(msg) });
    }
  };

  const canPlay = (c: UnoCardData) => {
    const played = cardToChain(c);
    const top = cardToChain(topCard);
    return isLegalPlay(played, top);
  };

  const playableIds = useMemo(
    () => new Set(displayHand.filter(canPlay).map((c) => c.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- canPlay is a stable local derived from topCard
    [displayHand, topCard],
  );

  const selectedCard = displayHand.find((c) => c.id === selected) ?? null;

  const playSelected = async () => {
    // eslint-disable-next-line no-console
    console.log("[play] entered, selected=", selected, "selectedCard=", selectedCard);
    if (!selectedCard || !publicKey || !sign) {
      // eslint-disable-next-line no-console
      console.log("[play] bailing early: missing", { selectedCard: !!selectedCard, publicKey: !!publicKey, sign: !!sign });
      return;
    }
    // Turn gate: only the active player (per `gameRoom.currentTurn`) may
    // submit a `play_card` tx. The contract will reject it with
    // `NotYourTurn` anyway, but failing here keeps the user from
    // wasting a 2-5s proof generation. The on-chain `current_turn` is
    // the source of truth — `playerIndex` (the local roster position)
    // is not authoritative.
    const activeAddr = gameRoom?.players?.[gameRoom.currentTurn]?.address;
    if (activeAddr && activeAddr !== publicKey) {
      toast.error("Not your turn", { description: "Wait until the other player finishes their move." });
      return;
    }
    if (!canPlay(selectedCard)) {
      toast.error("Invalid move", { description: "Play a card matching the top card." });
      return;
    }
    if (deckStatus !== "ready" || !salt) {
      toast.error("Hand not ready", { description: "Waiting for the host to reveal the seed." });
      return;
    }

    const cardIndex = Number.parseInt(selectedCard.id.slice(1), 10);
    if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= deckCards.length) {
      toast.error("Card index out of range");
      return;
    }

    // Belt-and-braces: confirm the card at `deckCards[cardIndex]` matches
    // the one the user clicked. If the UI hand and the local hand ever
    // disagree, the circuit's `select_card(deck, idx) == played` assert
    // fires with a generic "unreachable" — better to surface a clear toast
    // here than let the user stare at a cryptic proof error.
    const deckCard = deckCards[cardIndex];
    const selectedChain = cardToChain(selectedCard);
    // eslint-disable-next-line no-console
    console.log(
      "[play] cardIndex=", cardIndex,
      "selected=", `${selectedChain.color}/${selectedChain.value}/w${selectedChain.isWild}`,
      "deckCards[idx]=", `${deckCard.color}/${deckCard.value}/w${deckCard.isWild}`,
      "deckStatus=", deckStatus,
      "salt prefix=", salt?.slice(0, 8) ?? "null",
      "playerIndex=", playerIndex,
      "displayHand.len=", displayHand.length,
    );
    if (
      deckCard.color !== selectedChain.color ||
      deckCard.value !== selectedChain.value ||
      deckCard.isWild !== selectedChain.isWild
    ) {
      toast.error("Card out of sync", {
        description: "The UI and the local hand disagree. Refresh the page.",
      });
      return;
    }

    try {
      // 1) Compute old + new commitments.
      const oldHandHash = await hashHand(deckCards, salt);
      const newHandHash = await computeNewHandHash(deckCards, cardIndex, salt);

      const top = cardToChain(topCard);
      const played = cardToChain(selectedCard);

      // The Noir circuit's `CardStruct` ABI uses snake_case field names
      // (`is_wild`, not `isWild`). Map our internal `Card` shape into the
      // circuit's expected shape here so the witness serialiser is happy.
      const handForCircuit = deckCards.map((c) => ({
        color: String(c.color),
        value: String(c.value),
        is_wild: String(c.isWild),
      }));

      const witness: PlayCardWitness = {
        top_card_color: top.color.toString(),
        top_card_value: top.value.toString(),
        // Noir's witness bindings reject hex strings for `Field` inputs
        // (see `commitment.ts::hexHashToDecimalField` for the why).
        old_hand_hash: hexHashToDecimalField(oldHandHash),
        new_hand_hash: hexHashToDecimalField(newHandHash),
        played_card_color: played.color.toString(),
        played_card_value: played.value.toString(),
        played_card_is_wild: played.isWild.toString(),
        hand_array: handForCircuit as unknown as PlayCardWitness["hand_array"],
        played_card_index: cardIndex,
        salt: hexHashToDecimalField(salt),
      };
      // eslint-disable-next-line no-console
      console.log(
        "[play-witness]",
        "top=", `${top.color}/${top.value}`,
        "played=", `${played.color}/${played.value}/w${played.isWild}`,
        "idx=", cardIndex,
        "old_hash=", witness.old_hand_hash.slice(0, 12) + "...",
        "new_hash=", witness.new_hand_hash.slice(0, 12) + "...",
        "salt=", witness.salt.slice(0, 12) + "...",
        "hand[0..2]=", handForCircuit.slice(0, 3).map(c => `${c.color}/${c.value}`).join(","),
      );

      // Snapshot the full witness to sessionStorage before noir.execute
      // runs in the worker. If the worker panics with `unreachable` we
      // can replay these exact inputs in Node to determine whether the
      // bug is in the inputs or the browser WASM environment. See
      // `test_replay.mjs` in the project root for the replay script.
      try {
        sessionStorage.setItem(
          "zuno:last_witness:play_card",
          JSON.stringify({ capturedAt: Date.now(), witness }),
        );
      } catch {
        // sessionStorage unavailable — best effort.
      }

      // 2) Generate + verify the proof (this blocks for 2-5s).
      const proof = await generateProof({
        action: "generate-proof",
        circuitName: "play_card",
        witness,
      });

      // 3) Submit the transaction to the Soroban contract.
      const roomIdNumeric = parseRoomId(roomId);
      const txHash = await contractPlayCard(sign, publicKey, roomIdNumeric, proof);

      // 4) Optimistic UI update.
      setTopCard({ ...selectedCard, id: "top" });
      setDisplayHand((h) => h.filter((c) => c.id !== selected));
      setSelected(null);
      setTurn((t) => t + 1);
      setLog((l) => [
        ...l.map((e) => ({ ...e, highlight: false })),
        {
          id: Date.now(),
          text: `You played ${selectedCard.color} ${selectedCard.value}`,
          color: selectedCard.color,
          highlight: true,
        },
        {
          id: Date.now() + 1,
          text: `TX ${txHash.slice(0, 8)}... confirmed`,
          highlight: false,
        },
      ]);

      // Check win condition locally for instant feedback; the contract
      // will independently enforce this on `claim_victory`.
      if (displayHand.length === 1) {
        await handleClaimVictory();
      }
      refetchGame();
    } catch (error) {
      console.error("Play card error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      toast.error("Failed to play card", { description: translateContractError(msg) });
    }
  };

  const drawCard = async () => {
    if (!publicKey || !sign || !salt) return;
    if (deckStatus !== "ready") {
      toast.error("Hand not ready");
      return;
    }
    // Turn gate — same rule as `playSelected`: only the active player
    // may submit a `draw_card` tx.
    const activeAddr = gameRoom?.players?.[gameRoom.currentTurn]?.address;
    if (activeAddr && activeAddr !== publicKey) {
      toast.error("Not your turn", { description: "Wait until the other player finishes their move." });
      return;
    }
    try {
      const emptySlot = deckCards.findIndex(
        (c) => c.value === 0 && c.color === 0 && c.isWild === 0,
      );
      const slotIndex = emptySlot >= 0 ? emptySlot : deckCards.length;

      // We don't know the actual card the contract dealt us — the ZK proof
      // demonstrates that we drew SOMETHING valid, not which card. So we
      // hash the slot + contract's response after the proof verifies.
      const cardHash = await hashCard(0, 0, 0); // placeholder until contract reveals
      const oldHandHash = await hashHand(deckCards, salt);
      // Optimistically extend the hand for the UI.
      const newCard: Card = { color: 0, value: 0, isWild: 0 };
      const newHand = [...deckCards];
      newHand[slotIndex] = newCard;
      const { hashHand: hh } = await import("@/lib/commitment");
      const newHandHash = await hh(newHand, salt);
      void newHandHash;
      void oldHandHash;

      const proof = await generateProof({
        action: "generate-proof",
        circuitName: "draw_card",
        witness: {
          // See `commitment.ts::hexHashToDecimalField` — Noir rejects
          // hex strings for `Field` inputs with "invalid digit found
          // in string".
          old_hand_hash: hexHashToDecimalField(oldHandHash),
          new_hand_hash: hexHashToDecimalField(newHandHash),
          card_hash: hexHashToDecimalField(cardHash),
          slot_index: slotIndex,
          hand_array: deckCards,
          drawn_card_color: "0",
          drawn_card_value: "0",
          salt: hexHashToDecimalField(salt),
        },
      });

      const roomIdNumeric = parseRoomId(roomId);
      await contractDrawCard(sign, publicKey, roomIdNumeric, proof);

      const display: UnoCardData = {
        // Use the slot index as the id so playSelected's
        // `parseInt(id.slice(1))` resolves to the right deckCards slot.
        id: `c${slotIndex}`,
        color: COLORS[newCard.color] ?? "wild",
        value: cardDisplayValue(newCard),
      };
      setDisplayHand((h) => [...h, display]);
      setLog((l) => [
        ...l.map((e) => ({ ...e, highlight: false })),
        { id: Date.now(), text: "You drew a card", highlight: true },
      ]);
      refetchGame();
    } catch (error) {
      console.error("Draw card error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      toast.error("Failed to draw card", { description: translateContractError(msg) });
    }
  };

  const handleCallZuno = async () => {
    if (!publicKey || !sign) return;
    try {
      const roomIdNumeric = parseRoomId(roomId);
      await contractCallZuno(sign, publicKey, roomIdNumeric);
      toast.success("ZUNO called!", { description: "One card left — finish strong." });
      setLog((l) => [
        ...l.map((e) => ({ ...e, highlight: false })),
        { id: Date.now(), text: "You called ZUNO!", highlight: true, zuno: true },
      ]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.error("Failed to call ZUNO", { description: translateContractError(msg) });
    }
  };

  const handleClaimVictory = async () => {
    if (!publicKey || !sign) return;
    try {
      const roomIdNumeric = parseRoomId(roomId);
      const txHash = await contractClaimVictory(sign, publicKey, roomIdNumeric);
      const pot = gameRoom?.pot ?? 0n;
      const reward = parseFloat(formatXlm(pot));
      setGameOver({ winner: publicKey, reward });
      toast.success("Victory!", { description: `TX ${txHash.slice(0, 8)}...` });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.error("Failed to claim victory", { description: translateContractError(msg) });
    }
  };

  const timerColor = timer > 25 ? "text-neon" : timer > 10 ? "text-gold" : "text-danger";
  const timerStroke = timer > 25 ? "stroke-neon" : timer > 10 ? "stroke-gold" : "stroke-danger";

  // Build the opponent list from the on-chain room when available.
// Until the indexer is live we fall back to a localStorage roster that
// every browser landing on this room contributes to. This gives the
// player-list panel something useful to render even without indexer
// connectivity, while still surfacing a clear "Waiting for players"
// hint for roster gaps.
const opponents = useMemo(() => {
  if (gameRoom?.players && gameRoom.players.length > 0) {
    // `currentTurn` is an index into the on-chain `players` Vec. Only the
    // address at that slot is the active player; everyone else is
    // "Waiting". Without this check, every player row in the UI shows
    // "Your Turn" — which is how both profiles ended up thinking it
    // was their move at the same time.
    const activeAddr = gameRoom.players[gameRoom.currentTurn]?.address;
    return gameRoom.players.map((p) => {
      const isActive = p.address === activeAddr;
      const isMe = p.address === publicKey;
      const status = isActive
        ? ("Your Turn" as const)
        : ("Waiting" as const);
      return {
        name: isMe ? `${shortAddr(p.address)} (you)` : shortAddr(p.address),
        addr: p.address,
        cards: p.handSize,
        status,
      };
    });
  }
  if (publicKey) {
    const fromRoster = roster.filter((r) => r.address !== publicKey);
    const self = [
      {
        name: `${shortAddr(publicKey)} (you)`,
        addr: publicKey,
        cards: 7,
        status: "Waiting" as const,
      },
    ];
    const others = fromRoster.map((r) => ({
      name: shortAddr(r.address),
      addr: r.address,
      cards: 0,
      status: "Waiting" as const,
    }));
    return [...self, ...others];
  }
  return [];
}, [gameRoom, publicKey, roster]);

  const potXlm = gameRoom?.pot ? formatXlm(gameRoom.pot) : "5.00";

  // Not connected — bounce to landing.
  useEffect(() => {
    if (publicKey === null) {
      // We don't auto-navigate here because the hook has a brief loading
      // window; the toast below nudges the user instead.
    }
  }, [publicKey]);

  if (!publicKey) {
    return (
      <div className="relative min-h-screen">
        <Starfield density={40} />
        <Header />
        <main className="mx-auto max-w-3xl px-4 py-24 text-center">
          <h1 className="font-display text-3xl font-bold">Connect your wallet to play</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Zuno uses Freighter to sign transactions on Stellar Testnet.
          </p>
          <button
            onClick={() => navigate({ to: "/" })}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-stellar to-crypto px-6 py-3 text-sm font-semibold text-primary-foreground"
          >
            Back to Landing
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      <Starfield density={40} />
      <Header />

      <main className="mx-auto max-w-7xl px-4 pb-12">
        <div className="mb-6 flex items-center justify-between">
          <Link
            to="/lobby"
            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs glass hover:glass-strong transition"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Lobby
          </Link>
          <div className="font-mono text-xs text-muted-foreground">Room {roomId}</div>
        </div>

        {/* Host banner: "Waiting for players" / "Reveal seed" prompts. */}
        {isHost && (
          <div className="mb-6 rounded-2xl p-5 glass glow-stellar">
            {hostStage === "Waiting" && (() => {
              // The contract rejects join_room once start_game has fired
              // (#4 GameAlreadyStarted). Disable Start Game until the
              // polling hook reports at least one opponent on-chain, so
              // the host can't accidentally lock profile 2 out.
              const playerCount = gameRoom?.players?.length ?? 0;
              const hasEnoughPlayers = playerCount >= 2;
              const opponent = gameRoom?.players?.find((p) => p.address !== publicKey);
              return (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="font-display text-lg font-semibold">You're the host</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Share {typeof location !== "undefined" ? location.origin : ""}/game/{roomId}
                      {" "}to invite players.{" "}
                      {hasEnoughPlayers
                        ? "Opponent confirmed on-chain — ready to start."
                        : "Waiting for opponent to join the room on-chain…"}
                    </p>
                    {opponent && (
                      <p className="mt-1 font-mono text-[10px] text-gold/80">
                        Opponent: {shortAddr(opponent.address)}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={handleStartGame}
                    disabled={hostBusy !== null || !hasEnoughPlayers}
                    className="rounded-xl bg-gradient-to-r from-stellar to-crypto px-5 py-2.5 text-sm font-semibold text-primary-foreground glow-stellar transition hover:scale-[1.02] disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
                  >
                    {hostBusy === "starting" ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Starting…</>
                    ) : hasEnoughPlayers ? (
                      "Start Game"
                    ) : (
                      "Waiting for player…"
                    )}
                  </button>
                </div>
              );
            })()}
            {hostStage === "AwaitingReveal" && (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="font-display text-lg font-semibold">Room started — waiting for players</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Reveal the seed once everyone has joined so the deck can be dealt.
                  </p>
                </div>
                <button
                  onClick={handleRevealSeed}
                  disabled={hostBusy !== null}
                  className="rounded-xl bg-gradient-to-r from-stellar to-crypto px-5 py-2.5 text-sm font-semibold text-primary-foreground glow-stellar transition hover:scale-[1.02] disabled:opacity-60 inline-flex items-center gap-2"
                >
                  {hostBusy === "revealing" ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Revealing…</>
                  ) : (
                    "Reveal Seed & Deal"
                  )}
                </button>
              </div>
            )}
            {hostStage === "Active" && (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="text-xs text-muted-foreground">
                  <span className="text-gold font-semibold">Game active.</span>{" "}
                  Make sure your hand is ready — your turn is next. Share the seed link with any joiner who has not loaded their hand yet.
                </div>
                <button
                  onClick={handleShareSeed}
                  className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2 text-xs font-semibold ring-1 ring-white/10 transition hover:bg-white/10"
                >
                  <Copy className="h-3.5 w-3.5" /> Share Seed Link
                </button>
              </div>
            )}
          </div>
        )}

        {/* Non-host waiting banner — same shape so the page reads consistently.
            The joiner must explicitly click "Join the room" so that any
            contract-side failure (insufficient XLM, etc.) is visible. */}
        {!isHost && publicKey && (
          <div className="mb-6 rounded-2xl p-5 glass">
            {joinState.kind === "idle" && (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="font-display text-lg font-semibold">Join this room</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pay the stake on-chain (XLM) to take a seat at the table.
                  </p>
                </div>
                <button
                  onClick={tryJoin}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-stellar to-crypto px-5 py-2.5 text-sm font-semibold text-primary-foreground glow-stellar transition hover:scale-[1.02]"
                >
                  Join the room
                </button>
              </div>
            )}
            {joinState.kind === "joining" && (
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-stellar" />
                Joining — confirm the Freighter popup…
              </div>
            )}
            {joinState.kind === "joined" && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Sparkles className="h-4 w-4 text-gold" />
                  <span>
                    Joined — TX <span className="font-mono">{joinState.txHash.slice(0, 8)}…</span>.
                    Waiting for the host to start.
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  When the host reveals the deck seed, they'll share a{" "}
                  <span className="font-mono">#seed=…</span> link. Reopen this page
                  using that link (not the bare invite URL) so your hand can be
                  derived locally.
                </div>
              </div>
            )}
            {joinState.kind === "already" && (
              <div className="space-y-2">
                <div className="text-sm">Already seated. Waiting for the host to start.</div>
                <div className="text-[10px] text-muted-foreground">
                  When the host reveals the deck seed, they'll share a{" "}
                  <span className="font-mono">#seed=…</span> link. Reopen this page
                  using that link (not the bare invite URL) so your hand can be
                  derived locally.
                </div>
              </div>
            )}
            {joinState.kind === "error" && (
              <div className="space-y-2">
                <div className="text-sm text-danger">
                  Could not join the room. {joinState.message}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Common cause: insufficient XLM on Testnet. Top up via{" "}
                  <a
                    href="https://friendbot.stellar.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-stellar underline"
                  >
                    friendbot
                  </a>{" "}
                  and retry.
                </div>
                <button
                  onClick={tryJoin}
                  className="mt-2 inline-flex items-center gap-2 rounded-xl bg-white/5 px-4 py-2 text-xs font-semibold ring-1 ring-white/10 transition hover:bg-white/10"
                >
                  Retry join
                </button>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr_1.2fr]">
          {/* Players & Pot */}
          <aside className="space-y-4">
            <div>
              <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Players
              </h3>
              {!gameRoom && (
                <div className="mt-1 text-[10px] text-muted-foreground">
                  Showing local roster — on-chain player counts appear once the indexer is live.
                </div>
              )}
            </div>
            {opponents.map((o) => (
              <div
                key={o.addr}
                className={`rounded-2xl p-4 glass ${o.status === "Your Turn" ? "glow-gold ring-1 ring-gold/40" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="h-9 w-9 shrink-0 rounded-full ring-1 ring-white/20"
                    style={{
                      background: `conic-gradient(from ${o.addr.charCodeAt(0) * 7}deg, oklch(0.78 0.16 220), oklch(0.7 0.22 305), oklch(0.85 0.16 85))`,
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{o.name}</div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">
                      {o.addr}
                    </div>
                  </div>
                  <div className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-mono">
                    {o.cards}
                  </div>
                </div>
                <div className="mt-2 text-[10px]">
                  <span
                    className={
                      o.status === "Your Turn" ? "text-gold font-semibold" : "text-muted-foreground"
                    }
                  >
                    {o.status}
                  </span>
                </div>
              </div>
            ))}

            <div className="rounded-2xl p-5 glass-strong text-center">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pot</div>
              <div className="mt-1 font-display text-3xl font-black text-gold drop-shadow-[0_0_18px_oklch(0.85_0.16_85/0.5)]">
                {potXlm} XLM
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">Winner takes all</div>
            </div>
          </aside>

          {/* Center: top card + log */}
          <section className="space-y-5">
            <div className="rounded-3xl p-6 glass">
              <div className="flex flex-col items-center">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Top Card
                </div>
                <div className="mt-3 mb-4 animate-pulse-glow rounded-2xl">
                  <UnoCard card={topCard} size="lg" />
                </div>
                <div className="font-mono text-sm">Turn #{turn}</div>

                {/* Timer ring */}
                <div className="relative mt-4 h-20 w-20">
                  <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
                    <circle
                      cx="18"
                      cy="18"
                      r="15.5"
                      className="stroke-white/10"
                      strokeWidth="2.5"
                      fill="none"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="15.5"
                      className={timerStroke}
                      strokeWidth="2.5"
                      fill="none"
                      strokeDasharray={`${(timer / 45) * 97.4} 97.4`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div
                    className={`absolute inset-0 grid place-items-center font-mono text-sm font-bold ${timerColor}`}
                  >
                    {timerExpired ? "0s" : `${timer}s`}
                  </div>
                </div>
                {timerExpired && hostStage === "Active" && (
                  <button
                    onClick={handleForceSkip}
                    className="mt-3 inline-flex items-center gap-2 rounded-xl bg-white/5 px-3 py-1.5 text-xs font-semibold ring-1 ring-danger/40 text-danger transition hover:bg-danger/10"
                  >
                    Force skip turn
                  </button>
                )}
              </div>
            </div>

            <div className="rounded-2xl p-4 glass">
              <h3 className="mb-2 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Game Log
              </h3>
              <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                {log.map((e) => (
                  <div
                    key={e.id}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${
                      e.highlight ? "bg-white/5 ring-1 ring-stellar/30" : ""
                    } ${e.zuno ? "text-danger animate-pulse-danger" : ""}`}
                  >
                    {e.color && (
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{
                          background: `var(--uno-${e.color})`,
                          boxShadow: `0 0 6px var(--uno-${e.color})`,
                        }}
                      />
                    )}
                    <Lock className="h-2.5 w-2.5 text-mint shrink-0" />
                    <span className="truncate">{e.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Right: your hand */}
          <section>
            <h3 className="mb-3 font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Your Hand <span className="ml-1 text-gold">({displayHand.length})</span>
            </h3>
            <div className="rounded-2xl p-4 glass">
              {deckStatus === "loading" && displayHand.length === 0 ? (
                <div className="space-y-2 py-8 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {publicKey
                      ? "Deriving your private hand…"
                      : "Connect your wallet to deal your hand."}
                  </div>
                  {isHost && hostMeta?.seedHex && (
                    <div className="text-[10px] text-gold/80">
                      Seed detected — waiting for your browser to finish the derivation.
                    </div>
                  )}
                  {!isHost && (
                    seedFromUrl ? (
                      <div className="text-[10px] text-gold/80">
                        Seed link detected — deriving your hand now.
                      </div>
                    ) : (
                      <div className="text-[10px] text-muted-foreground">
                        Ask the host for the seed link (it includes <span className="font-mono">#seed=…</span>) and reopen this URL.
                      </div>
                    )
                  )}
                </div>
              ) : deckStatus === "error" ? (
                <div className="py-8 text-xs text-danger">
                  Hand derivation failed: {deckError ?? "unknown error"}
                </div>
              ) : (
                <div className="flex gap-2 overflow-x-auto pb-3 [scrollbar-width:thin]">
                  {displayHand.map((c) => (
                    <UnoCard
                      key={c.id}
                      card={c}
                      size="md"
                      selected={selected === c.id}
                      playable={playableIds.has(c.id) && selected !== c.id}
                      invalid={!playableIds.has(c.id)}
                      onClick={() => setSelected(c.id)}
                    />
                  ))}
                </div>
              )}

              <div className="mt-4 grid grid-cols-3 gap-2">
                <button
                  onClick={playSelected}
                  disabled={!selected || generating}
                  className="rounded-xl bg-gradient-to-r from-stellar to-crypto px-3 py-2.5 text-xs font-semibold text-primary-foreground glow-stellar transition hover:scale-[1.02] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 inline-flex items-center justify-center gap-1.5"
                >
                  {generating ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" /> Proving
                    </>
                  ) : (
                    "Play Card"
                  )}
                </button>
                <button
                  onClick={drawCard}
                  disabled={generating}
                  className="rounded-xl bg-white/5 px-3 py-2.5 text-xs font-semibold ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-40"
                >
                  Draw
                </button>
                <button
                  onClick={handleCallZuno}
                  disabled={displayHand.length !== 2 || generating}
                  className="rounded-xl bg-gold px-3 py-2.5 text-xs font-bold text-background transition disabled:opacity-30 enabled:animate-pulse-gold"
                >
                  ZUNO!
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Proof modal */}
      {generating && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm">
          <div className="rounded-3xl p-10 text-center glass-strong">
            <div className="relative mx-auto h-20 w-20">
              <Sparkles className="absolute inset-0 m-auto h-10 w-10 text-stellar animate-spin-slow" />
              <div className="absolute inset-0 rounded-full ring-2 ring-stellar/40 animate-pulse-glow" />
            </div>
            <h3 className="mt-6 font-display text-xl font-bold">Generating ZK Proof...</h3>
            <p className="mt-2 max-w-xs text-xs text-muted-foreground">
              Creating cryptographic proof of your move
            </p>
            <div className="mt-5 h-1 w-64 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-1/3 animate-[slide-in-right_1.2s_ease-in-out_infinite] bg-gradient-to-r from-stellar to-crypto" />
            </div>
          </div>
        </div>
      )}

      {/* Game over */}
      {gameOver && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl p-8 text-center glass-strong glow-gold">
            <Trophy className="mx-auto h-12 w-12 text-gold animate-pulse-gold" />
            <h3 className="mt-4 font-display text-2xl font-bold">Game Finished!</h3>
            <p className="mt-2 font-mono text-sm text-gold">
              {gameOver.winner.length > 12
                ? `${gameOver.winner.slice(0, 4)}...${gameOver.winner.slice(-4)}`
                : gameOver.winner}{" "}
              wins!
            </p>
            <div className="mt-5 rounded-xl bg-gold/10 p-4 ring-1 ring-gold/30">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Reward
              </div>
              <div className="mt-1 font-display text-3xl font-black text-gold">
                {gameOver.reward.toFixed(2)} XLM
              </div>
            </div>
            <Link
              to="/lobby"
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-stellar to-crypto px-4 py-3 text-sm font-semibold text-primary-foreground"
            >
              Play Again
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function shortAddr(a: string) {
  if (a.length < 12) return a;
  return `${a.slice(0, 4)}...${a.slice(-4)}`;
}

function parseRoomId(roomId: string): bigint {
  // Delegate to the shared helper so the lobby and the game page agree
  // on the exact u64 for a given display id.
  return displayRoomIdToU64(roomId);
}

function cardDisplayValue(c: Card): CardValue {
  if (c.value === 10) return "skip";
  if (c.value === 11) return "reverse";
  if (c.value === 12) return "+2";
  if (c.value === 13) return "+4";
  if (c.isWild === 1 && c.value === 0) return "wild";
  return c.value;
}

/**
 * Translate the contract's raw error codes into a one-line human message.
 * The Soroban host returns the error as `HostError: Error(Contract, #N)`
 * — the `N` matches `ZunoError` in `contracts/programs/zuno/src/error.rs`.
 */
function translateContractError(raw: string): string {
  const m = /Error\(Contract, #(\d+)\)/.exec(raw);
  if (!m) return raw;
  const code = Number(m[1]);
  switch (code) {
    case 1: return "It's not your turn yet.";
    case 2: return "The game isn't active yet.";
    case 3: return "This room is full.";
    case 4: return "The game has already started.";
    case 5: return "At least one opponent must join before the game can start. Ask them to click “Join the room” on this URL, then try again.";
    case 6: return "Only the host can do this.";
    case 7: return "You're already in this room.";
    case 8: return "The ZK proof didn't verify. Re-generate and try again.";
    case 9: return "Your turn has timed out.";
    case 11: return "You can only call ZUNO when you have exactly 2 cards.";
    case 12: return "Victory requires emptying your hand.";
    case 16: return "That card doesn't match the top card.";
    case 18: return "The host hasn't revealed the deck seed yet.";
    case 19: return "Your local hand commitment doesn't match the chain. Reload the page.";
    case 21: return "Seed is the wrong size — re-create the room.";
    case 22: return "Room not found. Double-check the URL.";
    case 23: return "XLM transfer failed. Make sure your wallet is funded (use friendbot.stellar.org on Testnet).";
    case 24: return "The verifier signature was rejected. The proof server may be down — check the verifier-server logs.";
    default: return `Contract error #${code}. See server logs for the full event trace.`;
  }
}
