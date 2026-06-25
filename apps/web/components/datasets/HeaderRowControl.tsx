"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { messageFromUnknown, parseApiError } from "@/lib/errors";

export function HeaderRowControl({
  datasetId,
  headerOffset,
}: {
  datasetId: string;
  headerOffset: number | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  // Display is 1-based ("Row 1" = the first row); empty = auto-detect.
  const [value, setValue] = useState(
    headerOffset == null ? "" : String(headerOffset + 1),
  );

  async function reingest(offset: number | null) {
    setPending(true);
    try {
      const res = await fetch(
        `/datasets/api?path=${encodeURIComponent(`/api/datasets/${datasetId}/reingest`)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ header_offset: offset }),
        },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      toast.success("Re-ingest queued — the page refreshes when it's ready.");
      router.refresh();
    } catch (e) {
      toast.error("Couldn't re-ingest", { description: messageFromUnknown(e) });
    } finally {
      setPending(false);
    }
  }

  function onApply() {
    const trimmed = value.trim();
    if (trimmed === "") {
      void reingest(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 101) {
      toast.error("Enter a row number between 1 and 101, or leave blank for auto.");
      return;
    }
    void reingest(parsed - 1); // back to 0-based for the API
  }

  return (
    <div className="border-border/60 bg-muted/20 flex flex-wrap items-end gap-3 rounded-2xl border p-4">
      <div className="space-y-1">
        <label htmlFor="header-row" className="text-xs font-medium">
          Header row
        </label>
        <Input
          id="header-row"
          inputMode="numeric"
          className="w-28"
          placeholder="Auto"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={pending}
        />
        <p className="text-muted-foreground text-xs">
          {headerOffset == null
            ? "Currently auto-detected."
            : `Currently forced to row ${headerOffset + 1}.`}{" "}
          Leave blank to auto-detect.
        </p>
      </div>
      <Button type="button" size="sm" onClick={onApply} disabled={pending}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <RotateCcw className="size-4" />
        )}
        {pending ? "Queuing…" : "Re-ingest"}
      </Button>
    </div>
  );
}
