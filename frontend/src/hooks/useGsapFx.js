import { useEffect, useRef } from "react";
import gsap from "gsap";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Generic IntersectionObserver-based reveal hook.
 * Observes child elements matching a selector and triggers a GSAP animation
 * when they become visible in the viewport.
 *
 * @param {string} selector - CSS selector for target elements
 * @param {Function} setupAnimation - function that receives an element and returns a GSAP timeline/tween
 * @param {Object} options - IntersectionObserver options
 * @param {number} options.threshold - visibility ratio (0..1)
 * @param {string} options.rootMargin - margin around viewport
 * @param {boolean} options.once - animate only once (true) or every time
 */
function useIntersectionReveal(selector, setupAnimation, options = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const targets = root.querySelectorAll(selector);
    if (!targets.length) return;

    if (prefersReducedMotion()) {
      targets.forEach((el) => {
        gsap.set(el, { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", clipPath: "inset(0 0 0 0)" });
      });
      return;
    }

    const animated = new Set();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const el = entry.target;
          if (entry.isIntersecting) {
            if (options.once !== false && animated.has(el)) return;
            const tl = setupAnimation(el);
            if (tl) tl.play();
            if (options.once !== false) animated.add(el);
          } else if (options.once === false) {
            animated.delete(el);
          }
        });
      },
      {
        threshold: options.threshold ?? 0.15,
        rootMargin: options.rootMargin ?? "0px 0px -50px 0px",
        ...options,
      }
    );

    targets.forEach((el) => {
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, [selector, setupAnimation, options]);

  return ref;
}

/**
 * Single-element version for useClipReveal.
 */
function useSingleIntersectionReveal(setupAnimation, options = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (prefersReducedMotion()) {
      gsap.set(el, { opacity: 1, clipPath: "inset(0 0 0 0)", x: 0 });
      return;
    }

    let animated = false;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !animated) {
            const tl = setupAnimation(el);
            if (tl) tl.play();
            if (options.once !== false) animated = true;
          }
        });
      },
      {
        threshold: options.threshold ?? 0.2,
        rootMargin: options.rootMargin ?? "0px 0px -50px 0px",
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [setupAnimation, options]);

  return ref;
}

// ---------------------- HOOKS FOR YOUR COMPONENTS ----------------------

/**
 * Classic fade + lift reveal for sections.
 * Replaces useScrollReveal.
 */
export function useScrollReveal(selector, opts = {}) {
  return useIntersectionReveal(
    selector,
    (el) => {
      gsap.set(el, { opacity: 0, y: 48, scale: 0.92 });
      return gsap.to(el, {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 1.0,
        ease: "power3.out",
        paused: true,
      });
    },
    {
      threshold: opts.threshold ?? 0.15,
      rootMargin: opts.rootMargin ?? "0px 0px -30px 0px",
      once: true,
      stagger: opts.stagger ?? 0.15,
    }
  );
}

/**
 * Market grid reveal with scale + blur + back.out bounce.
 * Replaces useMarketsReveal.
 */
export function useMarketsReveal(selector, opts = {}) {
  return useIntersectionReveal(
    selector,
    (el) => {
      gsap.set(el, { opacity: 0, y: 60, scale: 0.88, filter: "blur(6px)" });
      return gsap.to(el, {
        opacity: 1,
        y: 0,
        scale: 1,
        filter: "blur(0px)",
        duration: 0.9,
        ease: "back.out(1.6)",
        paused: true,
      });
    },
    {
      threshold: opts.threshold ?? 0.12,
      rootMargin: opts.rootMargin ?? "0px 0px -20px 0px",
      once: true,
      stagger: opts.stagger ?? 0.12,
    }
  );
}

/**
 * Clip-path curtain reveal for headings.
 * Replaces useClipReveal.
 */
export function useClipReveal() {
  return useSingleIntersectionReveal((el) => {
    gsap.set(el, { clipPath: "inset(0 100% 0 0)", x: -12, opacity: 1 });
    return gsap.to(el, {
      clipPath: "inset(0 0% 0 0)",
      x: 0,
      duration: 0.9,
      ease: "power4.out",
      paused: true,
    });
  }, { once: true });
}

// ---------------------- MAGNETIC & TILT (unchanged) ----------------------

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
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
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
 * Animate a numeric value with a smooth tween.
 * Replaces the old useAnimatedNumber – unchanged.
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
  }, [value, decimals, onUpdate]);
}