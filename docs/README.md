# Zuno

**Zuno** is a decentralized, privacy-preserving version of the classic card game Uno, built entirely on **Solana**. By utilizing **Zero-Knowledge (ZK) Proofs**, Zuno ensures that while the game logic and wagering are public and trustless, your hand remains completely secret from other players and even the blockchain itself.

---

## 🛠 How it Works

Zuno translates the classic "pattern matching" gameplay into a series of cryptographic proofs:

* **Secret Hands:** Players hold their cards locally. Instead of the blockchain seeing your cards, it only sees a "Commitment" (a unique hash).
* **The ZK-Referee:** When you play a card, you generate a **ZK-Proof** that proves two things:
    1. The card was actually in your hand.
    2. The card matches the color or number of the top card on the discard pile.
* **Instant Settlements:** Since the rules are enforced by a Solana program (smart contract), the moment a player's hand reaches zero, the contract automatically verifies the win and distributes the prize pool.

---

## 🚀 Features

* **Verifiable Fairness:** No "house" edge or rigged decks. The shuffle is handled via on-chain randomness (VRF).
* **High Performance:** Built on Solana for sub-second turn finality and ultra-low transaction fees.
* **ZK-Privacy:** Powered by **Noir** to ensure "Mental Poker" style privacy—play with hidden information without a central server.
* **Stakes:** Join lobbies with $SOL or custom SPL tokens.

---

## 🏗 Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Blockchain** | Solana |
| **Smart Contracts** | Anchor (Rust) |
| **ZK Circuits** | Noir |
| **State Management** | Light Protocol (ZK Compression) |
| **Frontend** | Next.js + Tailwind CSS + WalletAdapter |

---

## 🎮 Quick Start (Dev)

1. **Install Dependencies:**
   ```bash
   npm install
   ```
2. **Compile Circuits:**
   ```bash
   nargo compile
   ```
3. **Deploy Program:**
   ```bash
   anchor deploy
   ```
4. **Run Local UI:**
   ```bash
   npm run dev
   ```

---

## 📜 Game Rules
* **Match:** Play a card that matches the **color** or **number** of the current face-up card.
* **Draw:** If you can't play, you must draw. A ZK-proof is generated to update your "Hand Commitment."
* **Zuno!:** When you have one card left, you must trigger the "Zuno" state on-chain or face a penalty if caught by another player.
* **Win:** Empty your hand to claim the pot.

---

**Built with ❤️ for the Solana Ecosystem.**

