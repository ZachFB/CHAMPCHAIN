import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

// ─── Tiny pub/sub ────────────────────────────────────────────────────────
// No context provider needed: any component (App, MarketCard, ClaimButton)
// can call toast(...) directly, and <ToastHost /> (mounted once near the
// root) renders whatever is pushed. Keeps the call site a one-liner.
let listeners = [];
let id = 0;

export function toast(message, opts = {}) {
  const entry = { id: ++id, message, type: opts.type || "info", tx: opts.tx || null };
  listeners.forEach((fn) => fn(entry));
  return entry.id;
}

const ACCENTS = {
  success: "var(--gold)",
  error: "var(--red)",
  info: "var(--haze, #7C9184)",
};

const ICONS = {
  success: "✓",
  error: "✕",
  info: "ℹ",
};

function ScreenFlash({ color }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    gsap.fromTo(
      node,
      { opacity: 0.35 },
      { opacity: 0, duration: 0.6, ease: "power2.out" },
    );
  }, [color]);
  return (
    <div
      ref={ref}
      className="fixed inset-0 pointer-events-none z-[90]"
      style={{ background: `radial-gradient(circle at 50% 100%, ${color}, transparent 65%)` }}
    />
  );
}

// ─── Impact burst ──────────────────────────────────────────────────────────
// A dozen little shards flying out from the badge on arrival. Cheap (pure
// CSS transforms via GSAP, no external confetti lib) but reads as a real
// "hit" instead of the toast just fading in — this is what makes success
// feel like a win and error feel like a jolt, not just a filled progress bar.
function ImpactBurst({ accent, count = 10 }) {
  const shards = useRef([]);
  shards.current = [];
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    shards.current.forEach((el, i) => {
      if (!el) return;
      const angle = (Math.PI * 2 * i) / count + (Math.random() * 0.4 - 0.2);
      const dist = 34 + Math.random() * 26;
      gsap.set(el, { opacity: 1, x: 0, y: 0, scale: 1 });
      gsap.to(el, {
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        opacity: 0,
        scale: 0.2,
        duration: 0.55 + Math.random() * 0.2,
        ease: "power2.out",
      });
    });
  }, [count]);
  return (
    <div className="absolute left-[38px] top-1/2 -translate-y-1/2 w-0 h-0">
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          ref={(el) => (shards.current[i] = el)}
          className="absolute w-1.5 h-1.5 rounded-full"
          style={{ background: accent, opacity: 0 }}
        />
      ))}
    </div>
  );
}

