"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

export function DatasetStatusPoller({ datasetId }: { datasetId: string }) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (cancelled) return;
      try {
        const res = await fetch(
          `/datasets/api?path=${encodeURIComponent(`/api/datasets/${datasetId}`)}`,
          { cache: "no-store" },
        );
        if (res.ok) {
          const ds = (await res.json()) as { status: string };
          if (ds.status === "ready" || ds.status === "error") {
            router.refresh();
            return;
          }
        }
      } catch {
        // swallow; keep polling
      }
      if (!cancelled) timer = setTimeout(tick, 2000);
    }

    timer = setTimeout(tick, 2000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [datasetId, router]);

  return (
    <p className="text-muted-foreground flex items-center gap-2 text-xs">
      <Loader2 className="text-primary size-3 animate-spin" />
      Ingesting… this page refreshes when ready.
    </p>
  );
}
