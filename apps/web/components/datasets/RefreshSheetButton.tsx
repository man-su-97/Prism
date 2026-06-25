"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { buildApiError, GoogleAuthError, messageFromUnknown } from "@/lib/errors";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function RefreshSheetButton({
  datasetId,
  lastSyncAt,
}: {
  datasetId: string;
  lastSyncAt: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onRefresh() {
    setPending(true);
    try {
      const res = await fetch(
        `/datasets/api?path=${encodeURIComponent(`/api/sheets/${datasetId}/refresh`)}`,
        { method: "POST" },
      );
      if (!res.ok) throw await buildApiError(res);
      toast.success("Refresh queued — new rows will appear shortly.");
      router.refresh();
    } catch (e) {
      if (e instanceof GoogleAuthError) {
        toast.error("Google account needs to be reconnected", {
          description: "Your Google access was revoked. Reconnect to resume syncing.",
          action: {
            label: "Go to Settings",
            onClick: () => router.push("/settings/connected"),
          },
        });
      } else {
        toast.error("Couldn't refresh the sheet", {
          description: messageFromUnknown(e),
        });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {lastSyncAt ? (
        <span className="text-muted-foreground text-xs tabular-nums">
          Synced {relativeTime(lastSyncAt)}
        </span>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRefresh}
        disabled={pending}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <RefreshCw className="size-4" />
        )}
        {pending ? "Refreshing…" : "Refresh now"}
      </Button>
    </div>
  );
}
