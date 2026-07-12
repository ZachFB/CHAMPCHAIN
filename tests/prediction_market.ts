import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import { describe, it } from "mocha";
import { ComputeBudgetProgram } from "@solana/web3.js";

const TXLINE_SETTLEMENT_COMPUTE_UNITS = 1_400_000;

describe("prediction_market — local instructions (no TxLINE fixture required)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.PredictionMarket as Program;
  const connection = provider.connection;

  // A fresh match_id per run avoids collisions with a market PDA left over
  // from a previous test run against the same local validator state.
  const matchId = `TEST-${Date.now() % 1_000_000}`;

  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from(matchId)],
    program.programId
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketPda.toBuffer()],
    program.programId
  );

  const bettorYes = anchor.web3.Keypair.generate();
  const bettorNo = anchor.web3.Keypair.generate();

  const [betYesPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bet"), marketPda.toBuffer(), bettorYes.publicKey.toBuffer()],
    program.programId
  );
  const [betNoPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bet"), marketPda.toBuffer(), bettorNo.publicKey.toBuffer()],
    program.programId
  );

  const stakeYes = 0.5 * LAMPORTS_PER_SOL;
  const stakeNo = 0.3 * LAMPORTS_PER_SOL;

  before(async () => {
    for (const kp of [bettorYes, bettorNo]) {
      const sig = await connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
    }
  });

  it("initializes a market with a frozen predicate", async () => {
    const now = Math.floor(Date.now() / 1000);
    await program.methods
      .initializeMarket(
        matchId,
        new BN(17_271_301), // fixtureId
        1, // stat_a_key: Participant1 total score
        null, // stat_b_key
        1, // period (full game)
        { threshold: 1, comparison: { greaterThan: {} } }, // predicate
        null, // op
        new BN(now + 5), // close_ts: closes in 5s so the test can exercise the post-close cancel path
        new BN(now + 10) // earliest_settle_ts
      )
      .accounts({
        authority: provider.wallet.publicKey,
        market: marketPda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    expect(market.matchId).to.equal(matchId);
    expect(market.outcome).to.deep.equal({ pending: {} });
    expect(market.totalYes.toNumber()).to.equal(0);
    expect(market.totalNo.toNumber()).to.equal(0);
  });

  it("accepts bets on both sides and moves funds into the vault PDA", async () => {
    const vaultBefore = await connection.getBalance(vaultPda);

    await program.methods
      .placeBet(true, new BN(stakeYes))
      .accounts({
        user: bettorYes.publicKey,
        market: marketPda,
        vault: vaultPda,
        bet: betYesPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([bettorYes])
      .rpc();

    await program.methods
      .placeBet(false, new BN(stakeNo))
      .accounts({
        user: bettorNo.publicKey,
        market: marketPda,
        vault: vaultPda,
        bet: betNoPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([bettorNo])
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    expect(market.totalYes.toNumber()).to.equal(stakeYes);
    expect(market.totalNo.toNumber()).to.equal(stakeNo);

    const vaultAfter = await connection.getBalance(vaultPda);
    expect(vaultAfter - vaultBefore).to.equal(stakeYes + stakeNo);
  });

  it("rejects a bet that switches sides on an existing position", async () => {
    let threw = false;
    try {
      await program.methods
        .placeBet(false, new BN(1000))
        .accounts({
          user: bettorYes.publicKey,
          market: marketPda,
          vault: vaultPda,
          bet: betYesPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([bettorYes])
        .rpc();
    } catch (e) {
      threw = true;
      expect(String(e)).to.match(/CannotChangeSide/);
    }
    expect(threw, "expected placeBet to reject a side switch").to.be.true;
  });

  it("cancels the market once the settlement window is reachable and refunds bettors in full", async () => {
    // close_ts was set 5s in the future above; wait it out so cancel_market's
    // pre-close-or-post-grace-period check has a path to take.
    await new Promise((r) => setTimeout(r, 6_000));

    await program.methods
      .cancelMarket()
      .accounts({
        authority: provider.wallet.publicKey,
        market: marketPda,
      })
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    expect(market.outcome).to.deep.equal({ cancelled: {} });

    const yesBalanceBefore = await connection.getBalance(bettorYes.publicKey);
    await program.methods
      .claimWinnings()
      .accounts({
        user: bettorYes.publicKey,
        market: marketPda,
        vault: vaultPda,
        bet: betYesPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([bettorYes])
      .rpc();
    const yesBalanceAfter = await connection.getBalance(bettorYes.publicKey);

    // Refund equals the original stake exactly (Outcome::Cancelled path),
    // minus nothing but the tx fee the bettor themselves paid.
    expect(yesBalanceAfter - yesBalanceBefore).to.be.greaterThan(stakeYes - 20_000);

    const betYes = await program.account.bet.fetch(betYesPda);
    expect(betYes.claimed).to.be.true;
  });

  it("rejects a second claim on the same bet", async () => {
    let threw = false;
    try {
      await program.methods
        .claimWinnings()
        .accounts({
          user: bettorYes.publicKey,
          market: marketPda,
          vault: vaultPda,
          bet: betYesPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([bettorYes])
        .rpc();
    } catch (e) {
      threw = true;
      expect(String(e)).to.match(/AlreadyClaimed/);
    }
    expect(threw, "expected a second claim to be rejected").to.be.true;
  });
});

// ─────────────────────────────────────────────────────────────────────────
// TxLINE-dependent settlement path.
//
// settle_market's correctness against the real TxLINE program (discriminator,
// account list, argument/struct/enum field order) is independently verified
// in TXLINE_INTEGRATION_VERIFICATION.md against the live devnet and mainnet
// IDLs — not just against documentation prose. What is NOT exercised here is
// an actual signed CPI round-trip, because that requires a real finished-
// match proof fixture from TxLINE's /api/scores/stat-validation endpoint,
// which only exists once a real World Cup fixture has concluded.
//
// This suite stays skipped intentionally rather than mocking the CPI, which
// would just test that our mock behaves like our mock. Before the demo
// recording, replace this block with a real call once a finished fixture's
// proof is available, using computeBudgetIx in preInstructions.
describe.skip("prediction_market — TxLINE settlement (needs a live devnet proof fixture)", () => {
  it("settles a market via CPI into TxLINE's validate_stat with a real proof", () => {
    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: TXLINE_SETTLEMENT_COMPUTE_UNITS,
    });
    void computeBudgetIx;
  });
});
