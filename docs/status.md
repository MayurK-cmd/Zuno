# Zuno — Build Status

Last updated: 2026-06-17. Scope: the on-chain UNO game with ZK proofs, migrated from Solana → Stellar/Soroban.

This file tracks what is **actually shipped** versus what is still on the path to a working end-to-end product. The previous PRD (`todo.md`) is the original spec; treat this file as the source of truth for current state.

---

## Phase 1 — Soroban contracts (DONE)

The Rust smart-contract program compiles, tests pass, and a build is deployed on Stellar Testnet.

| Item | Status | Notes |
|---|---|---|
| `contracts/zuno/src/zuno.rs` — all 10 entry points | ✅ | `initialize_room`, `join_room`, `start_game`, `reveal_randomness`, `play_card`, `draw_card`, `call_zuno`, `claim_victory`, `force_skip`, `punish_zuno` |
| Host-migration logic in `join_room` | ✅ | If the current host is absent, ownership passes to the next seated player so funds never get stuck. |
| Turn timeout (`force_skip`) | ✅ | Anyone at the table can push a skip after the timer. |
| Zuno call-out + 2-card penalty (`call_zuno` / `punish_zuno`) | ✅ | |
| Build profile + WASM target | ✅ | `soroban contract build` clean |
| Deploy to Stellar Testnet | ✅ | Contract ID: `CBZVYOLXMVQYGHTJDRVRSB7ABR74UDV7CUIIMMHEH2JAEYAKQJOMJNAW` |
| Real on-chain verifier for Noir proofs | ❌ stub | `verify_noir_proof` accepts a dummy proof (`proof=00`) so the contract logic can be exercised end-to-end. **Real verifier is the last hard piece.** |

## Phase 2 — Noir circuits (DONE, pending keys)

| Item | Status | Notes |
|---|---|---|
| `circuits/play_card/src/main.nr` — legality + state transition | ✅ | nargo 0.36 compiles clean (non-ASCII chars sanitised). |
| `circuits/draw_card/src/main.nr` — draw from commitment | ✅ | same |
| `Nargo.toml` + `Prover.toml` per circuit | ✅ | |
| Verification keys + verifier contract | ❌ | `bb write_vk` + `bb contract` not run yet (requires `bbup` install). User deferred this for end-of-build. |
| Port verifier to Soroban host | ❌ | See "Remaining work → Step B" below. |

## Phase 2 — Frontend wallet migration (Solana → Stellar) (DONE)

Steps 1–7 of the wallet-layer swap are complete and the project builds clean.

| Step | Status | File(s) |
|---|---|---|
| 1. Freighter-based wallet context | ✅ | `components/zuno/wallet-context-provider.tsx`, `hooks/use-freighter.ts` |
| 2. `app/layout.tsx` (no Solana CSS, Stellar metadata) | ✅ | `app/layout.tsx` |
| 3. XLM balance badge via Horizon | ✅ | `components/zuno/wallet-balance-badge.tsx`, `lib/stellar.ts` |
| 4. `ConnectWalletButton` + landing/lobby/table swaps | ✅ | `components/zuno/connect-wallet-button.tsx`, `landing-screen.tsx`, `room-lobby.tsx`, `game-table.tsx` |
| 5. Text sweep SOL → XLM, Solscan → Stellar Expert | ✅ | `game-over-dialog.tsx`, etc. |
| 6. Drop Solana deps + stale pnpm lockfile | ✅ | `package.json`, `node_modules/@solana` removed |
| 7. `tsc --noEmit` + `npm run build` both green | ✅ | exit 0 |
| `lib/solana.ts` deleted | ✅ | call-sites re-pointed at `lib/stellar.ts` |

## Phase 2 — Frontend prover pipeline (DONE in stub mode)

The prover-pipeline plumbing exists end-to-end. The actual ZK work is stubbed.

| Item | Status | Notes |
|---|---|---|
| Web Worker wrapper | ✅ | `components/zuno/workers/zuno-prover.worker.ts` |
| Main-thread hook `useZunoProver` | ✅ | `components/zuno/hooks/use-zuno-prover.ts` |
| Toast pipeline `runTransactionPipeline` driving worker → contract | ✅ | `components/zuno/transaction-toast.tsx` |
| Typed contract hook covering all 10 methods | ✅ | `hooks/use-zuno-contract.ts` |
| Worker actually generates a real Noir proof | ❌ stub | currently sleeps ~700 ms and returns `proofHex="00"` |

---

## Remaining work — to finish the product

This is the path from "everything wired up with mocks" to "a stranger can play an honest game on Testnet."

### A. Generate the verifier keys (laptop-bound, deferred)

Install `bb` and produce artifacts for both circuits:

```bash
curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/bbup/install | bash && bbup
cd circuits/play_card && nargo compile && bb write_vk -b target/play_card.json -o target/vk
cd ../draw_card && nargo compile && bb write_vk -b target/draw_card.json -o target/vk
```

Per circuit you get a verification key plus a verifier-contract template.

### B. Bridge the verifier onto Soroban (the structural step)

`bb contract` emits Solidity / generic verifier JSON. Soroban contracts are **Rust + `soroban-sdk`**, not Solidity, so the verifier must be hand-ported or wrapped. Options:

1. Hand-port the bn254 / alt_bn128 pairing checks and call the **BLS12-381 host precompile** (added in Stellar Protocol 22). Requires the deployed RPC to be on Protocol 22+.
2. Use a community Noir→Soroban verifier port if one exists for nargo 0.36.
3. **Cheaty shortcut:** accept a Groth16 proof byte string plus a designated verifier's signature; have the verifier check the proof off-chain. Fine for dev, not for trustless play.

This is the part with the most friction.

### C. Wire the real verifier into the contract

Replace `verify_noir_proof` in `contracts/zuno/src/zuno.rs` with the real check, and update each entry point (`initialize_room`, `play_card`, `draw_card`, `call_zuno`, `claim_victory`, …) to call it instead of accepting the dummy proof.

### D. Swap the worker from stub to real proof generation

Replace the stub in `components/zuno/workers/zuno-prover.worker.ts` with `noir_js` + `bb.js`. Inputs: the witness your table already constructs. Output: real proof bytes posted to the contract.

### E. End-to-end on Stellar Testnet

Host creates a room → joins → draws → plays a card → Zuno → claim. Each step needs a real proof, and each proof needs the contract to actually accept it.

### F. Doc refresh

`docs/blockchain.md`, `docs/README.md`, `docs/todo.md` still describe the Solana-era architecture in places. Update after Steps B–D so the docs describe what is actually live, not what was planned.

---

## Open questions / nice-to-haves

- Multi-room scaling: `MOCK_ROOMS` in `room-lobby.tsx` is hardcoded. Real room discovery needs an indexer or `getEvents` polling.
- Reconnect on Freighter disconnect mid-hand.
- Settlement when only one player remains (auto-win vs. AFK timeout).
