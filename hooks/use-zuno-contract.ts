"use client"

import { useCallback } from "react"

import {
  Account,
  Horizon,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk"

import {
  STELLAR_NETWORK_PASSPHRASE,
  STROOPS_PER_XLM,
  ZUNO_CONTRACT_ID,
  bytesFromHex,
  getHorizonServer,
  getSorobanServer,
  getXlmBalance,
  getZunoContract,
  submitTransaction,
} from "@/lib/stellar"
import { useFreighter } from "@/hooks/use-freighter"

// ── Argument shapes ────────────────────────────────────────────────────
export interface InitializeRoomArgs {
  roomId: number
  stakeXlm: number
  xlmToken: string
  verifierContract: string
  seedCommitmentHex: string
}

export interface JoinRoomArgs {
  roomId: number
}

export interface StartGameArgs {
  roomId: number
}

export interface RevealRandomnessArgs {
  roomId: number
  seedRevealHex: string
}

export interface PlayCardArgs {
  roomId: number
  /** Hex-encoded proof bytes. The stub verifier accepts anything. */
  proofHex: string
  /** 7 public inputs as hex (32 bytes each). */
  publicInputs: string[]
  playedCardIndex: number
  declaredColor?: number
}

export interface DrawCardArgs {
  roomId: number
  proofHex: string
  /** 4 public inputs as hex (32 bytes each). */
  publicInputs: string[]
  slotIndex: number
}

export interface CallZunoArgs {
  roomId: number
}

export interface ClaimVictoryArgs {
  roomId: number
}

export interface ForceSkipArgs {
  roomId: number
}

export interface PunishZunoArgs {
  roomId: number
  target: string
}

// ── Result types ───────────────────────────────────────────────────────
export type TxResult = { txHash: string; result: unknown }

// ── Hook ────────────────────────────────────────────────────────────────
/**
 * `useZunoContract` — typed wrapper around the deployed Zuno Soroban
 * contract. Each method builds a Soroban invoke transaction, asks
 * Freighter to sign it, and submits to the network.
 *
 * All write methods return `{ txHash, result }`. The `result` is the
 * deserialised return value (usually `null` for our void-returning
 * instructions, typed as `unknown` for flexibility).
 */
export function useZunoContract() {
  const freighter = useFreighter()
  const server: rpc.Server = getSorobanServer()
  const horizon: Horizon.Server = getHorizonServer()

  /** Internal: build + sign + submit. */
  const invoke = useCallback(
    async (
      functionName: string,
      args: ReturnType<typeof nativeToScVal>[],
    ): Promise<TxResult> => {
      if (!freighter.connected || !freighter.publicKey) {
        throw new Error("Connect Freighter first")
      }

      const account = await horizon.loadAccount(freighter.publicKey)
      const contract = getZunoContract()

      const tx = new TransactionBuilder(account, {
        fee: "1000000",
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(contract.call(functionName, ...args))
        .setTimeout(30)
        .build()

      const signedXdr = await freighter.sign(
        tx.toXDR(),
        freighter.networkPassphrase ?? STELLAR_NETWORK_PASSPHRASE,
      )
      const result = await submitTransaction(signedXdr)

      // Recover the tx hash from the sent transaction.
      const sent = await server.sendTransaction(tx).catch(() => null)
      return { txHash: sent?.hash ?? "<pending>", result }
    },
    [freighter, horizon, server],
  )

  // ── 1. initialize_room ──────────────────────────────────────────────
  const initializeRoom = useCallback(
    async (a: InitializeRoomArgs): Promise<TxResult> => {
      const stakeStroops = BigInt(Math.round(a.stakeXlm * STROOPS_PER_XLM))
      return invoke("initialize_room", [
        nativeToScVal(a.roomId, { type: "u64" }),
        nativeToScVal(stakeStroops, { type: "i128" }),
        nativeToScVal(a.xlmToken, { type: "address" }),
        nativeToScVal(a.verifierContract, { type: "address" }),
        nativeToScVal(bytesFromHex(a.seedCommitmentHex), { type: "bytes" }),
      ])
    },
    [invoke],
  )

  // ── 2. join_room ────────────────────────────────────────────────────
  const joinRoom = useCallback(
    async (a: JoinRoomArgs): Promise<TxResult> => {
      if (!freighter.publicKey) throw new Error("Connect Freighter first")
      return invoke("join_room", [
        nativeToScVal(freighter.publicKey, { type: "address" }),
        nativeToScVal(a.roomId, { type: "u64" }),
      ])
    },
    [invoke, freighter.publicKey],
  )

  // ── 3. start_game ───────────────────────────────────────────────────
  const startGame = useCallback(
    async (a: StartGameArgs): Promise<TxResult> => {
      if (!freighter.publicKey) throw new Error("Connect Freighter first")
      return invoke("start_game", [
        nativeToScVal(freighter.publicKey, { type: "address" }),
        nativeToScVal(a.roomId, { type: "u64" }),
      ])
    },
    [invoke, freighter.publicKey],
  )

  // ── 4. reveal_randomness ────────────────────────────────────────────
  const revealRandomness = useCallback(
    async (a: RevealRandomnessArgs): Promise<TxResult> => {
      if (!freighter.publicKey) throw new Error("Connect Freighter first")
      return invoke("reveal_randomness", [
        nativeToScVal(freighter.publicKey, { type: "address" }),
        nativeToScVal(a.roomId, { type: "u64" }),
        nativeToScVal(bytesFromHex(a.seedRevealHex), { type: "bytes" }),
      ])
    },
    [invoke, freighter.publicKey],
  )

  // ── 5. play_card ────────────────────────────────────────────────────
  const playCard = useCallback(
    async (a: PlayCardArgs): Promise<TxResult> => {
      if (!freighter.publicKey) throw new Error("Connect Freighter first")
      const proof = bytesFromHex(a.proofHex)
      const inputs = a.publicInputs.map((hex) =>
        nativeToScVal(bytesFromHex(hex), { type: "bytes" }),
      )
      return invoke("play_card", [
        nativeToScVal(freighter.publicKey, { type: "address" }),
        nativeToScVal(a.roomId, { type: "u64" }),
        nativeToScVal(proof, { type: "bytes" }),
        nativeToScVal(inputs),
        nativeToScVal(a.playedCardIndex, { type: "u32" }),
        ...(a.declaredColor !== undefined
          ? [nativeToScVal(a.declaredColor, { type: "u32" })]
          : []),
      ])
    },
    [invoke, freighter.publicKey],
  )

  // ── 6. draw_card ────────────────────────────────────────────────────
  const drawCard = useCallback(
    async (a: DrawCardArgs): Promise<TxResult> => {
      if (!freighter.publicKey) throw new Error("Connect Freighter first")
      const proof = bytesFromHex(a.proofHex)
      const inputs = a.publicInputs.map((hex) =>
        nativeToScVal(bytesFromHex(hex), { type: "bytes" }),
      )
      return invoke("draw_card", [
        nativeToScVal(freighter.publicKey, { type: "address" }),
        nativeToScVal(a.roomId, { type: "u64" }),
        nativeToScVal(proof, { type: "bytes" }),
        nativeToScVal(inputs),
        nativeToScVal(a.slotIndex, { type: "u32" }),
      ])
    },
    [invoke, freighter.publicKey],
  )

  // ── 7. call_zuno ────────────────────────────────────────────────────
  const callZuno = useCallback(
    async (a: CallZunoArgs): Promise<TxResult> => {
      if (!freighter.publicKey) throw new Error("Connect Freighter first")
      return invoke("call_zuno", [
        nativeToScVal(freighter.publicKey, { type: "address" }),
        nativeToScVal(a.roomId, { type: "u64" }),
      ])
    },
    [invoke, freighter.publicKey],
  )

  // ── 8. claim_victory ────────────────────────────────────────────────
  const claimVictory = useCallback(
    async (a: ClaimVictoryArgs): Promise<TxResult> => {
      if (!freighter.publicKey) throw new Error("Connect Freighter first")
      return invoke("claim_victory", [
        nativeToScVal(freighter.publicKey, { type: "address" }),
        nativeToScVal(a.roomId, { type: "u64" }),
      ])
    },
    [invoke, freighter.publicKey],
  )

  // ── 9. force_skip ───────────────────────────────────────────────────
  const forceSkip = useCallback(
    async (a: ForceSkipArgs): Promise<TxResult> => {
      if (!freighter.publicKey) throw new Error("Connect Freighter first")
      return invoke("force_skip", [
        nativeToScVal(freighter.publicKey, { type: "address" }),
        nativeToScVal(a.roomId, { type: "u64" }),
      ])
    },
    [invoke, freighter.publicKey],
  )

  // ── 10. punish_zuno ─────────────────────────────────────────────────
  const punishZuno = useCallback(
    async (a: PunishZunoArgs): Promise<TxResult> => {
      if (!freighter.publicKey) throw new Error("Connect Freighter first")
      return invoke("punish_zuno", [
        nativeToScVal(freighter.publicKey, { type: "address" }),
        nativeToScVal(a.roomId, { type: "u64" }),
        nativeToScVal(a.target, { type: "address" }),
      ])
    },
    [invoke, freighter.publicKey],
  )

  return {
    // Reads
    getXlmBalance: (pk?: string) =>
      getXlmBalance(pk ?? freighter.publicKey ?? ""),
    // Writes
    initializeRoom,
    joinRoom,
    startGame,
    revealRandomness,
    playCard,
    drawCard,
    callZuno,
    claimVictory,
    forceSkip,
    punishZuno,
    // Identity helpers
    publicKey: freighter.publicKey,
    connected: freighter.connected,
    contractId: ZUNO_CONTRACT_ID,
  }
}