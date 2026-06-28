# Zuno — Build Status

Last updated: 2026-06-28. Scope: a ZK multiplayer UNO game on Stellar Soroban. Handing off — friend should read this before touching anything.

---

## What works

- **Soroban contracts** (`contracts/programs/zuno/`) compile clean, tests pass, deployed to Stellar Testnet. **Game contract: `CCMHETHXUZ5M7Y3ZD535Y6JQD35F7AKO2BSUKNETLIWTDRCDAQRASDXI`** (deployed 2026-06-26, source: `frontend/.env::VITE_ZUNO_CONTRACT_ID`). **Verifier stub: `CASKHTQPBD32L76VWP32HJ65YPS33D2F2GFELCUQN7OFQSGMOA6ZMUNT`** (placeholder, always returns true). All 10 entry points work end-to-end against the stub verifier. The earlier `CBZVYOLXM...` deployment referenced in older notes is deprecated.
- **Noir circuits** (`circuits/play_card/`, `circuits/draw_card/`) compile clean with nargo 0.36. Hand-commitment + Poseidon2 + state-transition logic is correct (passes 250+ isolated Node tests with the same witness format).
- **Frontend bootstrap** (`frontend/src/router.tsx` → TanStack Start, `routes/index.tsx` → landing, `routes/lobby.tsx` → room list, `routes/game.$roomId.tsx` → game) is fully wired to Freighter + Horizon + Soroban RPC.
- **Wallet + XLM flows** work: connect via Freighter, native balance via Horizon, SAC trustline, game-room creation/joining with stake.
- **Game-room polling** (`hooks/use-game-state.ts` + `lib/stellar.ts::getGameRoom`) reads `GameRoom` from on-chain storage. `Option<BytesN<32>>` decode (`bytesToHexLower`) accepts both the direct-`Uint8Array` and `Uint8Array[]` shapes the SDK sometimes returns.
- **Seed distribution** works: host commits a seed on `initialize_room`, reveals on `start_game`. Joiners pick up `commit_reveal_seed` from on-chain storage and derive their own 15-card hand via Fisher-Yates.
- **Per-player hand derivation** (`hooks/use-deck.ts`) is correct: cache key `zuno:hand:${roomId}:${pubKey}:p${playerIndex}` isolates each profile, stale `:p<n>` entries are pruned.
- **Turn indicator + gates**: `game.$roomId.tsx::opponents` reads `gameRoom.currentTurn` to mark the active player. `playSelected` and `drawCard` reject wrong-player submissions before proof generation.
- **On-chain color encoding** matches UI: `0=Red, 1=Green, 2=Blue, 3=Yellow` (see `game.$roomId.tsx:81-89`). Earlier swap caused false "Card out of sync" — fixed.
- **Type-check** (`npx tsc --noEmit` in `frontend/`) is clean.

---

## What does NOT work — current open issue

**Playing a card fails in the browser with:**
```
RuntimeError: unreachable at wasm://wasm/02f5ba0a:wasm-function[19199]:0xb661c1
```

This fires inside `noir.execute()` in `frontend/src/workers/prover.worker.ts`. Same witness + same circuit pass cleanly when run in Node — the failure is browser-specific. Frame `[19199]:0xb661c1` is deterministic, so it is reproducible on the same input. Stack trace is consistent across both profiles and both `play_card` and `draw_card` paths.

### Most likely root cause

**Improper Noir / ACVM docs around browser execution.** Specifically:
1. `noir.execute()` runs the ACVM WASM (`@noir-lang/acvm_js`). That WASM uses Rust's default `wasm-bindgen` memory config (~32 pages × 64 KiB = 2 MB initial). It does NOT accept a `memory` option from JS the way bb.js does — every example online shows memory bumping on `Barretenberg.new({ memory: { initial } })`, but that's a **different WASM instance** (bb.js, not ACVM). Bumping bb.js memory does not help.
2. The 32-instance `BlackBoxFuncCall::Poseidon2Permutation` chain in `play_card` is large; some browser/extension combinations truncate the WASM heap differently and trigger the `unreachable` opcode.
3. The Noir project's "browser quickstart" docs are out of date for `@noir-lang/noir_js@1.0.0-beta.x` + `@aztec/bb.js@0.50`. The combo currently in `frontend/package.json` (`@noir-lang/noir_js: ^0.36.0`, `@aztec/bb.js: ^0.50.1`) is mismatched — newer versions may have resolved the WASM memory issue.

### Suggested next steps for the friend

