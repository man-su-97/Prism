"use client";

import { motion, type HTMLMotionProps } from "framer-motion";

import { fadeUpSmall, scaleIn, staggerParent } from "@/lib/motion";

type Preset = "fade-up" | "scale-in" | "stagger";

const presetMap = {
  "fade-up": fadeUpSmall,
  "scale-in": scaleIn,
  stagger: staggerParent,
} as const;

/*
 * Drop-in wrapper that animates a child on mount or when it scrolls into view.
 * - preset="fade-up" (default) — 6px lift + fade
 * - preset="scale-in" — 0.96 → 1 scale + fade
 * - preset="stagger" — apply to parent; children using fade-up/scale-in will
 *   sequence at 45ms intervals
 *
 * Reduced-motion users automatically get a fade-only via MotionConfig.
 */
export function Reveal({
  preset = "fade-up",
  delay,
  inView = false,
  className,
  children,
  ...props
}: {
  preset?: Preset;
  delay?: number;
  inView?: boolean;
  className?: string;
  children: React.ReactNode;
} & Omit<HTMLMotionProps<"div">, "variants" | "initial" | "animate" | "whileInView">) {
  const variants = presetMap[preset];
  const initial = "hidden" as const;
  const animateProp = inView ? undefined : "visible";
  const whileInView = inView ? "visible" : undefined;

  return (
    <motion.div
      variants={variants}
      initial={initial}
      animate={animateProp}
      whileInView={whileInView}
      viewport={inView ? { once: true, margin: "-10% 0px" } : undefined}
      transition={delay ? { delay } : undefined}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}