function ToastItem({ entry, onDone }) {
  const ref = useRef(null);
  const glowRef = useRef(null);
  const barRef = useRef(null);
  const badgeRef = useRef(null);
  const tlRef = useRef(null);
  const accent = ACCENTS[entry.type];

  useEffect(() => {
    const node = ref.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tl = gsap.timeline({
      onComplete: () => onDone(entry.id),
    });
    tlRef.current = tl;

    if (reduced) {
      gsap.set(node, { opacity: 1, y: 0 });
      tl.to({}, { duration: 4.2 });
      return () => tl.kill();
    }

    gsap.set(node, { opacity: 0, y: 46, scale: 0.7, rotate: entry.type === "error" ? -2 : 1.2 });
    if (glowRef.current) gsap.set(glowRef.current, { opacity: 1, scale: 0.3 });
    if (barRef.current) gsap.set(barRef.current, { scaleX: 1, transformOrigin: "left center" });
    if (badgeRef.current) gsap.set(badgeRef.current, { scale: 0 });

    // One single decisive burst — the card, its glow, and its badge all
    // slam into place together instead of arriving in visible separate
    // steps. This is the "surgit d'un coup" feeling: impact first, then
    // it simply exists, rock-steady, until it drains away.
    tl.to(node, { opacity: 1, y: 0, scale: 1, rotate: 0, duration: 0.5, ease: "elastic.out(1, 0.55)" })
      .to(badgeRef.current, { scale: 1, duration: 0.5, ease: "elastic.out(1, 0.4)" }, "<")
      .to(glowRef.current, { opacity: 0, scale: 3, duration: 0.7, ease: "power2.out" }, "<")
      // Error gets a hard, punchy shake on top of the burst — it should
      // feel like a jolt, not a slow fade-in like everything else.
      .add(() => {
        if (entry.type === "error") {
          gsap.fromTo(
            node,
            { x: 0 },
            { x: 10, duration: 0.06, repeat: 5, yoyo: true, ease: "power1.inOut", clearProps: "x" }
          );
        }
      }, "<+0.1")
      // A slow continuous pulse on the border glow the whole time it's
      // alive — a static card reads as inert; this one keeps a heartbeat.
      .to(node, { boxShadow: `0 0 0 1px rgba(0,0,0,0.4), 0 20px 60px -8px ${accent}90, 0 0 40px -2px ${accent}b0`, duration: 0.8, ease: "sine.inOut", repeat: 3, yoyo: true }, "<")
      .to(barRef.current, { scaleX: 0, duration: 3.6, ease: "none" }, "<0.2")
      .to(node, { opacity: 0, y: 14, scale: 0.94, duration: 0.32, ease: "power2.in" });

    return () => tl.kill();
  }, [entry.id, onDone, accent, entry.type]);

  return (
    <div
      ref={ref}
      role="status"
      onMouseEnter={() => tlRef.current?.pause()}
      onMouseLeave={() => tlRef.current?.play()}
      className="relative pointer-events-auto rounded-md pl-6 pr-6 py-5 min-w-[340px] max-w-lg overflow-hidden"
      style={{
        background: "rgba(6,13,8,0.97)",
        backdropFilter: "blur(16px)",
        border: `2px solid ${accent}`,
        boxShadow: `0 0 0 1px rgba(0,0,0,0.4), 0 16px 48px -8px ${accent}55, 0 0 32px -2px ${accent}66`,
      }}
    >
      {/* Thick left accent stripe — reads instantly even out of the corner of the eye */}
      <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: accent }} />

      {/* Impact glow burst on arrival */}
      <div
        ref={glowRef}
        className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(circle at 15% 50%, ${accent}70 0%, transparent 70%)` }}
      />
      <ImpactBurst accent={accent} count={entry.type === "success" ? 12 : 8} />
      <div className="relative flex items-start gap-4">
        <span
          ref={badgeRef}
          className="flex items-center justify-center shrink-0 w-9 h-9 rounded-full font-bold text-lg"
          style={{ background: `${accent}22`, color: accent, border: `2px solid ${accent}` }}
        >
          {ICONS[entry.type]}
        </span>
        <div className="flex-1 pt-1">
          <p className="font-mono text-[14px] font-medium text-chalk leading-relaxed">{entry.message}</p>
          {entry.tx && (
            <a
              href={`https://explorer.solana.com/tx/${entry.tx}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[11px] mt-2.5 inline-flex items-center gap-1 hover:underline font-bold"
              style={{ color: accent }}
            >
              VIEW ON EXPLORER ↗
            </a>
          )}
        </div>
      </div>
      {/* Draining countdown bar — pauses along with the rest of the timeline on hover */}
      <div
        ref={barRef}
        className="absolute left-0 bottom-0 h-[3px] w-full"
        style={{ background: accent }}
      />
    </div>
  );
}

export function ToastHost() {
  const [items, setItems] = useState([]);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    const fn = (entry) => {
      setItems((prev) => [...prev, entry]);
      if (entry.type === "success" || entry.type === "error") {
        const key = Date.now();
        const color = entry.type === "success" ? "rgba(245,183,49,0.4)" : "rgba(220,60,50,0.32)";
        setFlash({ key, color });
        setTimeout(() => setFlash((f) => (f?.key === key ? null : f)), 650);
      }
    };
    listeners.push(fn);
    return () => { listeners = listeners.filter((l) => l !== fn); };
  }, []);

  function remove(id) {
    setItems((prev) => prev.filter((e) => e.id !== id));
  }

  return (
    <>
      {flash && <ScreenFlash key={flash.key} color={flash.color} />}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-3 pointer-events-none w-full px-4">
        {items.map((entry) => (
          <ToastItem key={entry.id} entry={entry} onDone={remove} />
        ))}
      </div>
    </>
  );
}
