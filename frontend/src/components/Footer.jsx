/**
 * Real project footer — brand blurb, protocol links, tech stack, and a
 * closing bar. Replaces the old two-line placeholder. Every link here is
 * either derived from a real prop (the deployed program's own address) or
 * points at a real public destination (TxLINE, the devnet faucet) — no
 * placeholder "#" links.
 *
 * Deliberately NOT using useScrollReveal here anymore: that hook sets
 * `opacity: 0` immediately on mount and relies on a ScrollTrigger to later
 * animate it to 1 once scrolled into view. If that trigger never fires for
 * any reason, the footer is stuck invisible forever — exactly the "footer
 * space is there but nothing shows" symptom. Rendering it plainly, always
 * visible, trades a little bit of entrance flourish for a guarantee it can
 * never disappear.
 */
export default function Footer({ programId }) {
  const explorerUrl = `https://explorer.solana.com/address/${programId}?cluster=devnet`;

  const stack = ["Solana", "Anchor", "TxLINE Merkle Proofs", "React", "GSAP"];

  return (
    <footer className="footer-root relative z-10 border-t border-haze/20">
      <div className="px-6 md:px-12 py-16 grid gap-12 md:grid-cols-[1.3fr_1fr_1fr]">
        {/* Brand */}
        <div className="footer-item">
          <span className="font-display text-xl tracking-widest block mb-4">
            CHAMP<span className="text-card-yes">CHAIN</span>
          </span>
          <p className="text-sm text-haze leading-relaxed max-w-sm">
            Permissionless World Cup prediction markets, settled by TxLINE
            Merkle proofs verified on-chain via CPI — not by a trusted
            operator. Funds sit in a market-specific PDA vault until a valid
            proof unlocks them for winners.
          </p>
        </div>

        {/* Protocol links */}
        <div className="footer-item">
          <span className="font-mono text-xs uppercase tracking-[0.25em] text-card-yes block mb-4">
            Protocol
          </span>
          <ul className="space-y-2.5 text-sm">
            <li>
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-haze hover:text-card-yes transition inline-flex items-center gap-1.5"
              >
                Program on Explorer ↗
              </a>
            </li>
            <li>
              <a
                href="https://txline.txodds.com/documentation"
                target="_blank"
                rel="noopener noreferrer"
                className="text-haze hover:text-card-yes transition inline-flex items-center gap-1.5"
              >
                TxLINE documentation ↗
              </a>
            </li>
            <li>
              <a
                href="https://faucet.solana.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-haze hover:text-card-yes transition inline-flex items-center gap-1.5"
              >
                Solana devnet faucet ↗
              </a>
            </li>
          </ul>
        </div>

        {/* Stack */}
        <div className="footer-item">
          <span className="font-mono text-xs uppercase tracking-[0.25em] text-card-yes block mb-4">
            Built with
          </span>
          <div className="flex flex-wrap gap-2">
            {stack.map((s) => (
              <span
                key={s}
                className="font-mono text-[10px] uppercase tracking-widest text-haze border border-haze/25 rounded-full px-3 py-1"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="footer-item px-6 md:px-12 py-6 border-t border-haze/10 flex justify-between items-center gap-4 flex-wrap">
        <span className="font-mono text-xs text-haze">
          ChampChain · TxODDS World Cup Hackathon · Prediction Markets &amp; Settlement
        </span>
        <span className="font-mono text-xs text-haze">Solana Devnet</span>
      </div>
    </footer>
  );
}