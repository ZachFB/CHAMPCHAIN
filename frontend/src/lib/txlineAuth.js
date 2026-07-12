// TxLINE guest activation flow.
//
// This is a line-for-line port of the official TxODDS documentation at
// https://txline.txodds.com/documentation/worldcup ("Getting Started" ->
// Steps 1-3), adapted to a wallet-adapter `WalletContextState` instead of a
// local Anchor keypair. Nothing here is simulated: on devnet, calling
// `runTxlineActivation` performs a real `subscribe` transaction against the
// live TxLINE program (6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J) and a
// real HTTP round-trip to txline-dev.txodds.com.
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import txoracleIdl from "../idl/txoracle.json";
import {
  txlineConfig,
  TXLINE_SUBSCRIPTION_WEEKS,
  TXLINE_SELECTED_LEAGUES,
} from "./txlineConfig.js";

const STORAGE_PREFIX = "champchain:txline";

function storageKey(network, pubkeyBase58) {
  return `${STORAGE_PREFIX}:${network}:${pubkeyBase58}`;
}

/** Read a previously-activated grant for this wallet, if it hasn't expired. */
export function loadPersistedGrant(network, pubkeyBase58) {
  try {
    const raw = window.localStorage.getItem(storageKey(network, pubkeyBase58));
    if (!raw) return null;
    const grant = JSON.parse(raw);
    if (!grant?.expiresAt || grant.expiresAt < Date.now()) return null;
    return grant;
  } catch (_) {
    return null;
  }
}

function persistGrant(network, pubkeyBase58, grant) {
  try {
    window.localStorage.setItem(storageKey(network, pubkeyBase58), JSON.stringify(grant));
  } catch (_) {
    // Storage can fail (private browsing, quota). Non-fatal: the session
    // still works, it just re-activates on next reload.
  }
}

export function clearPersistedGrant(network, pubkeyBase58) {
  try {
    window.localStorage.removeItem(storageKey(network, pubkeyBase58));
  } catch (_) {}
}

/** Builds an anchor.Program bound to the real, fetched TxLINE IDL. */
export function getTxlineProgram(provider, network) {
  const { programId } = txlineConfig(network);
  const program = new anchor.Program(txoracleIdl, provider);
  if (!program.programId.equals(programId)) {
    throw new Error(
      `Loaded TxLINE IDL program ${program.programId.toBase58()} does not match ${network} program ${programId.toBase58()}`
    );
  }
  return program;
}

export function getTxlineProvider(wallet) {
  const { rpcUrl } = txlineConfig();
  return new anchor.AnchorProvider(new Connection(rpcUrl, "confirmed"), wallet, {
    commitment: "confirmed",
  });
}

/** Step 2 of the guide: subscribe() on-chain to the free World Cup tier. */
export async function subscribeOnChain({ program, userPubkey, network }) {
  const { programId, txlTokenMint, freeServiceLevelId } = txlineConfig(network);

  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    programId
  );
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    txlTokenMint,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    programId
  );
  const userTokenAccount = getAssociatedTokenAddressSync(
    txlTokenMint,
    userPubkey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const txSig = await program.methods
    .subscribe(freeServiceLevelId, TXLINE_SUBSCRIPTION_WEEKS)
    .accounts({
      user: userPubkey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: txlTokenMint,
      userTokenAccount,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return txSig;
}

/** Step 3a: get a short-lived guest JWT. */
export async function guestAuthStart(apiOrigin) {
  const res = await fetch(`${apiOrigin}/auth/guest/start`, { method: "POST" });
  if (!res.ok) throw new Error(`/auth/guest/start failed: ${res.status}`);
  // Same plain-text-vs-JSON situation as /api/token/activate — TxLINE may
  // return the JWT as a bare string rather than {"token": "..."}. Try JSON
  // first, fall back to the raw body as the token itself.
  const rawText = await res.text();
  let jwt;
  try {
    const body = JSON.parse(rawText);
    jwt = body.token ?? body.jwt ?? body;
  } catch (_) {
    jwt = rawText.trim();
  }
  if (typeof jwt !== "string" || jwt.length === 0) {
    throw new Error(`Unexpected /auth/guest/start response: ${rawText.slice(0, 200)}`);
  }
  return jwt;
}

/**
 * Step 3b: sign `${txSig}:${leagues.join(",")}:${jwt}` with the connected
 * wallet. Uses wallet-adapter's `signMessage` (Phantom, Solflare, Backpack
 * all support it) — this is the browser-safe path, no local keypair needed.
 */
export async function signActivationMessage(wallet, message) {
  if (typeof wallet?.signMessage !== "function") {
    throw new Error(
      "Connected wallet does not support signMessage(). TxLINE activation requires a wallet capable of signing an off-chain message."
    );
  }
  return wallet.signMessage(message);
}

/** Step 3c: exchange the signed message + txSig for an activated API token. */
export async function activateApiToken({ apiOrigin, jwt, txSig, walletSignature, leagues }) {
  const res = await fetch(`${apiOrigin}/api/token/activate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ txSig, walletSignature, leagues }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`/api/token/activate failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  // TxLINE's real /api/token/activate returns the token as plain text
  // (e.g. "txoracle_api_5087b98fd70647c893d5cb1d"), not JSON-wrapped like
  // {"token": "..."} — parse JSON if it happens to be sent that way, but
  // fall back to treating the raw body as the token itself, since that's
  // what the live API actually does.
  const rawText = await res.text();
  let apiToken;
  try {
    const body = JSON.parse(rawText);
    apiToken = body.token ?? body.apiToken ?? body;
  } catch (_) {
    apiToken = rawText.trim();
  }
  if (typeof apiToken !== "string" || apiToken.length === 0) {
    throw new Error(`Unexpected /api/token/activate response: ${rawText.slice(0, 200)}`);
  }
  return apiToken;
}

/**
 * Full orchestration of Steps 1-3 from the World Cup Free Tier guide.
 * `onStatus` is called with a short machine-readable status string so a
 * hook/UI can show progress instead of a single opaque spinner.
 */
export async function runTxlineActivation({ wallet, network, onStatus = () => {} }) {
  if (!wallet?.publicKey) throw new Error("Connect your wallet first.");
  const { apiOrigin } = txlineConfig(network);
  const provider = getTxlineProvider(wallet);
  const program = getTxlineProgram(provider, network);

  onStatus("subscribing");
  const txSig = await subscribeOnChain({ program, userPubkey: wallet.publicKey, network });

  onStatus("authenticating");
  const jwt = await guestAuthStart(apiOrigin);

  onStatus("awaiting-signature");
  const messageString = `${txSig}:${TXLINE_SELECTED_LEAGUES.join(",")}:${jwt}`;
  const signatureBytes = await signActivationMessage(wallet, new TextEncoder().encode(messageString));
  const walletSignature = btoa(String.fromCharCode(...signatureBytes));

  onStatus("activating");
  const apiToken = await activateApiToken({
    apiOrigin,
    jwt,
    txSig,
    walletSignature,
    leagues: TXLINE_SELECTED_LEAGUES,
  });

  const grant = {
    jwt,
    apiToken,
    txSig,
    activatedAt: Date.now(),
    expiresAt: Date.now() + TXLINE_SUBSCRIPTION_WEEKS * 7 * 24 * 60 * 60 * 1000,
  };
  persistGrant(network, wallet.publicKey.toBase58(), grant);
  onStatus("ready");
  return grant;
}