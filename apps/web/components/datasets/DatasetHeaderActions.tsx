"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, MoreVertical, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeleteEntityDialog } from "@/components/ui/DeleteEntityDialog";
import { messageFromUnknown, parseApiError } from "@/lib/errors";

type Preview = {
  dataset_id: string;
  name: string;
  status: string;
  dashboards: number;
  widgets: number;
  chat_sessions: number;
  share_links_active: number;
};

const BUSY_STATUSES = new Set(["pending", "uploading", "ingesting"]);

export function DatasetHeaderActions({
  datasetId,
  datasetName,
}: {
  datasetId: string;
  datasetName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  async function openDeleteDialog() {
    setLoadingPreview(true);
    try {
      const res = await fetch(
        `/datasets/api?path=${encodeURIComponent(
          `/api/datasets/${datasetId}/delete-preview`,
        )}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(await parseApiError(res));
      setPreview((await res.json()) as Preview);
      setOpen(true);
    } catch (e) {
      toast.error("Couldn't load delete preview", {
        description: messageFromUnknown(e),
      });
    } finally {
      setLoadingPreview(false);
    }
  }

  async function onConfirm() {
    const res = await fetch(
      `/datasets/api?path=${encodeURIComponent(`/api/datasets/${datasetId}`)}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw new Error(await parseApiError(res));
    toast.success(`Deleted "${datasetName}".`);
    setOpen(false);
    router.push("/datasets");
    router.refresh();
  }

  const blocked =
    preview && BUSY_STATUSES.has(preview.status)
      ? "This dataset is still being processed. Wait until it finishes (or fails) before deleting."
      : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Dataset actions"
            disabled={loadingPreview}
          >
            {loadingPreview ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MoreVertical className="size-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              openDeleteDialog();
            }}
          >
            <Trash2 className="size-4" /> Delete dataset…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {preview ? (
        <DeleteEntityDialog
          open={open}
          onOpenChange={setOpen}
          title="Delete this dataset?"
          entityLabel="dataset"
          entityName={preview.name}
          impact={[
            { label: "dashboards", count: preview.dashboards },
            { label: "widgets", count: preview.widgets },
            { label: "chat conversations", count: preview.chat_sessions },
            { label: "active share links", count: preview.share_links_active },
          ]}
          blockedReason={blocked}
          onConfirm={onConfirm}
        />
      ) : null}
    </>
  );
}
