import { useEffect, useRef } from "react";
import gsap from "gsap";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Utilitaire : anime tous les enfants d'un conteneur quand il devient visible.
 * Une seule timeline avec stagger, pas de surprises.
 */
function useContainerReveal(selector, buildTimeline, options = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const targets = container.querySelectorAll(selector);
    if (!targets.length) return;

    // Si l'utilisateur préfère réduire les mouvements
    if (prefersReducedMotion()) {
      gsap.set(targets, { opacity: 1, y: 0, scale: 1, clipPath: "inset(0 0 0 0)" });
      return;
    }

    // Construction de la timeline (pausée par défaut)
    const tl = buildTimeline(targets);
    tl.pause();

    let played = false;

    // Vérifier si le conteneur est déjà visible
    const rect = container.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      played = true;
      tl.play();
    } else {
      // Sinon, on attend qu'il entre dans le viewport
      const observer = new IntersectionObserver(
        (entries) => {
          if (played) return;
          if (entries[0].isIntersecting) {
            played = true;
            tl.play();
            observer.disconnect();
          }
        },
        {
          threshold: options.threshold ?? 0.1,
          rootMargin: options.rootMargin ?? "0px 0px -20px 0px",
        }
      );

      observer.observe(container);
      return () => {
        observer.disconnect();
        tl.kill();
      };
    }

    // Nettoyage si déjà joué
    return () => {
      tl.kill();
    };
  }, [selector, buildTimeline, options]);

  return ref;
}

// ---------------------- HOOKS À UTILISER DANS VOTRE APP ----------------------

/**
 * Fade + lift pour les sections (useScrollReveal).
 */
export function useScrollReveal(selector, opts = {}) {
  const stagger = opts.stagger ?? 0.15;
  return useContainerReveal(
    selector,
    (targets) => {
      gsap.set(targets, { opacity: 0, y: 48, scale: 0.92 });
      return gsap.timeline().to(targets, {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 1.0,
        ease: "power3.out",
        stagger,
      });
    },
    {
      threshold: opts.threshold ?? 0.1,
      rootMargin: opts.rootMargin ?? "0px 0px -30px 0px",
    }
  );
}

/**
 * Grille des marchés : scale + bounce, sans blur, très fluide.
 */
export function useMarketsReveal(selector, opts = {}) {
  const stagger = opts.stagger ?? 0.12;
  return useContainerReveal(
    selector,
    (targets) => {
      gsap.set(targets, { opacity: 0, y: 60, scale: 0.85 });
      return gsap.timeline().to(targets, {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.9,
        ease: "back.out(1.6)",
        stagger,
      });
    },
    {
      threshold: opts.threshold ?? 0.1,
      rootMargin: opts.rootMargin ?? "0px 0px -20px 0px",
    }
  );
}

/**
 * Clip-reveal pour un élément unique (heading).
 */
export function useClipReveal() {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (prefersReducedMotion()) {
      gsap.set(el, { clipPath: "inset(0 0 0 0)", x: 0, opacity: 1 });
      return;
    }

    let played = false;
    const tl = gsap.timeline({ paused: true });
    gsap.set(el, { clipPath: "inset(0 100% 0 0)", x: -12, opacity: 1 });
    tl.to(el, {
      clipPath: "inset(0 0% 0 0)",
      x: 0,
      duration: 0.9,
      ease: "power4.out",
    });

    // Vérifier si déjà visible
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      played = true;
      tl.play();
    } else {
      const observer = new IntersectionObserver(
        (entries) => {
          if (played) return;
          if (entries[0].isIntersecting) {
            played = true;
            tl.play();
            observer.disconnect();
          }
        },
        { threshold: 0.2, rootMargin: "0px 0px -50px 0px" }
      );
      observer.observe(el);
      return () => observer.disconnect();
    }

    return () => tl.kill();
  }, []);

  return ref;
}

// ---------------------- MAGNETIC & TILT (inchangés) ----------------------

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

export function useAnimatedNumber(value, { decimals = 3, onUpdate } = {}) {
  const proxy = useRef({ v: value });

  useEffect(() => {
    if (prefersReducedMotion()) {
      onUpdate?.(value.toFixed(decimals));
      return;
    }
    const tween = gsap.to(proxy.current, {
      v: value,
      duration: 0.8,
      ease: "power2.out",
      onUpdate: () => onUpdate?.(proxy.current.v.toFixed(decimals)),
    });
    return () => tween.kill();
  }, [value, decimals, onUpdate]);
}