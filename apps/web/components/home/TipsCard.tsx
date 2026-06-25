"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Lightbulb, Sparkles } from "lucide-react";

import { Card } from "@/components/ui/card";

const TIPS: { title: string; body: string }[] = [
  {
    title: "Ask in plain English",
    body: "Open any dashboard and use the chat panel — \"top 5 customers by spend last quarter\" works.",
  },
  {
    title: "Drag widgets around",
    body: "Grab a widget by its title bar to rearrange. Your layout saves automatically.",
  },
  {
    title: "Share read-only views",
    body: "Use the share button on a dashboard to create a public link — no sign-in needed for viewers.",
  },
  {
    title: "Keep data fresh",
    body: "Google Sheets datasets refresh on a schedule. Re-upload CSVs to bump them.",
  },
];

export function TipsCard() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIdx((i) => (i + 1) % TIPS.length);
    }, 6500);
    return () => clearInterval(id);
  }, []);

  const tip = TIPS[idx];

  return (
    <Card
      size="sm"
      className="relative gap-2 overflow-hidden ring-foreground/8"
    >
      {/* Soft brand wash behind the tips */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_0%_0%,oklch(from_var(--brand-from)_l_c_h/0.10),transparent_55%)]"
      />
      <div className="relative flex items-start gap-3 px-4 py-4">
        <span className="bg-linear-to-br from-(--brand-from) via-(--brand-via) to-(--brand-to) inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-white shadow-[0_4px_12px_-4px_oklch(from_var(--primary)_l_c_h/0.30)]">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider md:text-[11px]">
            <Lightbulb className="size-3" />
            Tips
          </div>
          <div className="relative mt-1 min-h-14">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              >
                <p className="text-foreground text-sm font-medium">
                  {tip.title}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  {tip.body}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="mt-3 flex gap-1">
            {TIPS.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIdx(i)}
                aria-label={`Tip ${i + 1}`}
                className={
                  "h-1 rounded-full transition-all " +
                  (i === idx
                    ? "w-6 bg-(--color-lime)"
                    : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50")
                }
              />
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
