// Real TxLINE network configuration, copied field-for-field from the
// official World Cup Free Tier guide:
// https://txline.txodds.com/documentation/worldcup
//
// Rule from that guide (do not violate): the Solana RPC, TxLINE program ID,
// guest JWT, and activation endpoint must all be for the SAME network. A
// devnet subscription transaction cannot be activated on the mainnet API
// host, and vice versa.
import { PublicKey } from "@solana/web3.js";

export const TXLINE_NETWORK = "devnet"; // ChampChain is a devnet build end-to-end.

export const TXLINE_CONFIG = {
  mainnet: {
    rpcUrl: "https://api.mainnet-beta.solana.com",
    apiOrigin: "https://txline.txodds.com",
    programId: new PublicKey("9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA"),
    txlTokenMint: new PublicKey("Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL"),
    // Mainnet free tiers per the World Cup guide: service level 1 (60s delay)
    // or 12 (real-time).
    freeServiceLevelId: 1,
  },
  devnet: {
    rpcUrl: "https://api.devnet.solana.com",
    apiOrigin: "https://txline-dev.txodds.com",
    programId: new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"),
    txlTokenMint: new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG"),
    // "Devnet currently documents service level 1; check the on-chain
    // pricing matrix before using any other devnet row." — World Cup guide.
    freeServiceLevelId: 1,
  },
};

export function txlineConfig(network = TXLINE_NETWORK) {
  const cfg = TXLINE_CONFIG[network];
  if (!cfg) throw new Error(`Unknown TxLINE network "${network}"`);
  return { ...cfg, apiBaseUrl: `${cfg.apiOrigin}/api` };
}

// Subscriptions are sold in 4-week blocks (on-chain error InvalidWeeks:
// "Weeks must be a multiple of 4"). The World Cup guide re-subscribes for
// 4 weeks at a time.
export const TXLINE_SUBSCRIPTION_WEEKS = 4;
export const TXLINE_SELECTED_LEAGUES = []; // [] = standard free bundle.

export function dailyScoresRootsPda(epochDay, programId) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(epochDay, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), buf],
    programId
  );
}
