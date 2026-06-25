"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageSquare, MoreVertical, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ChatPanel } from "@/components/chat/ChatPanel";
import { DashboardGrid } from "@/components/dashboard/Grid";
import { ShareLinkButton } from "@/components/dashboard/ShareLinkButton";
import { WidgetWizard } from "@/components/dashboard/WidgetWizard";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { DeleteEntityDialog } from "@/components/ui/DeleteEntityDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { messageFromUnknown, parseApiError } from "@/lib/errors";
import type { Widget } from "@/components/widgets/types";

type DashboardDeletePreview = {
  dashboard_id: string;
  name: string;
  widgets: number;
  chat_sessions: number;
  share_links_active: number;
};

type LayoutItem = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

type DashboardDetail = {
  id: string;
  dataset_id: string;
  name: string;
  kind: string;
  layout: LayoutItem[];
  overview: string | null;
  widgets: Widget[];
};

type Column = { name: string; kind: string; dtype: string };

type ModalState =
  | { type: "closed" }
  | { type: "create" }
  | { type: "edit"; widget: Widget };

async function jsonFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/dashboards/api?path=${encodeURIComponent(path)}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(await parseApiError(res));
  const text = await res.text();
  return JSON.parse(text || "null") as T;
}

export function DashboardClient({ initial }: { initial: DashboardDetail }) {
  const router = useRouter();
  const [dash, setDash] = useState<DashboardDetail>(initial);
  const [columns, setColumns] = useState<Column[]>([]);
  const [modal, setModal] = useState<ModalState>({ type: "closed" });
  const [chatOpen, setChatOpen] = useState(false);
  const [deletePreview, setDeletePreview] =
    useState<DashboardDeletePreview | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [loadingDeletePreview, setLoadingDeletePreview] = useState(false);

  const openDeleteDialog = useCallback(async () => {
    setLoadingDeletePreview(true);
    try {
      const preview = await jsonFetch<DashboardDeletePreview>(
        `/api/dashboards/${dash.id}/delete-preview`,
      );
      setDeletePreview(preview);
      setDeleteOpen(true);
    } catch (e) {
      toast.error("Couldn't load delete preview", {
        description: messageFromUnknown(e),
      });
    } finally {
      setLoadingDeletePreview(false);
    }
  }, [dash.id]);

  const confirmDelete = useCallback(async () => {
    await jsonFetch(`/api/dashboards/${dash.id}`, { method: "DELETE" });
    toast.success(`Deleted "${dash.name}".`);
    setDeleteOpen(false);
    router.push("/dashboards");
    router.refresh();
  }, [dash.id, dash.name, router]);

  const reload = useCallback(async () => {
    try {
      const next = await jsonFetch<DashboardDetail>(`/api/dashboards/${dash.id}`);
      setDash(next);
    } catch {
      // leave existing dash visible
    }
  }, [dash.id]);

  useEffect(() => {
    let cancelled = false;
    jsonFetch<{ columns: Column[] }>(`/api/datasets/${initial.dataset_id}`)
      .then((d) => {
        if (!cancelled) setColumns(d.columns ?? []);
      })
      .catch(() => {
        if (!cancelled) setColumns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [initial.dataset_id]);

  const onDelete = useCallback(
    async (widget: Widget) => {
      try {
        await jsonFetch(`/api/widgets/${widget.id}`, { method: "DELETE" });
        toast.success(`Deleted "${widget.title}"`);
        await reload();
      } catch (e) {
        toast.error(`Couldn't delete "${widget.title}"`, {
          description: messageFromUnknown(e),
        });
      }
    },
    [reload],
  );

  return (
    <div className="flex h-[calc(100svh-4rem)] min-h-0 flex-col">
      <PageHeader
        title={dash.name}
        description={
          <>
            <span className="capitalize">{dash.kind}</span>
            {" · "}
            <Link
              href={`/datasets/${dash.dataset_id}`}
              className="hover:underline"
            >
              View dataset
            </Link>
          </>
        }
        actions={
          <>
            <ShareLinkButton dashboardId={dash.id} dashboardName={dash.name} />
            <Button
              variant={chatOpen ? "secondary" : "outline"}
              aria-label="Ask your data"
              onClick={() => setChatOpen((v) => !v)}
            >
              <MessageSquare className="size-4" />
              <span className="hidden md:inline">Ask your data</span>
            </Button>
            <Button aria-label="Add widget" onClick={() => setModal({ type: "create" })}>
              <Plus className="size-4" />
              <span className="hidden md:inline">Add widget</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Dashboard actions"
                  disabled={loadingDeletePreview}
                >
                  {loadingDeletePreview ? (
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
                  <Trash2 className="size-4" /> Delete dashboard…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 min-w-0">
        <div className="bg-grid min-w-0 flex-1 space-y-4 overflow-auto p-4 sm:p-6">
          <DashboardGrid
            dashboardId={dash.id}
            initialLayout={dash.layout}
            widgets={dash.widgets}
            overview={dash.overview}
            onEdit={(w) => setModal({ type: "edit", widget: w })}
            onDelete={onDelete}
            onCreate={() => setModal({ type: "create" })}
          />
        </div>

        <ChatPanel
          open={chatOpen}
          dashboardId={dash.id}
          onMutation={() => void reload()}
          onOpenChange={setChatOpen}
        />
      </div>

      {deletePreview ? (
        <DeleteEntityDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Delete this dashboard?"
          entityLabel="dashboard"
          entityName={deletePreview.name}
          impact={[
            { label: "widgets", count: deletePreview.widgets },
            {
              label: "chat conversations",
              count: deletePreview.chat_sessions,
            },
            {
              label: "active share links",
              count: deletePreview.share_links_active,
            },
          ]}
          onConfirm={confirmDelete}
        />
      ) : null}

      {modal.type !== "closed" ? (
        <WidgetWizard
          mode={
            modal.type === "create"
              ? {
                  type: "create",
                  dashboardId: dash.id,
                  datasetId: dash.dataset_id,
                }
              : {
                  type: "edit",
                  widget: modal.widget,
                  dashboardId: dash.id,
                  datasetId: dash.dataset_id,
                }
          }
          columns={columns}
          onClose={() => setModal({ type: "closed" })}
          onSaved={async () => {
            setModal({ type: "closed" });
            await reload();
          }}
        />
      ) : null}
    </div>
  );
}
