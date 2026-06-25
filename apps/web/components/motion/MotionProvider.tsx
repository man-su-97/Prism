"use client";

import { MotionConfig } from "framer-motion";

import { duration, ease } from "@/lib/motion";

/*
 * Wraps the app with a MotionConfig that honors `prefers-reduced-motion` and
 * sets sensible global defaults. `reducedMotion="user"` automatically disables
 * transforms while keeping crossfades, which keeps the app accessible without
 * each component needing a guard.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ duration: duration.base, ease: [...ease.out] }}
    >
      {children}
    </MotionConfig>
  );
}
