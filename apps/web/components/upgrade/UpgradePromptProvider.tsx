"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import type { PlanResponse } from "@/lib/billing";
import { UpgradePromptDialog } from "./UpgradePromptDialog";

export type UpgradeReason = { code: string; message: string };

type Ctx = {
  plan: PlanResponse | null;
  openUpgrade: (reason?: UpgradeReason) => void;
  closeUpgrade: () => void;
};

const UpgradePromptContext = createContext<Ctx | null>(null);

export function UpgradePromptProvider({
  initialPlan,
  children,
}: {
  initialPlan: PlanResponse | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<UpgradeReason | null>(null);

  const openUpgrade = useCallback((r?: UpgradeReason) => {
    setReason(r ?? null);
    setOpen(true);
  }, []);

  const closeUpgrade = useCallback(() => {
    setOpen(false);
    // Keep `reason` around briefly so the close animation doesn't flicker
    // the contextual banner — clear on next tick.
    setTimeout(() => setReason(null), 200);
  }, []);

  const value = useMemo<Ctx>(
    () => ({ plan: initialPlan, openUpgrade, closeUpgrade }),
    [initialPlan, openUpgrade, closeUpgrade],
  );

  return (
    <UpgradePromptContext.Provider value={value}>
      {children}
      <UpgradePromptDialog
        open={open}
        plan={initialPlan}
        reason={reason}
        onOpenChange={(next) => (next ? setOpen(true) : closeUpgrade())}
      />
    </UpgradePromptContext.Provider>
  );
}

export function useUpgradePrompt(): Ctx {
  const ctx = useContext(UpgradePromptContext);
  if (!ctx) {
    // Outside the provider (share view, auth pages) — return a no-op so
    // call sites can defensively destructure without crashing.
    return {
      plan: null,
      openUpgrade: () => {},
      closeUpgrade: () => {},
    };
  }
  return ctx;
}
