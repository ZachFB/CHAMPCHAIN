import { useEffect, useRef } from "react";
import gsap from "gsap";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ·.:—";

export default function SplitFlap({ text, delay = 0, style = {}, className = "" }) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const els = Array.from(node.querySelectorAll(".flap-char"));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      els.forEach(el => (el.textContent = el.dataset.final));
      return;
    }

    els.forEach((el, i) => {
      const final = el.dataset.final;
      if (final === " ") { el.textContent = "\u00A0"; return; }
      const tl = gsap.timeline({ delay: delay + i * 0.045 });
      const ticks = 7 + Math.floor(Math.random() * 6);
      for (let t = 0; t < ticks; t++) {
        tl.call(() => {
          el.textContent = CHARS[Math.floor(Math.random() * CHARS.length)];
        }).to(el, { duration: 0.035 });
      }
      tl.call(() => { el.textContent = final; });
      tl.fromTo(el,
        { scaleY: 0.5, opacity: 0.3 },
        { scaleY: 1, opacity: 1, duration: 0.18, ease: "back.out(2)" }
      );
    });
  }, [text, delay]);

  return (
    <span ref={ref} aria-label={text} className={className} style={style}>
      {text.split("").map((c, i) => (
        <span key={i} className="flap-char" data-final={c} aria-hidden="true">
          {c === " " ? "\u00A0" : c}
        </span>
      ))}
    </span>
  );
}
