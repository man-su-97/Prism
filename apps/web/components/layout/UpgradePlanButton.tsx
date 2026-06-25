"use client";

import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useUpgradePrompt } from "@/components/upgrade/UpgradePromptProvider";

export function UpgradePlanButton() {
  const { plan, openUpgrade } = useUpgradePrompt();
  const current = plan?.plan.name?.toLowerCase();
  // Hide on top tier — nothing to upgrade to.
  if (current === "team") return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5 border-primary/30 bg-linear-to-br from-(--brand-from)/5 via-transparent to-(--brand-to)/5 hover:border-primary/50 hover:from-(--brand-from)/10 hover:to-(--brand-to)/10"
      onClick={() => openUpgrade()}
    >
      <Sparkles className="text-primary size-3.5" />
      Upgrade plan
    </Button>
  );
}
