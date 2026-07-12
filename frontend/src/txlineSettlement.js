import { ComputeBudgetProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

export const TXLINE_SETTLEMENT_COMPUTE_UNITS = 1_400_000;

export function txlineSettlementPreInstructions() {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({
      units: TXLINE_SETTLEMENT_COMPUTE_UNITS,
    }),
  ];
}

// Built manually (same reasoning as placeBet in App.jsx) so every account
// keeps the exact writable/signer flags the on-chain program expects,
// independent of Anchor's auto account-meta resolution from the legacy
// Solana Playground IDL — which is what caused the placeBet CPI failure.
export function buildSettleMarketTx(program, args, accounts) {
  const data = program.coder.instruction.encode("settleMarket", {
    ts:             args.ts,
    fixtureSummary: args.fixtureSummary,
    fixtureProof:   args.fixtureProof,
    mainTreeProof:  args.mainTreeProof,
    statA:          args.statA,
    statB:          args.statB,
  });

  const ix = new TransactionInstruction({
    programId: program.programId,
    keys: [
      { pubkey: accounts.settler,                isSigner: true,  isWritable: true  }, // settler
      { pubkey: accounts.market,                 isSigner: false, isWritable: true  }, // market
      { pubkey: accounts.dailyScoresMerkleRoots, isSigner: false, isWritable: false }, // daily_scores_merkle_roots
      { pubkey: accounts.txlineProgram,          isSigner: false, isWritable: false }, // txline_program
    ],
    data,
  });

  const tx = new Transaction();
  txlineSettlementPreInstructions().forEach((pre) => tx.add(pre));
  tx.add(ix);
  return tx;
}
