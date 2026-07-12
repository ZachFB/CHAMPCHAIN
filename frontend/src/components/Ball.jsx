import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import gsap from "gsap";

const CENTER = 100;
const RADIUS = 96;

function toRad(deg) { return (deg * Math.PI) / 180; }

function pentagon(cx, cy, r, rotationDeg) {
  const pts = [];
  for (let i = 0; i < 5; i++) {
    const angle = toRad(rotationDeg + i * 72);
    pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return pts.join(" ");
}

const CENTER_PENTAGON = pentagon(CENTER, CENTER, 27, -90);
const MID_RING = Array.from({ length: 5 }, (_, i) => {
  const angle = -90 + 36 + i * 72;
  const cx = CENTER + 56 * Math.cos(toRad(angle));
  const cy = CENTER + 56 * Math.sin(toRad(angle));
  return pentagon(cx, cy, 21, angle + 180);
});
const OUTER_RING = Array.from({ length: 5 }, (_, i) => {
  const angle = -90 + i * 72;
  const cx = CENTER + 94 * Math.cos(toRad(angle));
  const cy = CENTER + 94 * Math.sin(toRad(angle));
  return pentagon(cx, cy, 17, angle);
});

const Ball = forwardRef(function Ball(
  { size = 320, className = "", style = {}, autoPlay = false, autoPlayDelay = 2800, onDone },
  ref
) {
  // Each Ball instance gets unique SVG IDs — fixes the bug where the mobile
  // ball's white parts disappear because it shares IDs with the desktop ball.
  const uid        = useId().replace(/:/g, "");
  const idSphere   = `ballSphere-${uid}`;
  const idGlare    = `ballGlare-${uid}`;
  const idClip     = `ballClip-${uid}`;

  const wrapRef      = useRef(null);
  const flashRef     = useRef(null);
  const [spinning, setSpinning] = useState(false);
  const hasPlayedRef = useRef(false);

  function play() {
    if (hasPlayedRef.current) return;
    hasPlayedRef.current = true;
    const node = wrapRef.current;
    if (!node) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      gsap.set(node, { opacity: 1, scale: 1, filter: "blur(0px)" });
      setSpinning(true);
      onDone?.();
      return;
    }

    const tl = gsap.timeline({
      onComplete: () => { setSpinning(true); onDone?.(); },
    });

    gsap.set(node, {
      opacity: 0, scale: 0.06, x: 0, y: 0, rotation: 0,
      filter: "blur(3px)", transformOrigin: "50% 50%",
    });
    if (flashRef.current) gsap.set(flashRef.current, { opacity: 0, scale: 0.4 });

    tl
      .to(node, { opacity: 1, scale: 1.15, filter: "blur(0px)", duration: 0.45, ease: "power4.in" })
      .to(node, { scaleX: 1.18, scaleY: 0.82, duration: 0.08, ease: "power2.out" })
      .to(flashRef.current, { opacity: 0.6, scale: 1.6, duration: 0.1, ease: "power2.out" }, "<")
      .to(flashRef.current, { opacity: 0, duration: 0.3, ease: "power2.out" })
      .to(node, { scaleX: 1, scaleY: 1, scale: 1.04, duration: 0.22, ease: "back.out(2.5)" })
      .to(node, { scale: 1, duration: 0.18, ease: "power2.out" });
  }

  useImperativeHandle(ref, () => ({ play }));

  useEffect(() => {
    if (!autoPlay) return;
    const t = setTimeout(play, autoPlayDelay);
    return () => clearTimeout(t);
  }, [autoPlay]);

  return (
    <div
      className={className}
      style={{ width: size, height: size, position: "relative", ...style }}
      aria-hidden="true"
    >
      <div
        ref={flashRef}
        style={{
          position: "absolute", inset: "-12%", borderRadius: "9999px",
          background: "radial-gradient(circle, rgba(245,183,49,0.55) 0%, rgba(245,183,49,0) 70%)",
          opacity: 0, pointerEvents: "none",
        }}
      />
      <div ref={wrapRef} style={{ width: "100%", height: "100%", opacity: autoPlay ? 0 : 1 }}>
        <svg viewBox="0 0 200 200" width={size} height={size} className="overflow-visible">
          <defs>
            <radialGradient id={idSphere} cx="38%" cy="32%" r="75%">
              <stop offset="0%"   stopColor="#FDFBF4" />
              <stop offset="60%"  stopColor="#E9E3D2" />
              <stop offset="100%" stopColor="#9C927A" />
            </radialGradient>
            <radialGradient id={idGlare} cx="32%" cy="26%" r="30%">
              <stop offset="0%"   stopColor="#FFFFFF" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
            </radialGradient>
            <clipPath id={idClip}>
              <circle cx={CENTER} cy={CENTER} r={RADIUS} />
            </clipPath>
          </defs>

          <ellipse cx={CENTER} cy={196} rx={62} ry={10} fill="#000000" opacity="0.35" />
          <circle cx={CENTER} cy={CENTER} r={RADIUS} fill={`url(#${idSphere})`} />

          <g clipPath={`url(#${idClip})`}>
            <g className={spinning ? "origin-center animate-[spin_22s_linear_infinite]" : "origin-center"}>
              <polygon points={CENTER_PENTAGON} fill="#10160F" />
              {MID_RING.map((pts, i)   => <polygon key={`mid-${i}`}   points={pts} fill="#10160F" />)}
              {OUTER_RING.map((pts, i) => <polygon key={`outer-${i}`} points={pts} fill="#10160F" />)}
            </g>
          </g>

          <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="#080F0A" strokeWidth="2" />
          <circle cx={CENTER} cy={CENTER} r={RADIUS} fill={`url(#${idGlare})`} />
        </svg>
      </div>
    </div>
  );
});

export default Ball;
