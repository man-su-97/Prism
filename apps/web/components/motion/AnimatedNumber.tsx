"use client";

import { useEffect, useRef } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";

import { cn } from "@/lib/utils";

/*
 * Animates from 0 → value when scrolled into view. Used for KPI cards.
 * Respects prefers-reduced-motion: snaps to the final value instead of
 * counting up.
 */
export function AnimatedNumber({
  value,
  format,
  duration = 0.9,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const reduce = useReducedMotion();

  const mv = useMotionValue(0);
  const display = useTransform(mv, (n) => (format ? format(n) : Math.round(n).toLocaleString()));

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
    });
    return () => controls.stop();
  }, [inView, value, duration, reduce, mv]);

  return (
    <motion.span
      ref={ref}
      data-tabular
      className={cn("tabular-nums", className)}
    >
      {display}
    </motion.span>
  );
}
