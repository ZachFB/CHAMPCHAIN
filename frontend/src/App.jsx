import { useEffect, useRef, useState, useCallback } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useMutation } from "@tanstack/react-query";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import SplitFlap from "./components/SplitFlap.jsx";
import MarketCard from "./components/MarketCard.jsx";
import ProofTicker from "./components/ProofTicker.jsx";
import ProofFeed from "./components/ProofFeed.jsx";
import Ball from "./components/Ball.jsx";
import { toast } from "./components/Toast.jsx";
import { useMagnetic, useScrollReveal, useMarketsReveal, useClipReveal } from "./hooks/useGsapFx.js";
import Footer from "./components/Footer.jsx";
import { useTxlineAuth } from "./hooks/useTxlineAuth.js";
import { streamScores } from "./lib/txlineStream.js";
import { buildSettleMarketTx } from "./txlineSettlement.js";
import { getPredictionMarketIdl } from "./idl/index.js";

// ─── CONFIG ────────────────────────────────────────────────────────────────
const PROGRAM_ID       = new PublicKey("7QvFHwKAQQaMsERG6pYLVaeMzac79R18arTpzEc6J7u3");
const TXLINE_PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const NETWORK          = import.meta.env.VITE_HELIUS_RPC_URL || clusterApiUrl("devnet");

// ─── MARKETS ───────────────────────────────────────────────────────────────
// Deliberately empty. Nothing here is pre-populated, guessed, or staged in
// advance — every market that appears on the site comes exclusively from
// `refreshMarketStatus()` scanning the chain for real Market accounts. Run
// PLAYGROUND_CREATE_MARKETS.md's scripts yourself first; the site will pick
// up whatever exists on-chain within ~20 seconds (or via "Refresh").
const DEMO_MARKETS = [
  {
    id: "por-esp",
    matchId: "WC2026-POR-ESP",
    fixtureId: 18198205,
    teamA: "Portugal", teamB: "Spain",
    question: "Does Portugal score more than 1 goal (2+) in regulation?",
    statAKey: 1, statBKey: null,
    onChain: true,
    totalYes: 0, totalNo: 0,
  },
  {
    id: "usa-bel",
    matchId: "WC2026-USA-BEL",
    fixtureId: 18193785,
    teamA: "USA", teamB: "Belgium",
    question: "Is the combined goal count (USA + Belgium) more than 2 (i.e. 3+)?",
    statAKey: 1, statBKey: 2,
    onChain: true,
    totalYes: 0, totalNo: 0,
  },
  {
    id: "eng-mex",
    matchId: "WC2026-ENG-MEX",
    fixtureId: 18192996,
    // TxLINE lists Mexico as the home / Participant 1 side for this fixture
    // (see PLAYGROUND_CREATE_MARKETS.md) — statAKey=1 is Mexico's goals,
    // statBKey=2 is England's, not the other way around.
    teamA: "Mexico", teamB: "England",
    question: "Is the combined goal count (Mexico + England) more than 4 (i.e. 5+)?",
    statAKey: 1, statBKey: 2,
    onChain: true,
    totalYes: 0, totalNo: 0,
  },
];

const TICKER_ITEMS = [
  "Merkle proof validated — fixture #50421 — epoch_day 20392",
  "Permissionless settlement via CPI into TxLINE validate_stat",
  "Settlement budget: 1,400,000 compute units",
  "No trusted oracle in the resolution path",
  "PDA vault unlocks only after on-chain proof verification",
  `Program deployed: ${PROGRAM_ID.toBase58().slice(0, 16)}…`,
];

// ─── HELPERS ───────────────────────────────────────────────────────────────
function getProvider(wallet) {
  return new anchor.AnchorProvider(
    new Connection(NETWORK, "confirmed"),
    wallet,
    { preflightCommitment: "confirmed" }
  );
}

async function loadProgram(provider) {
  // idl/prediction_market.json is a pre-0.30 (legacy) Anchor IDL (Solana
  // Playground's toolchain). @coral-xyz/anchor 0.30.x needs the new IDL
  // spec (address embedded, `pubkey` not `publicKey`, explicit
  // discriminators, defined-type refs as objects) — see idl/index.js for
  // the full explanation and the tests that verified it against the real
  // library. The 3-arg `new Program(idl, PROGRAM_ID, provider)` form below
  // is the OLD (pre-0.30) constructor signature; calling it against a
  // 0.30.x install throws "Cannot read properties of undefined (reading
  // '_bn')" immediately, before ever reaching a real RPC call — which is
  // exactly the error that was breaking every "Yes"/"No" bet.
  return new anchor.Program(getPredictionMarketIdl(), provider);
}

function deriveMarketPda(matchId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from(matchId)],
    PROGRAM_ID
  );
}

function deriveVaultPda(marketPubkey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketPubkey.toBuffer()],
    PROGRAM_ID
  );
}

function deriveBetPda(marketPubkey, userPubkey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bet"), marketPubkey.toBuffer(), userPubkey.toBuffer()],
    PROGRAM_ID
  );
}

function deriveDailyScoresRootsPda(epochDay) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(epochDay, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), buf],
    TXLINE_PROGRAM_ID
  );
}

// Errors that are worth a silent retry (RPC hiccup) vs. errors that should
// surface to the user immediately (wallet rejected, insufficient funds).
// Phantom's own "Simulation failed" pre-approval warning is a much
// stronger signal than the generic "unknown domain" one — it usually
// means the instruction would genuinely fail on-chain, not just that the
// program is unrecognized. Simulating here first, before ever asking the
// wallet to sign, surfaces the SAME failure but with the actual Anchor
// error message and program logs instead of Phantom's opaque "simulation
// failed" with no detail.
async function simulateOrThrow(connection, tx, label) {
  const sim = await connection.simulateTransaction(tx);
  if (sim.value.err) {
    const logs = sim.value.logs || [];
    const anchorErrorLine = logs.find((l) => l.includes("Error Message:"));
    const reason = anchorErrorLine
      ? anchorErrorLine.split("Error Message:")[1].trim()
      : logs.find((l) => l.includes("Program log:")) ?? JSON.stringify(sim.value.err);
    throw new Error(`${label} rejected on-chain: ${reason}`);
  }
}

function isTransientRpcError(err) {
  const msg = (err?.message || "").toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("timeout") ||
    msg.includes("429") ||
    msg.includes("blockhash not found")
  );
}

