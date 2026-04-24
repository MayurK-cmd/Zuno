import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import { Zuno } from "../target/types/zuno";

// ── Helpers ──────────────────────────────────────────────────────────────────

function gameRoomPda(programId: PublicKey, roomId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("game_room"), roomId.toArrayLike(Buffer, "le", 8)],
    programId
  );
}

function vaultPda(programId: PublicKey, roomKey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), roomKey.toBuffer()],
    programId
  );
}

function playerStatePda(
  programId: PublicKey,
  roomKey: PublicKey,
  playerKey: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("player_state"), roomKey.toBuffer(), playerKey.toBuffer()],
    programId
  );
}

// Stub proof — replaced by real Noir proof bytes in full integration tests.
// The Sunspot verifier program must be running locally for real proof tests.
const STUB_PROOF = Buffer.alloc(64, 0xab);

// Stub 32-byte commitment hash
function stubHash(seed: number): number[] {
  return Array.from({ length: 32 }, (_, i) => (seed + i) % 256);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

describe("zuno", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Zuno as Program<Zuno>;
  const connection = provider.connection;

  let host: Keypair;
  let player2: Keypair;
  let player3: Keypair;
  let roomId: BN;
  let roomKey: PublicKey;
  let vaultKey: PublicKey;

  // Stub external program keys (replace with real deployed addresses)
  const VERIFIER_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
  const VRF_ACCOUNT_KEY = Keypair.generate().publicKey;

  before(async () => {
    host = Keypair.generate();
    player2 = Keypair.generate();
    player3 = Keypair.generate();
    roomId = new BN(Date.now()); // unique per test run

    // Airdrop to all wallets
    await Promise.all(
      [host, player2, player3].map(async (kp) => {
        const sig = await connection.requestAirdrop(kp.publicKey, 10 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig, "confirmed");
      })
    );

    [roomKey] = gameRoomPda(program.programId, roomId);
    [vaultKey] = vaultPda(program.programId, roomKey);
  });

  // ── initialize_room ─────────────────────────────────────────────────────────

  it("host can initialize a room", async () => {
    const buyIn = new BN(0.1 * LAMPORTS_PER_SOL);

    await program.methods
      .initializeRoom(buyIn, roomId)
      .accountsPartial({
        gameRoom: roomKey,
        vault: vaultKey,
        host: host.publicKey,
        verifierProgram: VERIFIER_PROGRAM_ID,
        vrfAccount: VRF_ACCOUNT_KEY,
        systemProgram: SystemProgram.programId,
      })
      .signers([host])
      .rpc();

    const room = await program.account.gameRoom.fetch(roomKey);
    assert.equal(room.host.toBase58(), host.publicKey.toBase58());
    assert.equal(room.buyIn.toNumber(), buyIn.toNumber());
    assert.deepEqual(room.status, { waiting: {} });
    assert.equal(room.players.length, 1);
    assert.equal(room.players[0].toBase58(), host.publicKey.toBase58());

    const vaultBalance = await connection.getBalance(vaultKey);
    assert.equal(vaultBalance, buyIn.toNumber());
  });

  it("rejects duplicate room id", async () => {
    const buyIn = new BN(0.1 * LAMPORTS_PER_SOL);
    try {
      await program.methods
        .initializeRoom(buyIn, roomId)
        .accountsPartial({
          gameRoom: roomKey,
          vault: vaultKey,
          host: host.publicKey,
          verifierProgram: VERIFIER_PROGRAM_ID,
          vrfAccount: VRF_ACCOUNT_KEY,
          systemProgram: SystemProgram.programId,
        })
        .signers([host])
        .rpc();
      assert.fail("should have thrown");
    } catch (e: any) {
      assert.include(e.message, "already in use");
    }
  });

  // ── join_room ───────────────────────────────────────────────────────────────

  it("player2 can join the room", async () => {
    const [psKey] = playerStatePda(program.programId, roomKey, player2.publicKey);

    await program.methods
      .joinRoom()
      .accountsPartial({
        gameRoom: roomKey,
        vault: vaultKey,
        playerState: psKey,
        player: player2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([player2])
      .rpc();

    const room = await program.account.gameRoom.fetch(roomKey);
    assert.equal(room.players.length, 2);

    const ps = await program.account.playerState.fetch(psKey);
    assert.equal(ps.player.toBase58(), player2.publicKey.toBase58());
    assert.equal(ps.cardCount, 0);
  });

  it("player3 can join the room", async () => {
    const [psKey] = playerStatePda(program.programId, roomKey, player3.publicKey);

    await program.methods
      .joinRoom()
      .accountsPartial({
        gameRoom: roomKey,
        vault: vaultKey,
        playerState: psKey,
        player: player3.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([player3])
      .rpc();

    const room = await program.account.gameRoom.fetch(roomKey);
    assert.equal(room.players.length, 3);
  });

  it("rejects joining a full room (simulated via duplicate join)", async () => {
    const [psKey] = playerStatePda(program.programId, roomKey, player2.publicKey);
    try {
      await program.methods
        .joinRoom()
        .accountsPartial({
          gameRoom: roomKey,
          vault: vaultKey,
          playerState: psKey,
          player: player2.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([player2])
        .rpc();
      assert.fail("should have thrown AlreadyInRoom");
    } catch (e: any) {
      assert.include(e.message, "AlreadyInRoom");
    }
  });

  // ── call_zuno ───────────────────────────────────────────────────────────────

  it("call_zuno fails when card_count != 2", async () => {
    // player2 has card_count = 0, so this should fail
    const [psKey] = playerStatePda(program.programId, roomKey, player2.publicKey);
    try {
      await program.methods
        .callZuno()
        .accountsPartial({
          gameRoom: roomKey,
          playerState: psKey,
          player: player2.publicKey,
        })
        .signers([player2])
        .rpc();
      assert.fail("should have thrown ZunoRequiresTwoCards");
    } catch (e: any) {
      assert.include(e.message, "ZunoRequiresTwoCards");
    }
  });

  // ── punish_zuno ─────────────────────────────────────────────────────────────

  it("punish_zuno fails when target has 0 cards and has_called_zuno is false", async () => {
    const [offenderPsKey] = playerStatePda(program.programId, roomKey, player2.publicKey);
    try {
      await program.methods
        .punishZuno()
        .accountsPartial({
          gameRoom: roomKey,
          offenderState: offenderPsKey,
          offender: player2.publicKey,
          caller: player3.publicKey,
        })
        .signers([player3])
        .rpc();
      assert.fail("should have thrown PunishNotApplicable");
    } catch (e: any) {
      assert.include(e.message, "PunishNotApplicable");
    }
  });

  it("punish_zuno fails when caller == offender", async () => {
    const [offenderPsKey] = playerStatePda(program.programId, roomKey, player2.publicKey);
    try {
      await program.methods
        .punishZuno()
        .accountsPartial({
          gameRoom: roomKey,
          offenderState: offenderPsKey,
          offender: player2.publicKey,
          caller: player2.publicKey,
        })
        .signers([player2])
        .rpc();
      assert.fail("should have thrown CannotPunishSelf");
    } catch (e: any) {
      assert.include(e.message, "CannotPunishSelf");
    }
  });

  // ── PDAs are deterministic ──────────────────────────────────────────────────

  it("PDAs are deterministic and correct", () => {
    const [derivedRoom] = gameRoomPda(program.programId, roomId);
    const [derivedVault] = vaultPda(program.programId, roomKey);
    const [derivedPs] = playerStatePda(program.programId, roomKey, host.publicKey);

    assert.equal(derivedRoom.toBase58(), roomKey.toBase58());
    assert.equal(derivedVault.toBase58(), vaultKey.toBase58());
    assert.ok(PublicKey.isOnCurve(derivedPs.toBytes()) === false, "PDA must be off-curve");
  });

  // ── pot accounting ──────────────────────────────────────────────────────────

  it("vault holds the correct pot amount after all joins", async () => {
    const room = await program.account.gameRoom.fetch(roomKey);
    const vaultBalance = await connection.getBalance(vaultKey);
    assert.equal(vaultBalance, room.pot.toNumber());
    // 3 players × buy_in
    assert.equal(room.pot.toNumber(), 3 * 0.1 * LAMPORTS_PER_SOL);
  });
});