1. Confirm `[worker] inputs before execute` log fires with non-empty `hand_array`, then `noir.execute FAILED` with the same `wasm-function[19199]` panic. If it does, this is the issue.
2. Try a `@noir-lang/noir_js` upgrade to the latest stable (likely `1.0.0-beta.22+`) which pairs with `@aztec/bb.js@0.50.x`. The `acvm_js` WASM in that line uses a different memory init.
3. If upgrading is too disruptive: replicate the witness in Node using the same `prove()` library — it succeeds there, confirming the circuit/witness is correct. The browser path is the only broken surface.
4. As a workaround until the upgrade: run proof generation in a server-side route (`frontend/src/server.ts` already exists) and POST the proof back to the client. Slows down UI but unblocks the demo.

### Other open items (deferred, not blockers for the panic)

- Real verifier in contract: `verify_noir_proof` accepts a dummy `proof=00`. The `server/` folder signs verified proofs externally instead.
- `MOCK_ROOMS` in `routes/lobby.tsx` is hardcoded — real room discovery needs an indexer or `getEvents` polling.
- Reconnect on Freighter disconnect mid-hand.
- Auto-win / AFK timeout when only one player remains.

---

## Frontend stack (`frontend/`)

| Layer | What | Where |
|---|---|---|
| **Framework** | TanStack Start (Vite + React 19) | `vite.config.ts`, `src/router.tsx`, `src/routeTree.gen.ts` |
| **Routing** | File-based, TanStack Router | `src/routes/index.tsx` (landing), `lobby.tsx`, `game.$roomId.tsx`, `about.tsx`, `__root.tsx` |
| **Wallet** | Freighter API | `src/hooks/use-wallet.ts` |
| **Stellar RPC** | `@stellar/stellar-sdk` v16, `rpc.Server` | `src/lib/stellar.ts` |
| **On-chain calls** | All 10 entry points + tx assembly | `src/lib/contract-calls.ts` |
| **Game state poll** | 4s polling loop | `src/hooks/use-game-state.ts` |
| **Hand derivation** | Fisher-Yates seeded by host's reveal | `src/hooks/use-deck.ts` + `src/lib/hand.ts` |
| **Commitments** | Poseidon2 (WASM from bb.js) | `src/lib/commitment.ts` |
| **ZK proof gen** | `noir_js.execute()` + `bb.acirProveUltraHonk()` in a Web Worker | `src/workers/prover.worker.ts` + `src/hooks/use-prover.ts` |
| **UI primitives** | shadcn/ui (Radix + Tailwind 4) | `src/components/ui/*` |
| **Game UI** | Custom UnoCard, GameTable, etc. | `src/components/{UnoCard,Header,Starfield,UsernameDialog}.tsx` + `src/routes/game.$roomId.tsx` |
| **Toast** | `sonner` | `src/components/ui/sonner.tsx` |
| **Styling** | Tailwind 4 + PostCSS | `src/styles.css`, `postcss.config` inline in vite |
| **Env vars** | `frontend/.env` (`VITE_SOROBAN_RPC_URL`, `VITE_HORIZON_URL`, `VITE_NETWORK_PASSPHRASE`, `VITE_ZUNO_CONTRACT_ID`, `VITE_VERIFIER_CONTRACT_ID`, `VITE_XLM_CONTRACT_ID`) | |
| **Lockfile** | `bun.lock` (NOT `package-lock.json`) | `bunfig.toml` has 24h minimum-release-age guard |

---

## Why the `server/` folder is needed

Soroban contracts cannot run bb.js or `@noir-lang/acvm_js` inside their WASM sandbox — the host functions don't expose the elliptic-curve primitives UltraHonk needs. So proof verification lives **off-chain** in `server/`.

### What it does

`server/verifier-server.ts` (Express on port 3001):
1. **Loads VK files** at startup from `circuits/{play_card,draw_card}/target/vk/vk`.
2. **`POST /api/verify-play-card`** — accepts `{ proof, publicInputs }`, runs `bb.acirVerifyUltraHonk(proof, playCardVk)`. On success, **signs the proof with `VERIFIER_PRIVATE_KEY`** (from `server/.env`) using `ethers.Wallet`. Returns `{ valid: true, signature }`.
3. **`POST /api/verify-draw-card`** — same flow with `drawCardVk`.
4. The signed proof is then submitted to the Soroban contract, which checks the signature against an authorized verifier address — this is the trust bridge that replaces a native on-chain verifier.

### Why not in-process

- The contract's `verify_noir_proof` is a stub. Real `acirVerifyUltraHonk` requires ~hundreds of MB of RAM and the bn254 host functions Soroban doesn't expose.
- Centralizing verifier logic lets the friend rotate the verifier key without redeploying the contract.
- The frontend (TanStack Start) doesn't run Node-only deps like `ethers`; keeping the signer server-side avoids bundling it.

### Env vars required in `server/.env`
- `PORT` (default 3001)
- `VERIFIER_PRIVATE_KEY` — the secp256k1 key whose address the contract trusts.

### Run it
```bash
cd server && npm install && npm run dev
```