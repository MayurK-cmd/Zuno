/**
 * Stellar / Soroban helpers.
 *
 * Thin wrappers around `@stellar/stellar-sdk` and `@stellar/freighter-api`
 * for the parts of the app that need to talk to the deployed Zuno contract
 * on Stellar Testnet.
 *
 *   - truncateAddress / formatXlmAmount: presentation helpers (mirror the
 *     old `lib/solana.ts` API so call-sites can be migrated one at a time).
 *   - getSorobanServer: a memoised Soroban RPC client.
 *   - getZunoContract: a memoised `Contract` instance bound to the deployed
 *     Zuno contract ID.
 *   - getXlmBalance: fetch the native XLM balance for a given public key.
 *
 * The deployed Zuno contract on Stellar Testnet is at:
 *   CBZVYOLXMVQYGHTJDRVRSB7ABR74UDV7CUIIMMHEH2JAEYAKQJOMJNAW
 */

import {
  Account,
  Contract,
  Horizon,
  Keypair,
  Networks,
  Operation,
  rpc,
  nativeToScVal,
  scValToNative,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk"

import type { xdr } from "@stellar/stellar-sdk"

export type ScVal = xdr.ScVal

// ── Deployed Zuno contract (Stellar Testnet) ───────────────────────────
export const ZUNO_CONTRACT_ID =
  process.env.NEXT_PUBLIC_ZUNO_CONTRACT_ID ??
  "CBZVYOLXMVQYGHTJDRVRSB7ABR74UDV7CUIIMMHEH2JAEYAKQJOMJNAW"

export const STELLAR_NETWORK_PASSPHRASE = Networks.TESTNET
export const STELLAR_HORIZON_URL = "https://horizon-testnet.stellar.org"
export const STELLAR_SOROBAN_URL = "https://soroban-testnet.stellar.org"
export const STELLAR_EXPERT_TX_URL = "https://stellar.expert/explorer/testnet/tx"

// 1 XLM = 10_000_000 stroops
export const STROOPS_PER_XLM = 10_000_000

// ── Presentation helpers (Solana API parity) ────────────────────────────
export function truncateAddress(address: string, chars = 4) {
  if (address.length <= chars * 2 + 3) return address
  return `${address.slice(0, chars)}...${address.slice(-chars)}`
}

export function formatXlmAmount(stroops: number | bigint) {
  const xlm =
    typeof stroops === "bigint" ? Number(stroops) / STROOPS_PER_XLM : stroops / STROOPS_PER_XLM
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: xlm >= 1 ? 3 : 5,
    minimumFractionDigits: 0,
  }).format(xlm)
}

// ── Soroban client ──────────────────────────────────────────────────────
let _server: rpc.Server | null = null

export function getSorobanServer(): rpc.Server {
  if (!_server) _server = new rpc.Server(STELLAR_SOROBAN_URL)
  return _server
}

let _horizon: Horizon.Server | null = null

export function getHorizonServer(): Horizon.Server {
  if (!_horizon) _horizon = new Horizon.Server(STELLAR_HORIZON_URL)
  return _horizon
}

let _contract: Contract | null = null

export function getZunoContract(): Contract {
  if (!_contract) {
    _contract = new Contract(ZUNO_CONTRACT_ID)
  }
  return _contract
}

// ── Read helpers (no signing required) ──────────────────────────────────
/**
 * Read a function off the deployed Zuno contract. Returns the deserialised
 * native JS value (the SDK's `scValToNative` does the heavy lifting).
 *
 * For the lobby, you might call `get_room(room_id)` and get back a
 * `{ status, players, pot, ... }` object once bindings are generated.
 */
export async function readContract<T = unknown>(
  functionName: string,
  args: ScVal[] = [],
): Promise<T> {
  const contract = getZunoContract()
  const account = new Account(
    // The simulated source account is irrelevant for read calls — the
    // Soroban RPC runs them without signature.
    Keypair.random().publicKey(),
    "0",
  )
  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(functionName, ...args))
    .setTimeout(30)
    .build()

  const server = getSorobanServer()
  const sim = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation error: ${sim.error}`)
  }
  if (sim.result?.retval) {
    return scValToNative(sim.result.retval) as T
  }
  return null as T
}

// ── Account / balance helpers ───────────────────────────────────────────
/**
 * Fetch the native XLM balance (in stroops) for a public key. Returns
 * `0` on any error so the UI can degrade gracefully.
 */
export async function getXlmBalance(publicKey: string): Promise<number> {
  try {
    const horizon = getHorizonServer()
    const account = await horizon.loadAccount(publicKey)
    const native = account.balances.find((b) => b.asset_type === "native")
    return native ? Number(native.balance) * STROOPS_PER_XLM : 0
  } catch {
    return 0
  }
}

// ── Soroban argument helpers ────────────────────────────────────────────
export function bytesFromHex(hex: string): Buffer {
  const cleaned = hex.startsWith("0x") ? hex.slice(2) : hex
  if (cleaned.length % 2 !== 0) {
    throw new Error(`hex string must have even length, got ${cleaned.length}`)
  }
  return Buffer.from(cleaned, "hex")
}

/** Build a `ScVal` from a hex-encoded field element (32 bytes). */
export function scValFromHex(hex: string): ScVal {
  return nativeToScVal(bytesFromHex(hex.padStart(64, "0")))
}

// ── Tx builder (write path) ─────────────────────────────────────────────
/**
 * Build a Soroban `Contract` invoke transaction for the given function
 * and arguments. Caller is responsible for signing (via Freighter) and
 * submitting.
 */
export function buildInvokeTx(
  sourceAccount: Account,
  functionName: string,
  args: ScVal[],
): Transaction {
  const contract = getZunoContract()
  return new TransactionBuilder(sourceAccount, {
    fee: "1000000",
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(functionName, ...args))
    .setTimeout(30)
    .build()
}

/**
 * Submit a signed transaction XDR to the Soroban RPC and wait for the
 * result. Returns the parsed return value (or `null` for void methods).
 */
export async function submitTransaction(signedXdr: string): Promise<unknown> {
  const server = getSorobanServer()
  const tx = TransactionBuilder.fromXDR(
    signedXdr,
    STELLAR_NETWORK_PASSPHRASE,
  ) as Transaction

  const sent = await server.sendTransaction(tx)
  if (sent.status === "ERROR") {
    throw new Error("Soroban rejected the transaction")
  }

  // Poll for completion. Production code should respect getTransaction's
  // recommended polling interval, but for the stub this is fine.
  let result: rpc.Api.GetTransactionResponse | null = null
  for (let i = 0; i < 30; i++) {
    result = await server.getTransaction(sent.hash)
    if (result.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) break
    await new Promise((r) => setTimeout(r, 1000))
  }

  if (!result || result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction failed: ${result?.status ?? "TIMEOUT"}`)
  }

  if (!("returnValue" in result) || !result.returnValue) return null
  return scValToNative(result.returnValue)
}

// ── Misc ────────────────────────────────────────────────────────────────
export { nativeToScVal, scValToNative, Keypair, Operation }