/**
 * `useGameState` — polls the Soroban contract for the current `GameRoomView`
 * and exposes a typed view + helpers.
 *
 * Polling cadence defaults to 4s (configurable). The hook also exposes a
 * `refetch` callback so the UI can pull immediately after submitting a tx.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getGameRoom } from "@/lib/stellar";
import type { GameRoomView } from "@/lib/types";

export interface UseGameStateResult {
  gameRoom: GameRoomView | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useGameState(
  roomId: string | bigint | undefined,
  pollMs: number = 4000,
): UseGameStateResult {
  const [gameRoom, setGameRoom] = useState<GameRoomView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const refetch = useCallback(async () => {
    if (roomId === undefined) return;
    try {
      const room = await getGameRoom(roomId);
      if (!aliveRef.current) return;
      setGameRoom(room);
      setError(null);
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load game");
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    aliveRef.current = true;
    setLoading(true);

    if (roomId === undefined) {
      setLoading(false);
      return;
    }

    refetch();
    const interval = setInterval(refetch, pollMs);

    return () => {
      aliveRef.current = false;
      clearInterval(interval);
    };
  }, [roomId, pollMs, refetch]);

  return { gameRoom, loading, error, refetch };
}
