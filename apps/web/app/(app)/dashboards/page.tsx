import Link from "next/link";
import { LayoutDashboard, Upload } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { DashboardsListView } from "@/components/dashboards/DashboardsListView";
import { NewDashboardDialog } from "@/components/dashboards/NewDashboardDialog";
import { backendJson } from "@/lib/backend";
import { messageFromUnknown } from "@/lib/errors";

type DashboardSummary = {
  id: string;
  dataset_id: string;
  name: string;
  kind: string;
  created_at: string;
};

type DatasetSummary = {
  id: string;
  name: string;
};

export default async function DashboardsListPage() {
  let dashboards: DashboardSummary[] = [];
  let datasets: DatasetSummary[] = [];
  let error: string | null = null;
  try {
    [dashboards, datasets] = await Promise.all([
      backendJson<DashboardSummary[]>("/api/dashboards"),
      backendJson<DatasetSummary[]>("/api/datasets"),
    ]);
  } catch (e) {
    error = messageFromUnknown(e, "Couldn't load dashboards.");
  }

  const datasetsById: Record<string, DatasetSummary> = {};
  for (const d of datasets) datasetsById[d.id] = { id: d.id, name: d.name };

  const sourceDashboards = dashboards.map((d) => ({
    id: d.id,
    name: d.name,
    dataset_id: d.dataset_id,
  }));

  return (
    <>
      <PageHeader
        title="Dashboards"
        description="Auto-generated when a dataset finishes ingesting — tune them with the wizard or chat."
        actions={
          datasets.length > 0 ? (
            <NewDashboardDialog
              datasets={datasets}
              sourceDashboards={sourceDashboards}
            />
          ) : null
        }
      />
      <div className="space-y-6 p-4 sm:p-6">
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}

        {dashboards.length === 0 ? (
          <div className="relative overflow-hidden rounded-2xl border border-dashed border-border/60 bg-muted/20 px-6 py-16 text-center">
            <div className="bg-aurora animate-aurora pointer-events-none absolute inset-0 opacity-50" />
            <div className="relative flex flex-col items-center justify-center gap-3">
              <div className="bg-linear-to-br from-(--brand-from) via-(--brand-via) to-(--brand-to) flex size-12 items-center justify-center rounded-2xl text-white shadow-[0_8px_24px_-6px_oklch(from_var(--primary)_l_c_h/0.35)]">
                <LayoutDashboard className="size-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold">No dashboards yet</h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Upload a dataset and we&apos;ll build a starter dashboard for you.
                </p>
              </div>
              <Button asChild className="mt-2">
                <Link href="/datasets">
                  <Upload className="size-4" />
                  Upload dataset
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <DashboardsListView
            dashboards={dashboards}
            datasetsById={datasetsById}
          />
        )}
      </div>
    </>
  );
}
