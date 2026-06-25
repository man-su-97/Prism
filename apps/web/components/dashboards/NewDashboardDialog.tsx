"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUpgradePrompt } from "@/components/upgrade/UpgradePromptProvider";
import { buildApiError, LimitError, messageFromUnknown } from "@/lib/errors";

type DatasetRef = { id: string; name: string };
type DashboardRef = { id: string; name: string; dataset_id: string };

type CreatedDashboard = {
  id: string;
  dataset_id: string;
  name: string;
  kind: string;
  created_at: string;
};

type Mode = "blank" | "duplicate";

export type NewDashboardDialogProps = {
  /** Datasets the user can attach a new dashboard to. */
  datasets: DatasetRef[];
  /**
   * Pre-select a dataset (hides the dataset picker). Used from the dataset
   * detail page where the dataset context is fixed.
   */
  datasetId?: string;
  /**
   * Dashboards available for the Duplicate mode. Should be scoped to the
   * chosen dataset. When `datasetId` is fixed, pass the dataset's own
   * dashboards. When the user picks a dataset inside the dialog, the dialog
   * will fetch this list on demand.
   */
  sourceDashboards?: DashboardRef[];
  /** Existing dashboard names for the chosen dataset — drives placeholder hints. */
  existingNames?: string[];
  /** Custom trigger; defaults to a primary "New dashboard" button. */
  trigger?: React.ReactNode;
};

