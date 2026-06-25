"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import {
  DeleteEntityDialog,
  type DeleteImpactRow,
} from "@/components/ui/DeleteEntityDialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { humanizeErrorCode, parseApiError } from "@/lib/errors";

type Preview = {
  workspace_id: string;
  name: string;
  datasets: number;
  dashboards: number;
  widgets: number;
  chat_sessions: number;
  share_links_active: number;
  other_members: number;
  has_billing: boolean;
  blocked_reason: string | null;
};

const PREVIEW_PATH =
  "/settings/workspace/api/delete?path=/api/workspaces/delete-preview";
const DELETE_PATH =
  "/settings/workspace/api/delete?path=/api/workspaces/delete";

export function DeleteWorkspaceSection({
  workspaceName,
  nextWorkspaceId,
}: {
  workspaceName: string;
  nextWorkspaceId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const openDialog = useCallback(async () => {
    setLoadingPreview(true);
    setPreviewError(null);
    try {
      const res = await fetch(PREVIEW_PATH, { cache: "no-store" });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = (await res.json()) as Preview;
      setPreview(data);
      setOpen(true);
    } catch (err) {
      setPreviewError(
        err instanceof Error
          ? err.message
          : "Couldn't load the delete preview.",
      );
    } finally {
      setLoadingPreview(false);
    }
  }, []);

  const onConfirm = useCallback(async () => {
    const res = await fetch(DELETE_PATH, {
      method: "POST",
      cache: "no-store",
    });
    if (!res.ok) {
      // Surface the server's blocked_reason verbatim — race against a
      // concurrent invite / workspace create could flip the state between
      // preview and delete.
      throw new Error(await parseApiError(res));
    }

    // The JWT was minted for the now-deleted org. Switch Better Auth to a
    // surviving workspace BEFORE navigating, otherwise the next backendFetch
    // would still bridge to a vanished org_id for the cookieCache window.
    if (nextWorkspaceId) {
      await authClient.organization.setActive({
        organizationId: nextWorkspaceId,
      });
    }
    setOpen(false);
    router.replace(nextWorkspaceId ? "/home" : "/onboarding/workspace");
    router.refresh();
  }, [nextWorkspaceId, router]);

  const impact: DeleteImpactRow[] = preview
    ? [
        { label: "datasets", count: preview.datasets },
        { label: "dashboards", count: preview.dashboards },
        { label: "widgets", count: preview.widgets },
        { label: "chat sessions", count: preview.chat_sessions },
        { label: "active share links", count: preview.share_links_active },
        {
          label:
            preview.other_members === 1
              ? "other member will lose access"
              : "other members will lose access",
          count: preview.other_members,
        },
      ]
    : [];

  const blockedReason =
    preview?.blocked_reason != null
      ? humanizeErrorCode(preview.blocked_reason)
      : null;

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
        <CardDescription>
          Permanently delete this workspace and everything inside it. You must
          have at least one other workspace before deleting this one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          variant="destructive"
          disabled={loadingPreview}
          onClick={openDialog}
        >
          {loadingPreview ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
          Delete workspace
        </Button>
        {previewError ? (
          <p className="text-destructive text-xs" role="alert">
            {previewError}
          </p>
        ) : null}
      </CardContent>

      <DeleteEntityDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setPreview(null);
        }}
        title="Delete this workspace?"
        entityLabel="workspace"
        entityName={workspaceName}
        impact={impact}
        blockedReason={blockedReason}
        onConfirm={onConfirm}
      />
    </Card>
  );
}
