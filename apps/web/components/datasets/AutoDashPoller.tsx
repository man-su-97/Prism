"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

// How long to wait for autodash before giving up and showing the manual-create UI.
// The Arq worker runs separately from ingest, so there's a gap between
// "status=ready" and "dashboard row exists". 15 × 3 s = 45 s is generous.
const MAX_POLLS = 15;

export function AutoDashPoller({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const count = useRef(0);
  const [exhausted, setExhausted] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      count.current += 1;
      if (count.current >= MAX_POLLS) {
        clearInterval(id);
        setExhausted(true);
        return;
      }
      router.refresh();
    }, 3000);
    return () => clearInterval(id);
  }, [router]);

  // router.refresh() re-runs the RSC; when dashboards.length > 0 the parent
  // stops rendering AutoDashPoller entirely, unmounting it and clearing the
  // interval. If the job never produces a dashboard, exhaust and show fallback.
  if (exhausted) return <>{children}</>;

  return (
    <div className="border-border/60 bg-muted/20 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center">
      <div className="text-primary bg-background flex size-10 items-center justify-center rounded-full border border-border/60">
        <Loader2 className="size-4 animate-spin" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">Building your dashboard…</p>
        <p className="text-muted-foreground text-xs">
          This section refreshes automatically when it&apos;s ready.
        </p>
      </div>
    </div>
  );
}
