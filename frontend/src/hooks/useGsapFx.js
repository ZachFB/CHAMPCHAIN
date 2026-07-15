import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

// Mobile browsers resize the viewport (a few dozen px) purely from the
// address bar collapsing/expanding as you scroll — that's not a real
// layout change, but ScrollTrigger's default behavior treats any resize
// as a signal to recalculate every trigger's position. Recalculating
// mid-scroll, using a viewport height that's mid-transition, is exactly
// what was making sections need to be scrolled well past their actual
// position before their reveal fired. This tells ScrollTrigger to ignore
// resizes caused specifically by that mobile browser-chrome collapse.
ScrollTrigger.config({ ignoreMobileResize: true });

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Vite's hot-reload doesn't always fully tear down a hook's previous
// ScrollTrigger before the effect re-runs (e.g. editing this file while
// the dev server is running) — leftover instances pile up, each still
// contributing to the page's measured scrollable height, which is what
// causes phantom extra scroll space / "stuck" scrolling. Killing any
// existing trigger for the same DOM node before creating a new one keeps
// this to exactly one instance per element no matter how many times the
// effect re-runs.
function killExistingTriggersFor(root) {
  ScrollTrigger.getAll().forEach((st) => {
    if (st.trigger === root) st.kill();
  });
}

/**
 * Magnetic hover: the element eases toward the cursor within its own
 * bounds, then springs back on leave. Used on primary CTAs — cheap to
 * add, disproportionately makes a button feel "premium."
 */
export function useMagnetic(strength = 0.35) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    const xTo = gsap.quickTo(el, "x", { duration: 0.5, ease: "power3" });
    const yTo = gsap.quickTo(el, "y", { duration: 0.5, ease: "power3" });

    function onMove(e) {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - r.left - r.width / 2) * strength);
      yTo((e.clientY - r.top - r.height / 2) * strength);
    }
    function onLeave() {
      xTo(0);
      yTo(0);
    }

    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [strength]);

  return ref;
}

/**
 * 3D tilt-on-hover for cards: rotates toward the cursor with a subtle
 * lift and a sheen that tracks the light angle. This is the signature
 * micro-interaction for market cards — betting slips that feel physical.
 */
export function useTilt(maxDeg = 7) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    gsap.set(el, { transformPerspective: 800, transformStyle: "preserve-3d" });
    const rxTo = gsap.quickTo(el, "rotationX", { duration: 0.4, ease: "power3" });
    const ryTo = gsap.quickTo(el, "rotationY", { duration: 0.4, ease: "power3" });
    const liftTo = gsap.quickTo(el, "y", { duration: 0.4, ease: "power3" });

    function onMove(e) {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;   // 0..1
      const py = (e.clientY - r.top) / r.height;   // 0..1
      ryTo((px - 0.5) * maxDeg * 2);
      rxTo(-(py - 0.5) * maxDeg * 2);
      liftTo(-6);
    }
    function onLeave() {
      rxTo(0);
      ryTo(0);
      liftTo(0);
    }

    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [maxDeg]);

  return ref;
}

/**
 * Scroll reveal: fades/lifts children of the given selector in as they
 * cross the viewport, staggered. One ScrollTrigger batch per section
 * instead of scattering timelines everywhere.
 */
export function useScrollReveal(selector, opts = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const targets = root.querySelectorAll(selector);
    if (!targets.length) return;
    killExistingTriggersFor(root);

    if (prefersReducedMotion()) {
      gsap.set(targets, { opacity: 1, y: 0, scale: 1 });
      return;
    }

    // Bigger travel distance (48px, was 28) + a touch more scale-up (0.92,
    // was 0.97) + a longer, softer duration — the previous version was too
    // subtle to read as a deliberate "entrance" rather than a slight jitter,
    // especially for elements already partly in view when the trigger fires.
    gsap.set(targets, { opacity: 0, y: 48, scale: 0.92 });
    const tween = gsap.to(targets, {
      opacity: 1,
      y: 0,
      scale: 1,
      duration: 1.0,
      ease: "power3.out",
      stagger: opts.stagger ?? 0.15,
      scrollTrigger: {
        trigger: root,
        start: "top 78%",
        once: true,
      },
    });

    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [selector, opts.stagger]);

  return ref;
}

/**
 * Scroll reveal, "market grid" flavor: same idea as useScrollReveal but
 * deliberately more dramatic — cards scale up from slightly small with a
 * soft blur-to-sharp resolve and a slight bounce on landing, instead of a
 * plain fade+lift. Reserved for the markets grid specifically (the section
 * most worth making memorable in a demo); everything else keeps the calmer
 * useScrollReveal so the page doesn't feel busy.
 *
 * Previously this also added `rotationX` + `transformPerspective` for a 3D
 * tilt — removed. Rotating a card in 3D space changes its rendered
 * bounding box in a way that can transiently poke outside its container's
 * normal flow width, and depending on the browser that can register as
 * real horizontal overflow on the page (a second, horizontal scrollbar,
 * and scroll position calculations that never quite resolve back to a
 * clean "bottom of page"). Scale + blur alone still reads as a deliberate,
 * elevated entrance without that risk.
 */
export function useMarketsReveal(selector, opts = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const targets = root.querySelectorAll(selector);
    if (!targets.length) return;
    killExistingTriggersFor(root);

    if (prefersReducedMotion()) {
      gsap.set(targets, { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" });
      return;
    }

    gsap.set(targets, {
      opacity: 0,
      y: 60,
      scale: 0.88,
      filter: "blur(6px)",
    });
    const tween = gsap.to(targets, {
      opacity: 1,
      y: 0,
      scale: 1,
      filter: "blur(0px)",
      duration: 0.9,
      ease: "back.out(1.6)",
      stagger: opts.stagger ?? 0.12,
      scrollTrigger: {
        trigger: root,
        start: "top 82%",
        once: true,
      },
    });

    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [selector, opts.stagger]);

  return ref;
}

/**
 * Section heading reveal: a curtain-wipe via clip-path (instead of a plain
 * fade) — the heading unmasks left-to-right with a slight horizontal
 * settle. Meant for the big section titles ("Active markets", "Settlement
 * architecture", etc.) so each new section announces itself distinctly
 * rather than every element on the page fading in the same way.
 */
export function useClipReveal() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    killExistingTriggersFor(el);

    if (prefersReducedMotion()) {
      gsap.set(el, { clipPath: "inset(0 0 0 0)", x: 0, opacity: 1 });
      return;
    }

    gsap.set(el, { clipPath: "inset(0 100% 0 0)", x: -12, opacity: 1 });
    const tween = gsap.to(el, {
      clipPath: "inset(0 0% 0 0)",
      x: 0,
      duration: 0.9,
      ease: "power4.out",
      scrollTrigger: {
        trigger: el,
        start: "top 85%",
        once: true,
      },
    });

    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, []);

  return ref;
}

/**
 * Animates a numeric value from its previous render to the next with a
 * tabular-looking count, instead of the DOM just snapping to the new
 * number. Pass the *display* string setter; the hook handles the tween.
 */
export function useAnimatedNumber(value, { decimals = 3, onUpdate } = {}) {
  const prev = useRef(value);
  const proxy = useRef({ v: value });

  useEffect(() => {
    if (prefersReducedMotion()) {
      onUpdate?.(value.toFixed(decimals));
      prev.current = value;
      return;
    }
    const tween = gsap.to(proxy.current, {
      v: value,
      duration: 0.8,
      ease: "power2.out",
      onUpdate: () => onUpdate?.(proxy.current.v.toFixed(decimals)),
    });
    prev.current = value;
    return () => tween.kill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}