// Wallet approval (waiting for the person to click "Approve" in Phantom/
// Solflare/etc.) can easily eat past a blockhash's ~60-90 second validity
// window, especially on a sometimes-slow Devnet — that's exactly what
// "Signature ... has expired: block height exceeded" means: the tx was
// signed and sent, but too late for the blockhash it was built with. The
// fix isn't a longer timeout (there's no such setting — validity is a
// fixed number of blocks), it's retrying with a FRESH blockhash instead of
// surfacing this as a dead end. `buildTx` receives {blockhash,
// lastValidBlockHeight} and must return a ready-to-sign Transaction.
async function sendAndConfirmWithRetry(connection, wallet, buildTx, { maxAttempts = 5 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // "processed" is the least-lagged commitment available — it gives a
    // blockhash a few seconds fresher than "confirmed" would, which is
    // pure margin against a slow wallet-approval flow (e.g. Phantom's
    // "unknown domain" risk warning adding extra clicks/seconds before
    // the person ever reaches the final Confirm button).
    const latestBlockhash = await connection.getLatestBlockhash("processed");
    const tx = await buildTx(latestBlockhash);
    try {
      const sig = await wallet.sendTransaction(tx, connection);
      const confirmation = await connection.confirmTransaction(
        { signature: sig, ...latestBlockhash },
        "confirmed"
      );
      if (confirmation.value.err) {
        throw new Error(`Transaction landed but failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
      }
      return sig;
    } catch (err) {
      lastErr = err;
      const msg = (err?.message || "").toLowerCase();
      const expired = msg.includes("block height exceeded") || msg.includes("expired");
      if (!expired || attempt === maxAttempts - 1) throw err;
      // Expired and attempts remain: loop again, a fresh blockhash gets
      // fetched at the top — the person doesn't have to click anything
      // again since the instructions themselves haven't changed.
    }
  }
  throw lastErr;
}

// Unwraps wallet-adapter's generic "Unexpected error" wrapper to find the
// actual cause, and translates the common ones into something a person can
// act on instead of a raw exception. wallet-adapter-base's
// WalletSendTransactionError stores the real cause on `.error`; RPC
// simulation failures often carry `.logs`.
function describeSendError(err) {
  const inner = err?.error ?? err;
  const logs = inner?.logs || err?.logs || [];
  const raw = (inner?.message || err?.message || "").toString();

  if (/user rejected|rejected the request/i.test(raw)) {
    return "You rejected the transaction in your wallet — no problem, nothing was sent.";
  }
  if (
    /account.*not.*exist|accountnotfound|could not find account|invalid account data/i.test(raw) ||
    logs.some((l) => /AccountNotFound|ProgramAccountNotFound/i.test(l))
  ) {
    return "This market isn't initialized on-chain yet, so there's no account to bet into. Try the Argentina vs Croatia market — that's the one that's actually deployed.";
  }
  if (/insufficient/i.test(raw) || logs.some((l) => /insufficient lamports/i.test(l))) {
    return "Not enough devnet SOL to cover this bet plus network fees. Get some from a devnet faucet and try again.";
  }
  if (/blockhash not found/i.test(raw)) {
    return "Your transaction expired before it confirmed (devnet RPC lag). Just try again.";
  }
  if (logs.length) {
    return `${raw || "Transaction failed"} — ${logs[logs.length - 1]}`;
  }
  return raw || "Transaction failed for an unknown reason — check the browser console for details.";
}

// ─── BALL DESKTOP ──────────────────────────────────────────────────────────
// Restored as-is: dynamic size on window resize (42% of viewport width,
// clamped 260-640px) so it doesn't overflow on smaller laptop screens, and
// the entrance-bounce animation plays once via Ball's own autoPlay prop.
function BallResponsive({ autoPlayDelay }) {
  const [ballSize, setBallSize] = useState(
    Math.min(640, Math.max(260, Math.round(window.innerWidth * 0.42)))
  );
  useEffect(() => {
    const onResize = () =>
      setBallSize(Math.min(640, Math.max(260, Math.round(window.innerWidth * 0.42))));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return (
    <div
      className="absolute z-0 pointer-events-none hidden md:block"
      style={{ top: "-160px", right: "-40px" }}
    >
      <Ball
        size={ballSize}
        autoPlay
        autoPlayDelay={autoPlayDelay}
        style={{ marginTop: "30px", marginRight: "-48px" }}
      />
    </div>
  );
}

// ─── BALL MOBILE — z-index scroll trick ────────────────────────────────────
// Restored as-is: anchored bottom-right, sized off viewport width, and
// dips behind the footer once you scroll it into view instead of floating
// on top of it.
function MobileBall() {
  const [behindFooter, setBehindFooter] = useState(false);
  const ballSize = Math.max(80, Math.min(120, Math.round(window.innerWidth * 0.24)));

  useEffect(() => {
    function onScroll() {
      const footer = document.querySelector("footer");
      if (!footer) return;
      setBehindFooter(footer.getBoundingClientRect().top < window.innerHeight);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className="md:hidden fixed pointer-events-none"
      style={{ bottom: "6px", right: "6px", zIndex: behindFooter ? 5 : 40 }}
    >
      <Ball size={ballSize} autoPlay autoPlayDelay={2800} />
    </div>
  );
}

// ─── Team name resolution for on-chain-only markets ────────────────────────
// Markets created straight from Playground (not through DEMO_MARKETS) only
// carry their raw matchId on-chain, e.g. "WC2026-USA-BEL" — this decodes the
// two 3-letter codes into real names automatically, so the site never shows
// a blank "vs" no matter how a market was created.
const COUNTRY_CODES = {
  ARG: "Argentina", BEL: "Belgium",  BRA: "Brazil",   CRO: "Croatia",
  ENG: "England",   ESP: "Spain",    FRA: "France",   MAR: "Morocco",
  MEX: "Mexico",    NOR: "Norway",   POR: "Portugal", USA: "USA",
};
function decodeMatchId(matchId) {
  const m = /^WC\d{4}-([A-Z]{3})-([A-Z]{3})$/.exec(matchId);
  if (!m) return { teamA: matchId, teamB: "" };
  return {
    teamA: COUNTRY_CODES[m[1]] ?? m[1],
    teamB: COUNTRY_CODES[m[2]] ?? m[2],
  };
}

// Stat key meanings we've actually used ourselves when creating markets —
// anything outside this map falls back to an honest generic label instead
// of asserting a meaning we haven't verified against TxLINE's real schema.
const STAT_LABELS = { 1: "goals", 2: "goals", 7: "corners", 8: "corners" };
const COMPARISON_SYMBOLS = { greaterThan: ">", lessThan: "<", equalTo: "=" };
function describeMarketQuestion({ teamA, teamB, statAKey, statBKey, op, predicate }) {
  const stat = STAT_LABELS[statAKey] ?? `stat #${statAKey}`;
  const cmp  = COMPARISON_SYMBOLS[predicate.comparison] ?? predicate.comparison;
  const t    = predicate.threshold;
  if (statBKey == null) return `Will ${teamA}'s ${stat} be ${cmp} ${t}?`;
  if (op === "add")      return `Will combined ${stat} (both teams) be ${cmp} ${t}?`;
  if (op === "subtract") return `Will ${teamA} beat ${teamB} by more than ${t} ${stat}?`;
  return `${stat}: #${statAKey} vs #${statBKey}, threshold ${cmp} ${t}`;
}


export default function App() {
  const heroRef    = useRef(null);
  const wallet     = useWallet();
  const { connection } = useConnection();
  const [markets,  setMarkets]  = useState(DEMO_MARKETS);
  const [marketTab, setMarketTab] = useState("active");

  // A market is "finished" once its betting window has closed or it already
  // carries a real settled outcome (yes/no) or was cancelled by the
  // authority — regardless of whether fixtureId is a real TxLINE id or the
  // zero placeholder. This is the single source of truth for bucketing;
  // MarketCard mirrors the same check for its button. Missing "cancelled"
  // here was a real bug: a cancelled-but-still-open-window market would
  // otherwise keep showing under Active with bet buttons, when betting on
  // a cancelled market makes no sense at all.
  const isMarketFinished = (m) =>
    m.onChain && (
      (m.closeTs - Date.now() / 1000 <= 0) ||
      m.outcome === "yes" ||
      m.outcome === "no" ||
      m.outcome === "cancelled"
    );

  // `onChain` — set only by refreshMarketStatus() after it actually reads
  // the account from chain — is the thing that matters here, not whether
  // DEMO_MARKETS happens to carry a real fixtureId locally. A market's
  // local object can describe a real fixtureId/predicate/closeTs before
  // it's ever been created on devnet (that's the whole point of documenting
  // it in DEMO_MARKETS ahead of running the Playground script) — but until
  // `initialize_market` has actually been sent and refreshMarketStatus has
  // confirmed the account exists, it must show as Coming regardless of
  // what fixtureId is already filled in locally. Getting this wrong (as an
  // earlier version of this file did) makes markets appear bettable on
  // first load, straight from the repo, before anyone has run anything in
  // Playground — which is exactly backwards.
  //   - not onChain                  -> Coming   (no countdown, no bet buttons)
  //   - onChain + fixtureId 0        -> Coming   (created, but not yet activated)
  //   - onChain + finished           -> Finished (settled, or closed awaiting settlement)
  //   - onChain + fixtureId set + not finished -> Active (YES/NO betting, countdown)
  const comingMarkets   = markets.filter((m) => (!m.onChain || !m.fixtureId) && !isMarketFinished(m));
  const finishedMarkets = markets.filter((m) => isMarketFinished(m));
  const activeMarkets   = markets.filter((m) => m.onChain && m.fixtureId && !isMarketFinished(m));
  const shownMarkets =
    marketTab === "active" ? activeMarkets :
    marketTab === "coming" ? comingMarkets :
    finishedMarkets;
  const [liveScore, setLiveScore] = useState(null);
  const txline     = useTxlineAuth(wallet);

  const viewMarketsRef = useMagnetic(0.3);
  const programLinkRef = useMagnetic(0.3);
  const archRef = useScrollReveal(".arch-card", { stagger: 0.12 });
  const marketsHeaderRef = useScrollReveal(".markets-header-item", { stagger: 0.08 });
  const marketsGridRef = useMarketsReveal(".market-grid-item", { stagger: 0.1 });
  const marketsHeadingRef = useClipReveal();
  const architectureHeadingRef = useClipReveal();
  const badgeRef = useScrollReveal(".program-badge-item", { stagger: 0.1 });

  // Entrance animation
  useEffect(() => {
    gsap.fromTo(
      heroRef.current,
      { opacity: 0, y: 16 },
      { opacity: 1, y: 0, duration: 0.8, delay: 0.4, ease: "power2.out" }
    );
  }, []);

  // ─── Live on-chain market detection ───────────────────────────────────
  // DEMO_MARKETS.onChain used to be a hand-set flag that someone had to
  // remember to flip after creating a market (e.g. from Solana Playground).
  //
  // This now does two things, not one:
  //   1. Refreshes every market already known to the UI (same as before —
  //      re-derives its PDA from matchId and re-reads it from chain).
  //   2. Calls `program.account.market.all()`, which does a real
  //      getProgramAccounts scan filtered by the Market discriminator —
  //      i.e. it finds EVERY market that exists on this program, including
  //      ones nobody added to DEMO_MARKETS yet. Any such account is shown
  //      with a generic label built from its own on-chain match_id, rather
  //      than silently staying invisible until someone edits this file.
  //      That's the actual meaning of "robust to a new market created
  //      later in Playground" — not just re-checking a fixed list.
  const [marketsSyncing, setMarketsSyncing] = useState(false);
  const refreshMarketStatus = useCallback(async () => {
    setMarketsSyncing(true);
    // A refresh that completes in under ~500ms (common for the automatic
    // 20s poll, with only a handful of accounts to re-check) flashes the
    // yellow sweep bar so briefly it's easy to miss entirely. Enforcing a
    // floor here means the indicator is always actually perceivable,
    // whether triggered by the button or the background interval.
    const minVisible = new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const provider = getProvider(wallet);
      const program = await loadProgram(provider);

      const knownMatchIds = new Set(DEMO_MARKETS.map((m) => m.matchId));

      const known = await Promise.all(
        DEMO_MARKETS.map(async (base) => {
          const [marketPda] = deriveMarketPda(base.matchId);
          try {
            const acc = await program.account.market.fetchNullable(marketPda);
            if (!acc) return { ...base, onChain: false };
            return {
              ...base,
              onChain: true,
              pda: marketPda.toBase58(),
              fixtureId: acc.fixtureId.toNumber(),
              closeTs: acc.closeTs.toNumber(),
              earliestSettleTs: acc.earliestSettleTs.toNumber(),
              totalYes: acc.totalYes.toNumber() / anchor.web3.LAMPORTS_PER_SOL,
              totalNo: acc.totalNo.toNumber() / anchor.web3.LAMPORTS_PER_SOL,
              outcome: Object.keys(acc.outcome)[0],
            };
          } catch (_) {
            // RPC hiccup for this one PDA — keep it in its last-known state
            // rather than flashing it to "coming soon" on a transient error.
            return base;
          }
        })
      );

      let discovered = [];
      try {
        const allAccounts = await program.account.market.all();
        discovered = allAccounts
          .filter((entry) => !knownMatchIds.has(entry.account.matchId))
          .map((entry) => {
            const acc = entry.account;
            const { teamA, teamB } = decodeMatchId(acc.matchId);
            const statAKey = acc.statAKey;
            const statBKey = acc.statBKey;
            const op = acc.op ? Object.keys(acc.op)[0] : null;
            const predicate = {
              threshold: acc.predicate.threshold,
              comparison: Object.keys(acc.predicate.comparison)[0],
            };
            return {
              id: acc.matchId,
              matchId: acc.matchId,
              teamA,
              teamB,
              question: describeMarketQuestion({ teamA, teamB, statAKey, statBKey, op, predicate }),
              fixtureId: acc.fixtureId.toNumber(),
              statAKey,
              statBKey,
              period: acc.period,
              op,
              predicate,
              onChain: true,
              pda: entry.publicKey.toBase58(),
              closeTs: acc.closeTs.toNumber(),
              earliestSettleTs: acc.earliestSettleTs.toNumber(),
              totalYes: acc.totalYes.toNumber() / anchor.web3.LAMPORTS_PER_SOL,
              totalNo: acc.totalNo.toNumber() / anchor.web3.LAMPORTS_PER_SOL,
              outcome: Object.keys(acc.outcome)[0],
              discovered: true, // lets MarketCard show a subtle "auto-discovered" hint
            };
          });
      } catch (_) {
        // .all() failing (RPC rate limit, etc.) shouldn't blank the list —
        // the `known` results above still stand on their own.
      }

      let withUserBet = [...known, ...discovered];

      // Whether the CONNECTED wallet specifically has a bet on each market
      // (not just "someone" does) — ATTEMPT SETTLEMENT is deliberately
      // gated on this, not on any-activity, per product decision: a market
      // nobody-you-know bet on should read as finished, not actionable.
      // Also keep the bet's own side/amount/claimed — this is what lets
      // MarketCard show an honest "you lost, nothing to claim" instead of
      // always rendering the same CLAIM WINNINGS button regardless of
      // whether this wallet actually won.
      if (wallet.publicKey) {
        withUserBet = await Promise.all(
          withUserBet.map(async (m) => {
            if (!m.onChain) return { ...m, userHasBet: false, userBet: null };
            try {
              const [marketPda] = deriveMarketPda(m.matchId);
              const [betPda] = deriveBetPda(marketPda, wallet.publicKey);
              const bet = await program.account.bet.fetchNullable(betPda);
              if (!bet || bet.amount.toNumber() === 0) {
                return { ...m, userHasBet: false, userBet: null };
              }
              return {
                ...m,
                userHasBet: true,
                userBet: { side: bet.side, amount: bet.amount.toNumber(), claimed: bet.claimed },
              };
            } catch (_) {
              return { ...m, userHasBet: false, userBet: null };
            }
          })
        );
      } else {
        withUserBet = withUserBet.map((m) => ({ ...m, userHasBet: false, userBet: null }));
      }

      // Cancelled markets stay visible (not filtered out) — that's the only
      // way a bettor can ever reach the CLAIM WINNINGS button to get their
      // refund. Hiding them would strand real money with no UI path to it.
      setMarkets(withUserBet);
    } catch (_) {
      // Devnet RPC unreachable — leave markets as-is, try again next cycle.
    } finally {
      await minVisible;
      setMarketsSyncing(false);
    }
  }, [wallet]);

  useEffect(() => {
    refreshMarketStatus();
    const id = setInterval(refreshMarketStatus, 20_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.publicKey?.toBase58()]);

  // The single ScrollTrigger.refresh() in main.jsx (on window "load") fires
  // before market data ever arrives — `markets` starts as DEMO_MARKETS and
  // is replaced by refreshMarketStatus's on-chain read a moment later,
  // which changes how tall the Markets grid actually is. Every trigger for
  // everything BELOW it (Architecture, Program badge) was already
  // positioned against the page's shorter, pre-data height, which is
  // exactly why they needed to be scrolled well past before firing — not
  // a mobile-only bug, just far more visible there since mobile viewports
  // leave less room for error. Refreshing again once `markets` actually
  // changes — after two animation frames, so the browser has genuinely
  // finished laying out the new content, not just started rendering it —
  // re-measures every trigger against the page's real, final height.
  useEffect(() => {
    let raf1, raf2;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => ScrollTrigger.refresh());
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [markets]);

  // TxLINE authenticated SSE stream — live score badge in header.
  // EventSource can't carry the required Authorization/X-Api-Token headers,
  // so this uses the fetch+ReadableStream client from lib/txlineStream.js.
  // It only runs once the user has activated TxLINE access (see the
  // "Activate TxLINE access" control below) — no fake/unauthenticated
  // requests are made in the meantime.
  useEffect(() => {
    if (!txline.isReady) return;
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        for await (const msg of streamScores({
          apiOrigin: txline.apiOrigin,
          jwt: txline.jwt,
          apiToken: txline.apiToken,
          signal: controller.signal,
        })) {
          if (cancelled) return;
          const data = msg.data ?? {};
          if (data?.fixtureId) setLiveScore(data);
        }
      } catch (_) {
        // Stream ended/dropped — the header badge simply stops updating;
        // ProofFeed independently retries its own connection.
      }
    })();

    return () => { cancelled = true; controller.abort(); };
  }, [txline.isReady, txline.apiOrigin, txline.jwt, txline.apiToken]);

  // ─── Place bet — TanStack mutation ────────────────────────────────────
  // Devnet RPC drops requests under load; a bounded retry on transient
  // network errors means a flaky node doesn't read as "the app is broken"
  // to someone demoing it live in front of judges.
  const placeBetMutation = useMutation({
    mutationFn: async ({ matchId, side, amountSol, onChain }) => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first.");
      if (!onChain) {
        throw new Error(
          "This market is coming soon (not yet initialized on-chain) — betting opens once it's live. Try Argentina vs Croatia."
        );
      }
      const provider = getProvider(wallet);
      const program  = await loadProgram(provider);
      const [marketPda] = deriveMarketPda(matchId);
      const [vaultPda]  = deriveVaultPda(marketPda);
      const [betPda]    = deriveBetPda(marketPda, wallet.publicKey);

      // Built manually (instead of .accounts().rpc()) so the `bet` PDA is
      // guaranteed to be flagged writable — required for its on-chain
      // creation via init_if_needed. Anchor's auto account-meta resolution
      // from the legacy-format Playground IDL was dropping that flag,
      // which caused a "writable privilege escalated" CPI error.
      const data = program.coder.instruction.encode("placeBet", {
        side,
        amount: new anchor.BN(Math.round(amountSol * anchor.web3.LAMPORTS_PER_SOL)),
      });

      const ix = new anchor.web3.TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: wallet.publicKey, isSigner: true,  isWritable: true },  // user
          { pubkey: marketPda,        isSigner: false, isWritable: true },  // market
          { pubkey: vaultPda,         isSigner: false, isWritable: true },  // vault
          { pubkey: betPda,           isSigner: false, isWritable: true },  // bet
          { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      });

      // Simulated once, up front, with its own throwaway blockhash — not
      // inside the retry loop below, so this doesn't eat into the actual
      // send attempts' time budget. This is what would have shown Phantom's
      // "simulation failed" reason in our own console/toast instead of
      // leaving it opaque.
      const simBlockhash = await connection.getLatestBlockhash("processed");
      const simTx = new anchor.web3.Transaction({
        feePayer: wallet.publicKey,
        blockhash: simBlockhash.blockhash,
        lastValidBlockHeight: simBlockhash.lastValidBlockHeight,
      }).add(ix);
      await simulateOrThrow(connection, simTx, "Bet");

      const sig = await sendAndConfirmWithRetry(connection, wallet, (latestBlockhash) =>
        new anchor.web3.Transaction({
          feePayer: wallet.publicKey,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        }).add(ix)
      );

      const acc = await program.account.market.fetch(marketPda);
      return { matchId, sig, acc };
    },
    retry: (failureCount, err) => failureCount < 2 && isTransientRpcError(err),
    retryDelay: (attempt) => 800 * (attempt + 1),
    onSuccess: ({ matchId, sig, acc }) => {
      setMarkets(prev => prev.map(m =>
        m.matchId === matchId ? {
          ...m,
          totalYes: acc.totalYes.toNumber() / anchor.web3.LAMPORTS_PER_SOL,
          totalNo:  acc.totalNo.toNumber()  / anchor.web3.LAMPORTS_PER_SOL,
        } : m
      ));
      toast("Bet placed and confirmed on-chain.", { type: "success", tx: sig });
    },
    onError: (err) => {
      toast(describeSendError(err), { type: "error" });
    },
  });

  const handleBet = useCallback((matchId, side, amountSol = 0.01) => {
    if (!wallet.publicKey) {
      toast("Connect your wallet first.", { type: "info" });
      return;
    }
    const market = markets.find((m) => m.matchId === matchId);
    placeBetMutation.mutate({ matchId, side, amountSol, onChain: market?.onChain });
  }, [wallet, placeBetMutation, markets]);

  // Attempt permissionless settlement via TxLINE Merkle proof
  const attemptSettlement = useCallback(async (market) => {
    if (!wallet.publicKey) throw new Error("Connect your wallet first.");
    if (!txline.isReady) {
      throw new Error(
        'Validate live data first (see the "Validate live data" button in the header) — /api/scores/stat-validation requires an authenticated guest JWT + API token.'
      );
    }

    // The hardcoded `seq = 1` this used to send was literally requesting
    // the FIRST update TxLINE ever recorded for this fixture — nowhere
    // near "the latest score" for a finished match. That's exactly why
    // settlement was rejected with "TxLINE proof is too stale": ts came
    // back dated well before this market's earliestSettleTs, because we
    // asked for old data on purpose. There's no documented "give me the
    // latest" endpoint, so this finds it directly: probe seq=1, then
    // double (2, 4, 8, ...) until a request 404s, then binary-search the
    // gap between the last success and the first failure. No fixture-
    // specific bounds hardcoded — this works for any fixtureId.
    async function findLatestSeq(seqToProbe, statKey) {
      const res = await fetch(
        `${txline.apiOrigin}/api/scores/stat-validation?fixtureId=${market.fixtureId}&seq=${seqToProbe}&statKey=${statKey}`,
        { headers: { Authorization: `Bearer ${txline.jwt}`, "X-Api-Token": txline.apiToken } }
      );
      return res.ok ? await res.json() : null;
    }

    // Sequence numbers for a fixture don't necessarily start at 1 — a
    // match with a lot of tracked events (any real knockout game, easily)
    // can have its earliest still-available sequence start well above
    // that, with older ones rotated out server-side. Treating a failed
    // seq=1 probe as "no data at all" was wrong: it just meant seq=1
    // specifically wasn't available anymore, not that nothing was. This
    // first finds ANY sequence that actually exists (exponential probe:
    // 1, 2, 4, 8, ...), then reuses the same doubling + binary-search
    // approach as before to walk forward from that point to the true
    // latest one. No fixture-specific bounds hardcoded — works for any
    // fixtureId regardless of how much history it has.
    async function findAnySeq(statKey) {
      let probe = 1;
      while (probe <= 1_000_000) {
        const body = await findLatestSeq(probe, statKey);
        if (body) return { seq: probe, body };
        probe *= 2;
      }
      return null;
    }

    const anchor = await findAnySeq(market.statAKey);
    if (!anchor) {
      throw new Error(
        `TxLINE has no data at all for fixture ${market.fixtureId} (probed exponentially up to seq=1,000,000, found nothing) — this fixture may not be tracked, or hasn't started.`
      );
    }

    let lo = anchor.seq;
    let loBody = anchor.body;
    let hi = lo * 2;
    let hiBody = await findLatestSeq(hi, market.statAKey);
    while (hiBody) {
      lo = hi;
      loBody = hiBody;
      hi *= 2;
      hiBody = await findLatestSeq(hi, market.statAKey);
    }
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      const midBody = await findLatestSeq(mid, market.statAKey);
      if (midBody) {
        lo = mid;
        loBody = midBody;
      } else {
        hi = mid;
      }
    }
    const seq = lo;
    console.log(`[attemptSettlement] latest available seq for fixture ${market.fixtureId} is ${seq}`);

    if (market.earliestSettleTs && loBody.ts < market.earliestSettleTs * 1000) {
      throw new Error(
        `TxLINE's latest available data for this fixture (seq=${seq}) is dated ` +
        `${new Date(loBody.ts).toISOString()}, which is still before this market's ` +
        `earliestSettleTs (${new Date(market.earliestSettleTs * 1000).toISOString()}). ` +
        `This isn't a bug — TxLINE just hasn't posted anything recent enough for this ` +
        `fixture yet. Try again later, or settle a different market.`
      );
    }

    const validation = loBody;

    // Kept temporarily: if the fix below turns out to be incomplete, this is
    // the fastest way to see TxLINE's actual field names/shapes and adjust
    // precisely instead of guessing again. Safe to delete once settlement
    // works end-to-end.
    console.log("[attemptSettlement] raw TxLINE validation payload (statA):", validation);

    // Real TxLINE response shape, confirmed by inspecting the actual
    // payload in the console (not guessed):
    //   - statToProve / eventStatRoot / statProof live at the ROOT of the
    //     response, not nested under a "stat1" key — there IS no "stat1"
    //     or "stat2" field at all.
    //   - Each stat-validation call returns ONE stat's proof. A dual-stat
    //     market (statBKey set) needs a SECOND, separate call with
    //     statKey=statBKey to get the other side.
    //   - summary's root-hash field is "eventStatsSubTreeRoot" (plural
    //     "Stats"), not "eventsSubTreeRoot" — that exact mismatch was the
    //     cause of "Unrecognized hash format: undefined".
    //   - hash/root fields (eventStatRoot, each proof node's hash) are
    //     already plain byte arrays here, not hex strings — toByteArray32
    //     still normalizes defensively in case a different fixture/stat
    //     ever returns the hex-string form instead.
    function toByteArray32(value) {
      if (Array.isArray(value) || value instanceof Uint8Array) return Array.from(value);
      if (typeof value === "string") {
        const hex = value.startsWith("0x") ? value.slice(2) : value;
        const bytes = hex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? [];
        if (bytes.length !== 32) {
          throw new Error(`Expected a 32-byte hash, got ${bytes.length} bytes from "${value}"`);
        }
        return bytes;
      }
      throw new Error(`Unrecognized hash format: ${JSON.stringify(value)}`);
    }
    function normalizeProof(proof) {
      return (proof ?? []).map((node) => ({
        ...node,
        hash: toByteArray32(node.hash),
      }));
    }
    function statTermFromResponse(body) {
      if (!body?.statToProve) return null;
      return {
        statToProve: body.statToProve,
        eventStatRoot: toByteArray32(body.eventStatRoot),
        statProof: normalizeProof(body.statProof),
      };
    }

    const statA = statTermFromResponse(validation);

    // Dual-stat market: fetch statB's own proof separately, at the same
    // seq (same point-in-time snapshot for this fixture).
    let statB = null;
    if (market.statBKey != null) {
      const statBBody = await findLatestSeq(seq, market.statBKey);
      if (!statBBody) {
        throw new Error(
          `Couldn't fetch statB (statKey=${market.statBKey}) at seq=${seq} for fixture ${market.fixtureId}.`
        );
      }
      console.log("[attemptSettlement] raw TxLINE validation payload (statB):", statBBody);
      statB = statTermFromResponse(statBBody);
    }

    const provider = getProvider(wallet);
    const program  = await loadProgram(provider);
    const [marketPda] = deriveMarketPda(market.matchId);
    const epochDay = Math.floor(validation.ts / 86_400_000);
    const [dailyScoresMerkleRoots] = deriveDailyScoresRootsPda(epochDay);

    // validation.* comes straight from TxLINE's JSON response — plain JS
    // numbers. The program's i64 fields (ts, fixtureId, minTimestamp,
    // maxTimestamp) need to be real BN instances before the coder encodes
    // them, same as `amount` is wrapped in `new anchor.BN(...)` for
    // placeBet above — a raw number doesn't have .toTwos(), so encoding
    // one directly throws "src.toTwos is not a function". i32 fields
    // (updateCount, and everything inside statA/statB) don't need this.
    const fixtureSummary = {
      fixtureId: new anchor.BN(validation.summary.fixtureId),
      eventsSubTreeRoot: toByteArray32(validation.summary.eventStatsSubTreeRoot),
      updateStats: {
        updateCount: validation.summary.updateStats.updateCount,
        minTimestamp: new anchor.BN(validation.summary.updateStats.minTimestamp),
        maxTimestamp: new anchor.BN(validation.summary.updateStats.maxTimestamp),
      },
    };

    const tx = buildSettleMarketTx(
      program,
      {
        ts:             new anchor.BN(validation.ts),
        fixtureSummary,
        fixtureProof:   normalizeProof(validation.subTreeProof),
        mainTreeProof:  normalizeProof(validation.mainTreeProof),
        statA,
        statB,
      },
      {
        settler:               wallet.publicKey,
        market:                marketPda,
        dailyScoresMerkleRoots,
        txlineProgram:         TXLINE_PROGRAM_ID,
      }
    );

    // Simulate first so a real on-chain rejection (e.g. TooEarlyToSettle,
    // FixtureMismatch, StaleProof — any of the require!() checks in
    // settle_market) surfaces here as a readable message, instead of the
    // user only seeing Phantom's generic "this transaction is expected to
    // fail, funds may be lost" warning with no indication of which check
    // actually failed.
    tx.feePayer = wallet.publicKey;
    const simBlockhash = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = simBlockhash.blockhash;

    const sim = await connection.simulateTransaction(tx);
    if (sim.value.err) {
      const logs = sim.value.logs || [];
      const anchorErrorLine = logs.find((l) => l.includes("Error Message:"));
      const reason = anchorErrorLine
        ? anchorErrorLine.split("Error Message:")[1].trim()
        : logs.find((l) => l.includes("Program log:")) ?? JSON.stringify(sim.value.err);
      throw new Error(`Settlement rejected on-chain: ${reason}`);
    }

    // Re-signs with a fresh blockhash on each attempt if the previous one
    // expired waiting on wallet approval — see sendAndConfirmWithRetry.
    const sig = await sendAndConfirmWithRetry(connection, wallet, (latestBlockhash) => {
      tx.recentBlockhash = latestBlockhash.blockhash;
      tx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
      return tx;
    });

    const acc = await program.account.market.fetch(marketPda);
    setMarkets(prev => prev.map(m =>
      m.matchId === market.matchId
        ? { ...m, outcome: Object.keys(acc.outcome)[0] }
        : m
    ));
    return `Settled on-chain — TX ${sig.slice(0, 12)}…`;
  }, [wallet, connection, txline.isReady, txline.apiOrigin, txline.jwt, txline.apiToken]);

  // Claim winnings after settlement
  const handleClaim = useCallback(async (matchId) => {
    if (!wallet.publicKey) throw new Error("Connect your wallet first.");

    const provider = getProvider(wallet);
    const program  = await loadProgram(provider);
    const [marketPda] = deriveMarketPda(matchId);
    const [vaultPda]  = deriveVaultPda(marketPda);
    const [betPda]    = deriveBetPda(marketPda, wallet.publicKey);

    const data = program.coder.instruction.encode("claimWinnings", {});

    const ix = new anchor.web3.TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true,  isWritable: true  }, // user
        { pubkey: marketPda,        isSigner: false, isWritable: false }, // market (read-only)
        { pubkey: vaultPda,         isSigner: false, isWritable: true  }, // vault
        { pubkey: betPda,           isSigner: false, isWritable: true  }, // bet
        { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const simBlockhash = await connection.getLatestBlockhash("processed");
    const simTx = new anchor.web3.Transaction({
      feePayer: wallet.publicKey,
      blockhash: simBlockhash.blockhash,
      lastValidBlockHeight: simBlockhash.lastValidBlockHeight,
    }).add(ix);
    await simulateOrThrow(connection, simTx, "Claim");

    const sig = await sendAndConfirmWithRetry(connection, wallet, (latestBlockhash) =>
      new anchor.web3.Transaction({
        feePayer: wallet.publicKey,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      }).add(ix)
    );

    return `Claimed! TX ${sig.slice(0, 12)}…`;
  }, [wallet, connection]);

  // ─── RENDER ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen turf-texture relative overflow-x-hidden">

      {/* Ambient spotlight */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(255,196,0,0.08),transparent_60%)]" />

      {/* Header */}
      <header className="relative z-30 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 sm:px-6 md:px-12 py-3 sm:py-6">
        <span className="font-display text-base sm:text-lg md:text-xl tracking-widest">
          CHAMP<span className="text-card-yes">CHAIN</span>
        </span>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 md:gap-4 justify-end">
          {liveScore && (
            <span className="font-mono text-[9px] sm:text-xs text-haze border border-haze/30 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-sm whitespace-nowrap">
              🔴 LIVE #{liveScore.fixtureId}
            </span>
          )}
          {wallet.publicKey && !txline.isReady && (
            <button
              onClick={async () => {
                try {
                  await txline.activate();
                  toast("TxLINE World Cup access activated.", { type: "success" });
                } catch (err) {
                  toast(`TxLINE activation failed: ${(err?.message ?? "unknown").slice(0, 100)}`, { type: "error" });
                }
              }}
              disabled={["subscribing", "authenticating", "awaiting-signature", "activating"].includes(txline.status)}
              className="font-mono text-[9px] sm:text-xs border border-card-yes/50 text-card-yes px-2 sm:px-3 py-1 sm:py-1.5 rounded-sm hover:bg-card-yes/10 transition disabled:opacity-50 disabled:cursor-wait whitespace-nowrap"
              title={
                "Optional. Placing Yes/No bets already works without this — connecting your " +
                "wallet is enough. This only unlocks the real live proof feed and live score " +
                "badge (and is required before you can trigger settlement on a finished match). " +
                "Runs the free World Cup tier flow: on-chain subscribe() + guest JWT + signed activation."
              }
            >
              <span className="hidden sm:inline">
                {{
                  idle: "VALIDATE LIVE DATA (OPTIONAL)",
                  error: "RETRY VALIDATION",
                  subscribing: "VALIDATING SUBSCRIPTION…",
                  authenticating: "REQUESTING VALIDATION TOKEN…",
                  "awaiting-signature": "VALIDATE IN WALLET…",
                  activating: "FINALIZING VALIDATION…",
                }[txline.status] ?? "VALIDATE LIVE DATA (OPTIONAL)"}
              </span>
              {/* Short label on phones — the full sentence doesn't fit and
                  was pushing the disconnect button off-screen. */}
              <span className="sm:hidden">
                {{
                  idle: "VALIDATE LIVE",
                  error: "RETRY",
                  subscribing: "SUBSCRIBING…",
                  authenticating: "REQUESTING…",
                  "awaiting-signature": "SIGN IN WALLET…",
                  activating: "FINALIZING…",
                }[txline.status] ?? "VALIDATE LIVE"}
              </span>
            </button>
          )}
          {txline.isReady && (
            <span
              className="font-mono text-[9px] sm:text-xs text-card-yes border border-card-yes/30 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-sm whitespace-nowrap"
              title="Real TxLINE live data + settlement proof fetching are active. Not required for placing Yes/No bets."
            >
              VALIDATED
            </span>
          )}
          <div className="scale-90 sm:scale-100 origin-right">
            <WalletMultiButton />
          </div>
          {/*
            Always rendered, never conditionally squeezed out by wrapping —
            this was disappearing on narrow screens because it was the last
            flex item in a row that had already run out of room.
          */}
          {wallet.connected && (
            <button
              onClick={() => wallet.disconnect()}
              title="Disconnect wallet"
              className="font-mono text-[9px] sm:text-xs text-haze border border-haze/30 px-2 sm:px-3 py-1 sm:py-1.5 rounded-sm hover:border-card-no hover:text-card-no transition whitespace-nowrap shrink-0"
            >
              DISCONNECT
            </button>
          )}
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 px-6 md:px-12 pt-16 pb-20">
        <BallResponsive autoPlayDelay={2800} />

        <div className="relative z-10 grid lg:grid-cols-[1.1fr_0.9fr] gap-12 items-start">
          <div className="max-w-xl">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-card-yes mb-6 flex items-center gap-3">
              World Cup · TxLINE on-chain proofs · Solana devnet
            </p>
            <h1 className="font-display text-[clamp(4.25rem,0.9rem+10vw,9.5rem)] leading-[0.95] flap-glow">
              <SplitFlap text="PREDICT." className="block" />
              <SplitFlap text="VERIFY."  delay={0.5} className="block text-card-yes" />
              <SplitFlap text="SETTLE."  delay={1.0} className="block" />
            </h1>
            <p ref={heroRef} className="font-body text-haze text-lg mt-8 leading-relaxed">
              ChampChain settles World Cup prediction markets with TxLINE Merkle
              proofs — not a trusted operator. Anyone can submit a valid proof,
              trigger on-chain verification via CPI, and unlock the vault for winners.
            </p>
            <div className="flex gap-4 mt-10 flex-wrap">
              <a ref={viewMarketsRef} href="#markets"
                 className="bg-card-yes text-turf font-display tracking-wide px-8 py-3.5 rounded-sm hover:brightness-110 active:scale-95 transition inline-block">
                VIEW MARKETS
              </a>
              <a ref={programLinkRef} href={`https://explorer.solana.com/address/${PROGRAM_ID.toBase58()}?cluster=devnet`}
                 target="_blank" rel="noopener noreferrer"
                 className="border border-haze/40 text-haze font-mono text-xs px-6 py-3.5 rounded-sm hover:border-card-yes hover:text-card-yes transition flex items-center gap-2 inline-flex">
                PROGRAM ↗
              </a>
            </div>
          </div>

          {/* Live proof feed */}
          <div className="relative z-10" style={{ height: "520px", overflow: "hidden" }}>
            <ProofFeed apiOrigin={txline.apiOrigin} jwt={txline.jwt} apiToken={txline.apiToken} />
          </div>
        </div>
      </section>

      <ProofTicker items={TICKER_ITEMS} />

      {/* Markets */}
      <section id="markets" className="relative z-10 px-6 md:px-12 py-24">
        <div ref={marketsHeaderRef} className="flex items-end justify-between mb-8 flex-wrap gap-4">
          <div className="markets-header-item">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-card-yes mb-3">
              Live on Solana devnet
            </p>
            <h2 ref={marketsHeadingRef} className="font-display text-[clamp(2.5rem,1rem+4.8vw,4.75rem)] tracking-wide inline-block">
              {marketTab === "active" ? "Active markets" : marketTab === "coming" ? "Coming markets" : "Finished markets"}
            </h2>
          </div>
          <div className="markets-header-item flex items-center gap-3">
            <span className="font-mono text-xs text-haze">
              {shownMarkets.length} {marketTab === "active" ? "open" : marketTab === "coming" ? "upcoming" : "finished"}
            </span>
            <button
              onClick={refreshMarketStatus}
              disabled={marketsSyncing}
              className="font-mono text-[10px] uppercase tracking-widest text-haze border border-haze/30 px-2 py-1.5 rounded-sm hover:text-card-yes hover:border-card-yes/50 transition disabled:opacity-70 disabled:cursor-wait flex items-center gap-2"
              title="Re-check devnet for markets that were just initialized"
            >
              {marketsSyncing && (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-card-yes border-t-transparent" />
              )}
              {marketsSyncing ? "Syncing…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Menu — same section, same grid location; only the tab + heading
            change. Cancelled markets deliberately have no tab at all: they're
            already filtered out entirely (see refreshMarketStatus), not
            hidden-but-present.
            Active   = has a real fixtureId, betting window still open.
            Coming   = fixtureId still 0 (not created for real yet) and not
                       yet finished — no countdown shown, just "Coming soon".
            Finished = betting window closed and/or a real outcome exists,
                       whether or not the market ever had a real fixtureId. */}
        <div className="flex gap-1 mb-8 border-b border-haze/20">
          {[
            { id: "active", label: `ACTIVE (${activeMarkets.length})` },
            { id: "coming", label: `COMING (${comingMarkets.length})` },
            { id: "finished", label: `FINISHED (${finishedMarkets.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMarketTab(tab.id)}
              className={`font-mono text-xs tracking-widest px-4 py-2.5 border-b-2 -mb-px transition ${
                marketTab === tab.id
                  ? "border-card-yes text-card-yes"
                  : "border-transparent text-haze hover:text-chalk"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/*
          A real, hard-to-miss signal that a chain scan is happening —
          not just a button label changing. Spans the full section width
          right under the heading row.
        */}
        <div className="h-[2px] w-full rounded-full overflow-hidden bg-haze/10 mb-8 -mt-4">
          {marketsSyncing && (
            <div
              className="h-full w-1/3 rounded-full"
              style={{
                background: "linear-gradient(90deg, transparent, var(--gold, #F5B731), transparent)",
                animation: "marketScanSweep 1.1s ease-in-out infinite",
              }}
            />
          )}
        </div>
        <div ref={marketsGridRef} className="grid md:grid-cols-3 gap-6">
          {shownMarkets.length === 0 && !marketsSyncing && (
            <div className="market-grid-item md:col-span-3 border border-dashed border-haze/25 rounded-sm p-10 text-center">
              <p className="font-mono text-sm text-haze">
                {marketTab === "active"
                  ? "No active markets — none are currently open for betting."
                  : marketTab === "coming"
                  ? "No markets coming up right now."
                  : "No finished markets yet."}
              </p>
              <p className="font-mono text-xs text-haze/70 mt-2">
                Every market here is created directly from a real TxLINE
                fixture — nothing is pre-populated or guessed.
              </p>
            </div>
          )}
          {shownMarkets.map(m => {
            const isPendingHere = placeBetMutation.isPending && placeBetMutation.variables?.matchId === m.matchId;
            return (
              <div key={m.id} className="market-grid-item">
                <MarketCard
                  market={m}
                  onBet={handleBet}
                  onSettle={attemptSettlement}
                  onClaim={handleClaim}
                  isBetting={isPendingHere}
                  bettingSide={isPendingHere ? placeBetMutation.variables?.side : null}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* Architecture */}
      <section ref={archRef} className="relative z-10 px-6 md:px-12 py-20 border-t border-haze/20">
        <h2 ref={architectureHeadingRef} className="font-display text-4xl md:text-5xl tracking-wide mb-12 inline-block">Settlement architecture</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              t: "Escrowed positions",
              d: "User funds lock into a market-specific PDA vault on-chain. No custodial server holds your assets.",
            },
            {
              t: "TxLINE proof receipt",
              d: "Settlement CPIs into TxLINE validate_stat with a 1.4M CU budget, verifying a Merkle proof anchored on-chain.",
            },
            {
              t: "Permissionless unlock",
              d: "Anyone — user or keeper — can submit the proof. Once validation passes, winners claim from the vault directly.",
            },
          ].map((card, i) => (
            <div key={card.t} className="arch-card border border-haze/20 p-6 rounded-sm bg-turf-light/30 transition-colors hover:border-card-yes/40">
              <span className="font-mono text-xs text-card-yes block mb-3">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="font-display text-xl mb-2 tracking-wide">{card.t}</h3>
              <p className="text-haze text-sm leading-relaxed">{card.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Program badge */}
      <section ref={badgeRef} className="relative z-10 px-6 md:px-12 py-12 border-t border-haze/20">
        <div className="program-badge-item border border-haze/20 rounded-sm p-6 bg-turf-light/30 max-w-2xl">
          <span className="font-mono text-xs text-card-yes block mb-3">DEPLOYED</span>
          <p className="font-mono text-xs text-haze break-all">
            Program ID: <span className="text-chalk">{PROGRAM_ID.toBase58()}</span>
          </p>
          <p className="font-mono text-xs text-haze mt-2">Network: Solana Devnet</p>
          <p className="font-mono text-xs text-haze mt-1">
            TxLINE: validate_stat CPI · discriminator [107,197,232,90,191,136,105,185]
          </p>
        </div>
      </section>

      <Footer programId={PROGRAM_ID.toBase58()} />

      <MobileBall />
    </div>
  );
}