function deriveDefaultName(
  mode: Mode,
  datasetName: string,
  sourceName: string | null,
  existingNames: string[],
): string {
  const base =
    mode === "duplicate"
      ? sourceName
        ? `${sourceName} (copy)`
        : "Dashboard (copy)"
      : datasetName || "Untitled dashboard";
  const taken = new Set(existingNames);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

async function fetchDashboards(): Promise<DashboardRef[]> {
  const res = await fetch(
    `/dashboards/api?path=${encodeURIComponent("/api/dashboards")}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw await buildApiError(res);
  return (await res.json()) as DashboardRef[];
}

export function NewDashboardDialog({
  datasets,
  datasetId,
  sourceDashboards,
  existingNames,
  trigger,
}: NewDashboardDialogProps) {
  const router = useRouter();
  const { openUpgrade } = useUpgradePrompt();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("blank");
  const [selectedDataset, setSelectedDataset] = useState<string>(
    datasetId ?? "",
  );
  const [name, setName] = useState("");
  const [sourceId, setSourceId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dynamic sources when the dataset is chosen inside the dialog. When
  // `datasetId` is fixed we just use the parent-supplied `sourceDashboards`.
  const [fetchedDashboards, setFetchedDashboards] = useState<
    DashboardRef[] | null
  >(null);

  useEffect(() => {
    if (!open) return;
    if (datasetId) return;
    if (!selectedDataset) {
      setFetchedDashboards(null);
      return;
    }
    let cancelled = false;
    fetchDashboards()
      .then((list) => {
        if (!cancelled) setFetchedDashboards(list);
      })
      .catch(() => {
        if (!cancelled) setFetchedDashboards([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedDataset, datasetId]);

  const datasetById = useMemo(() => {
    const m = new Map<string, DatasetRef>();
    for (const d of datasets) m.set(d.id, d);
    return m;
  }, [datasets]);

  const scopedDashboards: DashboardRef[] = useMemo(() => {
    if (!selectedDataset) return [];
    if (datasetId) return sourceDashboards ?? [];
    return (fetchedDashboards ?? []).filter(
      (d) => d.dataset_id === selectedDataset,
    );
  }, [datasetId, selectedDataset, sourceDashboards, fetchedDashboards]);

  const scopedExistingNames: string[] = useMemo(() => {
    if (datasetId) return existingNames ?? [];
    return scopedDashboards.map((d) => d.name);
  }, [datasetId, existingNames, scopedDashboards]);

  const datasetName =
    datasetById.get(selectedDataset)?.name ??
    (datasetId ? datasets[0]?.name : "") ??
    "";

  const sourceName = useMemo(() => {
    if (mode !== "duplicate" || !sourceId) return null;
    return scopedDashboards.find((d) => d.id === sourceId)?.name ?? null;
  }, [mode, sourceId, scopedDashboards]);

  const namePlaceholder = useMemo(
    () =>
      selectedDataset
        ? deriveDefaultName(mode, datasetName, sourceName, scopedExistingNames)
        : "Pick a dataset first",
    [mode, datasetName, sourceName, scopedExistingNames, selectedDataset],
  );

  function resetForm() {
    setMode("blank");
    setName("");
    setSourceId("");
    setError(null);
    if (!datasetId) setSelectedDataset("");
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Defer reset so the close animation doesn't visually flicker.
      setTimeout(resetForm, 200);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (!selectedDataset) {
      setError("Pick a dataset first.");
      return;
    }
    if (mode === "duplicate" && !sourceId) {
      setError("Pick a dashboard to duplicate.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(
        `/dashboards/api?path=${encodeURIComponent("/api/dashboards")}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dataset_id: selectedDataset,
            mode,
            name: name.trim() ? name.trim() : null,
            source_dashboard_id: mode === "duplicate" ? sourceId : null,
          }),
        },
      );
      if (!res.ok) throw await buildApiError(res);
      const created = (await res.json()) as CreatedDashboard;

      toast.success(`Created "${created.name}".`);
      setOpen(false);
      resetForm();
      router.push(`/dashboards/${created.id}`);
    } catch (e) {
      if (e instanceof LimitError) {
        setOpen(false);
        openUpgrade({ code: e.code, message: e.message });
        return;
      }
      setError(messageFromUnknown(e, "Couldn't create dashboard."));
    } finally {
      setBusy(false);
    }
  }

  const showDatasetPicker = !datasetId;
  const canSubmit =
    !busy &&
    !!selectedDataset &&
    (mode === "blank" || (mode === "duplicate" && !!sourceId));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" />
            New dashboard
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New dashboard</DialogTitle>
          <DialogDescription>
            Start blank, or duplicate one of this dataset&apos;s existing
            dashboards.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-5">
          {showDatasetPicker ? (
            <div className="space-y-2.5">
              <Label htmlFor="new-dashboard-dataset">Dataset</Label>
              <Select
                value={selectedDataset || undefined}
                onValueChange={(v) => {
                  setSelectedDataset(v);
                  setSourceId("");
                }}
                disabled={busy || datasets.length === 0}
              >
                <SelectTrigger
                  id="new-dashboard-dataset"
                  aria-label="Dataset"
                  className="w-full"
                >
                  <SelectValue
                    placeholder={
                      datasets.length === 0
                        ? "No datasets yet — upload one first"
                        : "Pick a dataset"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {datasets.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <Tabs
            value={mode}
            onValueChange={(v) => setMode(v as Mode)}
            className="min-w-0"
          >
            <TabsList className="w-full">
              <TabsTrigger value="blank">Blank</TabsTrigger>
              <TabsTrigger
                value="duplicate"
                disabled={!selectedDataset || scopedDashboards.length === 0}
              >
                Duplicate
              </TabsTrigger>
            </TabsList>
            <TabsContent value="blank" className="min-w-0 pt-3">
              <p className="text-muted-foreground text-xs">
                An empty dashboard you can fill in with the widget wizard.
              </p>
            </TabsContent>
            <TabsContent value="duplicate" className="min-w-0 space-y-2 pt-3">
              <Label htmlFor="new-dashboard-source">Dashboard to copy</Label>
              <Select
                value={sourceId || undefined}
                onValueChange={setSourceId}
                disabled={busy || scopedDashboards.length === 0}
              >
                <SelectTrigger
                  id="new-dashboard-source"
                  aria-label="Source dashboard"
                  className="w-full"
                >
                  <SelectValue
                    placeholder={
                      scopedDashboards.length === 0
                        ? "No dashboards to duplicate yet"
                        : "Pick a dashboard"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {scopedDashboards.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Widgets and layout are cloned; the copy is fully independent
                of the original.
              </p>
            </TabsContent>
          </Tabs>

          <div className="space-y-2.5">
            <Label htmlFor="new-dashboard-name">Name (optional)</Label>
            <Input
              id="new-dashboard-name"
              value={name}
              disabled={busy}
              placeholder={namePlaceholder}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {error ? (
            <p className="text-destructive text-xs" role="alert">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {busy ? "Creating…" : "Create dashboard"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
