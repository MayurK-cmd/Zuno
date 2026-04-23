This current UI foundation is fantastic—it hits all the right notes for a dark-mode, neon-accented Web3 dashboard. 

However, to make this **100% complete** so you never have to touch the UI architecture again and can solely focus on your Anchor smart contracts and Noir circuits, there are a few critical "Web3" and "UNO-specific" edge cases missing from the flow.

Here is the **Product Requirements Document (PRD)** detailing the final UI additions required to consider the frontend "feature-complete."

---

# PRD: Zuno Frontend Finalization

## **Objective**
Finalize all UI states, modals, and edge-case components required for a fully functional on-chain card game, ensuring seamless integration with Solana wallets and ZK-proof generation.

## **1. Web3 Wallet & Auth Layer (Crucial Addition)**
Currently, the UI asks for a "unique name." This needs to be bound to a Solana wallet.
* **Component: Solana Wallet Adapter**
  * Replace or accompany the "Enter Name" input with a standard `WalletMultiButton` (Phantom, Solflare, etc.).
  * **UI Flow:** User connects wallet -> App checks if wallet has an active session/name -> If not, prompts for Name registration.
* **Component: Header Balance Display**
  * Display the user's current `$SOL` balance next to their profile in the lobby and game table. This ensures they know they have enough for gas/buy-ins.

## **2. Missing Core Game Mechanics**
You have the cards and the table, but Uno has specific interactive edge cases that require dedicated UI elements.
* **Component: Wild Card Color Selector (Modal/Popover)**
  * **Trigger:** When a player drops a "Wild" or "Wild +4" card onto the discard pile.
  * **UI:** A sleek, glowing 4-quadrant circle (Red, Blue, Green, Yellow). The game state *pauses* and the ZK proof *does not generate* until the user clicks a color.
* **Component: The "ZUNO!" Button**
  * **Trigger:** Appears dynamically near the player's hand when they hold exactly **2 cards** (so they can click it before playing down to 1), or when they hold **1 card**.
  * **UI:** A glowing red/cyan neon button. 
* **Component: "Catch/Call Out" Button**
  * **Trigger:** If an opponent drops to 1 card but forgets to click their Zuno button.
  * **UI:** A small alert icon next to the opponent's avatar that any other player can click to force a 2-card draw penalty on the offender.

## **3. ZK & Transaction Feedback Systems**
Web3 games live or die by how they mask blockchain latency. 
* **Component: Transaction Toast Notifications**
  * **UI:** Slide-in alerts at the bottom right.
  * **States:** * `Generating ZK Proof... (Local)` - Gear spinning.
    * `Confirming on Solana...` - Cyan pulse.
    * `Success! View on Solscan ↗` - Green checkmark.
    * `Transaction Failed` - Red alert (e.g., if another player moved first and the state changed).
* **Component: ZK Shield Tooltip**
  * **UI:** When hovering over the "Hand Secured by Noir" shield banner, show a small tooltip explaining: *"Your cards are hashed locally. Only the cryptographic proof is sent to Solana."*

## **4. Game Resolution & Settlements**
The game needs a graceful way to end and distribute the pot.
* **Component: Game Over / Victory Modal**
  * **Trigger:** A player's hand array reaches `0`.
  * **UI:** A full-screen frosted glass overlay.
    * **If You Win:** Confetti animation. Big text: "YOU WIN! +[X] SOL". A button to "Claim Pot to Wallet."
    * **If You Lose:** "Player [Name] Wins." Shows the final pot size. Button to "Return to Lobby."
* **Component: Leaderboard / Post-Game Stats**
  * **UI:** A quick summary showing how many turns were taken, who drew the most cards, and the transaction hash for the final settlement.

## **5. Anti-AFK & Timeout Handling**
Because it's a multiplayer Web3 game, you can't have someone walk away and lock up the smart contract funds forever.
* **Component: Turn Timer Progress Bar**
  * **UI:** A thin cyan loading bar under the current active player's avatar.
  * **Behavior:** Visualizes a 30-second or 60-second countdown.
* **Component: "Force Skip" / Boot Button**
  * **Trigger:** Appears for all players if the active player's timer hits zero.
  * **UI:** Allows the rest of the table to push an on-chain transaction that forces the AFK player to draw a card and skips their turn.

---

### **Next Steps for Prompting**
You can pass this directly to your UI generator by saying:
*"Add the following specific components to our existing Zuno UI: 1. A 4-color Wild Card selector popup. 2. A glowing 'ZUNO!' action button. 3. A victory modal with a 'Claim SOL' button. 4. A turn-timer progress bar under opponent avatars. 5. Bottom-right Web3 transaction toast notifications."*

We plan to handle the "Host leaves" scenario in the Lobby— migrate host privileges to the next player
