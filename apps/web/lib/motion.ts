import type { Transition, Variants } from "framer-motion";

/*
 * Shared motion tokens. Tight, consistent timing across the app — keep all
 * micro-interactions in the 150–250ms window, container transitions 220–360ms.
 * Every consumer should also respect prefers-reduced-motion (framer-motion
 * does this automatically via the MotionConfig `reducedMotion="user"` set in
 * app/layout.tsx via MotionProvider).
 */

export const ease = {
  out: [0.22, 1, 0.36, 1] as const, // emphasized ease-out (Material expressive)
  inOut: [0.65, 0, 0.35, 1] as const,
  in: [0.55, 0, 1, 0.45] as const,
  spring: { type: "spring" as const, stiffness: 360, damping: 30, mass: 0.7 },
  softSpring: { type: "spring" as const, stiffness: 220, damping: 26, mass: 0.9 },
};

export const duration = {
  fast: 0.15,
  base: 0.22,
  slow: 0.32,
  hero: 0.45,
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: duration.base, ease: ease.out } },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: duration.slow, ease: ease.out } },
};

export const fadeUpSmall: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: duration.base, ease: ease.out } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: { duration: duration.base, ease: ease.out } },
};

/* Stagger container — children should use fadeUpSmall or scaleIn variants. */
export const staggerParent: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.045,
      delayChildren: 0.04,
    },
  },
};

/* Slower stagger for hero/landing surfaces. */
export const heroStagger: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.05,
    },
  },
};

export const press: Transition = {
  duration: duration.fast,
  ease: ease.out,
};

/* Hover-lift card transition. */
export const cardHover: Transition = {
  duration: duration.base,
  ease: ease.out,
};
