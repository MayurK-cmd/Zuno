# Zuno

**Zero-knowledge UNO on Stellar.**

A trustless multiplayer UNO game where your hand stays private. The blockchain only ever sees cryptographic commitments and proofs — never your cards. Moves are verified onchain, the pot is settled by the contract, and there is no host or server in the loop.

## How it works

- Each player commits to a hash of their hand onchain. Actual cards live only on the player's device.
- A Noir circuit proves a move is legal: the card was in the hand, and it matches the top of the discard pile. The contract verifies the proof, updates state, and advances the turn.
- When a hand hits zero, the pot is settled onchain. No arbiter, no off-chain trust.

## Stack

| Layer        | Tech                          |
| ------------ | ----------------------------- |
| Chain        | Stellar (Soroban, Protocol 22)|
| Contracts    | Rust + `soroban-sdk 22.0.0`   |
| ZK circuits  | Noir (`nargo 0.36`)           |
| Prover (web) | `noir_js` + `bb.js`           |
| Wallet       | Freighter                     |
| Frontend     | Next.js 16 + Tailwind         |

**Deployed contract (Stellar Testnet):**
`CBZVYOLXMVQYGHTJDRVRSB7ABR74UDV7CUIIMMHEH2JAEYAKQJOMJNAW`

## Features

- **Private hands** — Mental-poker-style commitments; cards never touch the chain.
- **ZK-verified moves** — `play_card` and `draw_card` ship with Noir proofs, verified onchain.
- **Trustless settlement** — XLM pot is locked by the contract and released when a hand reaches zero.
- **Host migration** — If the host leaves the lobby, ownership passes to the next seated player so funds never get stuck.
- **AFK protection** — Anyone at the table can force-skip after the turn timer expires.
- **Zuno call-out** — Players with one card who forget to call Zuno get a 2-card penalty.

## Repo layout

```
contracts/                                Cargo workspace
  programs/zuno/src/                      Soroban contract (10 entry points)
circuits/
  play_card/src/main.nr                   Legality + state transition
  draw_card/src/main.nr                   Draw-from-commitment
components/zuno/                          Next.js UI
hooks/                                    Freighter + contract hooks
lib/stellar.ts                            Soroban RPC + Horizon helpers
```

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. You'll need the Freighter browser extension set to **Testnet**.

Optional override for the deployed contract:

```bash
# .env.local
NEXT_PUBLIC_ZUNO_CONTRACT_ID=CBZVYOLXMVQYGHTJDRVRSB7ABR74UDV7CUIIMMHEH2JAEYAKQJOMJNAW
```

## Build

```bash
# Contracts
cd contracts && cargo build --release --target wasm32-unknown-unknown --package zuno && cargo test

# Frontend
cd .. && npm run build
```

---

Built with Noir + Soroban.
