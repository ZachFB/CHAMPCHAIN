import { useEffect, useState } from "react";
import ClaimButton from "./ClaimButton.jsx";
import Spinner from "./Spinner.jsx";
import { useTilt, useAnimatedNumber } from "../hooks/useGsapFx.js";
import { toast } from "./Toast.jsx";

// Returns raw seconds remaining (can be negative once passed) — callers
// decide how to label/format it. Ticks every second, which is also what
// keeps the two derived states below (isClosed, matchInProgress) fresh
// every render without any extra machinery.
function useCountdown(targetTs) {
  const [remaining, setRemaining] = useState((targetTs ?? 0) - Date.now() / 1000);
  useEffect(() => {
    const tick = () => setRemaining((targetTs ?? 0) - Date.now() / 1000);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetTs]);
  return remaining;
}

function formatDuration(remainingSeconds) {
  const h = Math.floor(remainingSeconds / 3600);
  const m = Math.floor((remainingSeconds % 3600) / 60);
  const s = Math.floor(remainingSeconds % 60);
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

export default function MarketCard({ market, onBet, onSettle, onClaim, isBetting, bettingSide }) {
  // Two independent clocks, matching the two on-chain fields:
  //   - closeTs           -> betting deadline (kickoff). Once passed, no
  //                          more bets, whether or not the match itself
  //                          has actually finished yet.
  //   - earliestSettleTs  -> earliest moment settlement can be *attempted*
  //                          (kickoff + a margin that covers full time,
  //                          extra time, penalties, etc). Between closeTs
  //                          and earliestSettleTs the match is presumed
  //                          still in progress — no bet buttons AND no
  //                          settlement button, just a status badge.
  const bettingRemaining = useCountdown(market.closeTs);
  const settleRemaining  = useCountdown(market.earliestSettleTs ?? market.closeTs);
  const bettingCountdown = bettingRemaining <= 0 ? "Betting closed" : formatDuration(bettingRemaining);
  const settleCountdown  = formatDuration(Math.max(settleRemaining, 0));
  // Guarded defaults — DEMO_MARKETS entries intentionally don't hardcode
  // pool sizes (that would be fake data), so on the very first render,
  // before refreshMarketStatus() has read the real chain values, these are
  // undefined. Falling back to 0 here means that brief window renders an
  // honest "no bets yet" state instead of crashing outright.
  const totalYes = market.totalYes ?? 0;
  const totalNo  = market.totalNo ?? 0;
  const total       = totalYes + totalNo || 1;
  const yesPct      = Math.round((totalYes / total) * 100);
  const hasActivity = market.onChain && (totalYes + totalNo) > 0;
  const isClosed   = market.onChain && bettingRemaining <= 0;
  // Same rule as App.jsx's isMarketFinished — a market is "finished" only
  // once it's actually confirmed on-chain (not just described locally) and
  // either betting has closed, it's already carrying a real yes/no
  // outcome, or it was cancelled by the authority (cancel_market). Missing
  // "cancelled" here was a real bug: a cancelled market has userHasBet
  // true and outcome !== pending, so it fell through to the generic
  // "ATTEMPT SETTLEMENT" branch below instead of ever offering the refund.
  const isFinished = isClosed || market.outcome === "yes" || market.outcome === "no" || market.outcome === "cancelled";
  // Not yet confirmed on-chain, OR on-chain but not yet activated
  // (fixtureId still 0) — either way, no countdown, no bet buttons. A
  // local fixtureId placeholder describing what a market WILL be once
  // created must never make it look bettable before it actually exists.
  const isComing = (!market.onChain || !market.fixtureId) && !isFinished;
  // Betting is closed, there's a real fixtureId (so this isn't the dead
  // fixtureId=0 case), the outcome hasn't been decided yet, AND we haven't
  // reached earliestSettleTs — the window where the real-world match is
  // presumably still being played (or in the margin covering extra time /
  // penalties). No button makes sense here: betting is over, and
  // settlement would just fail with "too early" if attempted.
  const matchInProgress =
    isClosed &&
    !!market.fixtureId &&
    market.outcome === "pending" &&
    !!market.earliestSettleTs &&
    settleRemaining > 0;

  const [settling, setSettling] = useState(false);
  const [note, setNote] = useState("");
  const tiltRef = useTilt(6);

  // Pool figures tween smoothly instead of snapping the instant a bet lands
  // on-chain — the number "landing" is what sells that state actually moved.
  const [yesDisplay, setYesDisplay] = useState(totalYes.toFixed(3));
  const [noDisplay, setNoDisplay]   = useState(totalNo.toFixed(3));
  useAnimatedNumber(totalYes, { onUpdate: setYesDisplay });
  useAnimatedNumber(totalNo,  { onUpdate: setNoDisplay });

  async function handleSettleClick() {
    setSettling(true);
    setNote("");
    try {
      const result = await onSettle(market);
      setNote(result || "Settlement submitted.");
      toast(`${market.teamA} vs ${market.teamB} settled on-chain.`, { type: "success" });
    } catch (e) {
      const msg = e?.message?.slice(0, 90) || "Settlement unavailable right now.";
      setNote(msg);
      toast(`Settlement failed: ${msg}`, { type: "error" });
    } finally {
      setSettling(false);
    }
  }

  return (
    <div
      ref={tiltRef}
      className="group relative border border-haze/30 bg-turf-light/60 rounded-sm p-6
                 transition-[border-color,box-shadow] duration-300 ease-out will-change-transform
                 hover:border-card-yes/70
                 hover:shadow-[0_20px_45px_-15px_rgba(245,183,49,0.35)]"
    >
      {/* Diagonal shimmer sweep, only visible on hover */}
      <div
        className="pointer-events-none absolute inset-0 rounded-sm opacity-0 group-hover:opacity-100
                   transition-opacity duration-300 bg-gradient-to-br from-transparent via-card-yes/[0.06] to-transparent
                   bg-[length:200%_200%] group-hover:animate-shimmer"
      />

      <div className="relative" style={{ transform: "translateZ(24px)" }}>
        {/* Match badge */}
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-haze tracking-widest uppercase">
              {market.matchId}
            </span>
            {!isComing && (
              <span className={`font-mono text-xs tracking-widest ${isClosed ? "text-card-no" : "text-card-yes"}`}>
                {bettingCountdown}
              </span>
            )}
          </div>
          {/* Second, independent clock — always shown alongside the first
              one (not just once betting closes) for any real market that
              hasn't been settled yet, so a bettor can see both timelines
              from the moment they place a bet: when betting ends, and
              separately, when settlement becomes attemptable. */}
          {!isComing && market.fixtureId && market.outcome === "pending" && market.earliestSettleTs && (
            <div className="flex items-center justify-end mt-0.5">
              <span className="font-mono text-[11px] tracking-widest text-haze">
                {settleRemaining > 0 ? `Settles in ${settleCountdown}` : "Settlement open"}
              </span>
            </div>
          )}
        </div>

        {/* Teams */}
        <h3 className="font-display text-2xl tracking-wide mb-1 transition-transform duration-300 group-hover:translate-x-0.5">
          {market.teamA} <span className="text-haze">vs</span> {market.teamB}
        </h3>
        <p className="text-sm text-haze mb-5">{market.question}</p>

        {/* Distribution bar — grey and flat when there's genuinely no
            activity yet (coming soon / no bets placed), instead of the
            0% yes / 100% no math implying a lopsided prediction that was
            never actually made. */}
        <div className="h-2 w-full rounded-full overflow-hidden bg-turf flex mb-2 border border-haze/20">
          {hasActivity ? (
            <>
              <div className="bg-card-yes transition-all duration-700" style={{ width: `${yesPct}%` }} />
              <div className="bg-card-no  transition-all duration-700" style={{ width: `${100 - yesPct}%` }} />
            </>
          ) : (
            <div className="bg-haze/25 transition-all duration-700 w-full" />
          )}
        </div>
        <div className="flex justify-between text-xs font-mono text-haze mb-5">
          {hasActivity ? (
            <>
              <span>YES {yesPct}% · {yesDisplay} SOL</span>
              <span>{noDisplay} SOL · {100 - yesPct}% NO</span>
            </>
          ) : (
            <span className="w-full text-center text-haze/60">No bets placed yet</span>
          )}
        </div>

        {/* Pool & payout estimates */}
        <div className="text-xs font-mono text-haze mb-5 border-t border-haze/10 pt-3">
          <span>Total pool: {(totalYes + totalNo).toFixed(3)} SOL</span>
          {hasActivity && yesPct > 0 && yesPct < 100 && (
            <span className="ml-4">
              Est. payout YES: ×{(total / totalYes).toFixed(2)}
            </span>
          )}
        </div>

        {/* Bet buttons / settlement */}
        {/* Four states, matching the Active/Coming/Finished tabs above:
              - Coming:   fixtureId is still 0 and betting hasn't closed —
                          market hasn't actually been created for real yet.
              - Active:   real fixtureId, betting window still open — YES/NO.
              - Finished, no real outcome: either the fixtureId is still 0
                          (broken placeholder, can never find a matching
                          TxLINE proof) or it's a real market whose window
                          closed but nobody has settled it yet.
              - Finished, settled: a real yes/no outcome exists — show it
                          plus the claim button. */}
        {isComing ? (
          <div className="flex items-center justify-center gap-2 font-mono text-[11px] tracking-widest uppercase text-haze border border-haze/20 py-3 rounded-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-card-yes/60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-card-yes/80" />
            </span>
            Coming soon
          </div>
        ) : !isFinished ? (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => onBet(market.matchId, true)}
              disabled={isBetting}
              className="flex items-center justify-center gap-2 bg-card-yes text-turf font-display tracking-wide py-2.5 rounded-sm hover:brightness-110 active:scale-95 transition disabled:opacity-60 disabled:cursor-wait disabled:active:scale-100"
            >
              {bettingSide === true ? <Spinner /> : "YES"}
            </button>
            <button
              onClick={() => onBet(market.matchId, false)}
              disabled={isBetting}
              className="flex items-center justify-center gap-2 bg-card-no text-chalk font-display tracking-wide py-2.5 rounded-sm hover:brightness-110 active:scale-95 transition disabled:opacity-60 disabled:cursor-wait disabled:active:scale-100"
            >
              {bettingSide === false ? <Spinner /> : "NO"}
            </button>
          </div>
        ) : market.outcome === "yes" || market.outcome === "no" ? (
          <div className="space-y-2">
            <div className="text-center font-mono text-xs text-card-yes border border-card-yes/30 py-2 rounded-sm">
              Settled: {market.outcome.toUpperCase()}
            </div>
            {(() => {
              const bet = market.userBet;
              if (!bet) {
                return (
                  <p className="text-center font-mono text-xs text-haze py-2">
                    You didn't bet on this market.
                  </p>
                );
              }
              if (bet.claimed) {
                return (
                  <p className="text-center font-mono text-xs text-haze py-2">
                    Already claimed.
                  </p>
                );
              }
              const won = bet.side === (market.outcome === "yes");
              if (!won) {
                return (
                  <p className="text-center font-mono text-xs text-card-no border border-card-no/30 py-2 rounded-sm">
                    You lost this bet — nothing to claim.
                  </p>
                );
              }
              return <ClaimButton matchId={market.matchId} onClaim={onClaim} />;
            })()}
          </div>
        ) : market.outcome === "cancelled" ? (
          <div className="space-y-2">
            <div className="text-center font-mono text-xs text-haze border border-haze/30 py-2 rounded-sm">
              Market cancelled
            </div>
            {(() => {
              const bet = market.userBet;
              if (!bet) {
                return (
                  <p className="text-center font-mono text-xs text-haze py-2">
                    You didn't bet on this market.
                  </p>
                );
              }
              if (bet.claimed) {
                return (
                  <p className="text-center font-mono text-xs text-haze py-2">
                    Already claimed.
                  </p>
                );
              }
              // Cancelled markets refund the full original stake regardless
              // of which side it was on — claim_winnings already handles
              // this on-chain (Outcome::Cancelled => bet.amount).
              return <ClaimButton matchId={market.matchId} onClaim={onClaim} />;
            })()}
          </div>
        ) : !market.fixtureId ? (
          <div className="flex items-center justify-center gap-2 font-mono text-[11px] tracking-widest uppercase text-haze border border-haze/20 py-3 rounded-sm">
            Finished
          </div>
        ) : matchInProgress ? (
          <div className="flex items-center justify-center gap-2 font-mono text-[11px] tracking-widest uppercase text-haze border border-haze/20 py-3 rounded-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-card-no/60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-card-no/80" />
            </span>
            Match in progress — betting closed
          </div>
        ) : market.userHasBet ? (
          <div className="space-y-2">
            <button
              onClick={handleSettleClick}
              disabled={settling}
              className="w-full flex items-center justify-center gap-2 border border-card-yes/50 text-card-yes font-display tracking-wide py-2.5 rounded-sm
                         hover:bg-card-yes hover:text-turf transition disabled:opacity-50 disabled:cursor-wait"
            >
              {settling && <Spinner className="h-4 w-4" />}
              {settling ? "CHECKING TXLINE PROOF…" : "ATTEMPT SETTLEMENT"}
            </button>
            {note && (
              <p className="font-mono text-[11px] text-haze leading-snug">{note}</p>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center py-1">
            <span className="font-mono text-[11px] tracking-widest uppercase text-haze border border-haze/25 px-4 py-1.5 rounded-full">
              Finished — you didn't bet on this one
            </span>
          </div>
        )}
      </div>
    </div>
  );
}