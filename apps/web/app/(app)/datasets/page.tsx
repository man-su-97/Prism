import { Database } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import GenerateDashboardDialog from "@/components/datasets/GenerateDashboardDialog";
import { DatasetsListView } from "@/components/datasets/DatasetsListView";
import { backendJson } from "@/lib/backend";
import { messageFromUnknown } from "@/lib/errors";

export const dynamic = "force-dynamic";

type Dataset = {
  id: string;
  name: string;
  source_kind: string;
  status: string;
  row_count: number | null;
  size_bytes: number | null;
  created_at: string;
};

type DashboardSummary = {
  id: string;
  dataset_id: string;
  name: string;
  kind: string;
  created_at: string;
};

export default async function DatasetsListPage() {
  let datasets: Dataset[] = [];
  let dashboards: DashboardSummary[] = [];
  let error: string | null = null;
  try {
    [datasets, dashboards] = await Promise.all([
      backendJson<Dataset[]>("/api/datasets"),
      backendJson<DashboardSummary[]>("/api/dashboards"),
    ]);
  } catch (e) {
    error = messageFromUnknown(e, "Couldn't load datasets.");
  }

  // First dashboard per dataset (list endpoint is ordered created_at DESC, so
  // this picks the most recent — typically the autodash).
  const dashboardByDataset: Record<string, string> = {};
  for (const d of dashboards) {
    if (!(d.dataset_id in dashboardByDataset)) {
      dashboardByDataset[d.dataset_id] = d.id;
    }
  }

  return (
    <>
      <PageHeader
        title="Datasets"
        description="Upload a CSV/XLSX or connect a Google Sheet. We'll profile it and build a starter dashboard."
        actions={<GenerateDashboardDialog />}
      />
      <div className="space-y-6 p-4 sm:p-6">
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}

        {datasets.length === 0 ? (
          <div className="relative overflow-hidden rounded-2xl border border-dashed border-border/60 bg-muted/20 px-6 py-16 text-center">
            <div className="bg-aurora animate-aurora pointer-events-none absolute inset-0 opacity-50" />
            <div className="relative flex flex-col items-center justify-center gap-3">
              <div className="bg-linear-to-br from-(--brand-from) via-(--brand-via) to-(--brand-to) flex size-12 items-center justify-center rounded-2xl text-white shadow-[0_8px_24px_-6px_oklch(from_var(--primary)_l_c_h/0.35)]">
                <Database className="size-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold">No datasets yet</h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Upload a CSV, XLSX, or connect a Google Sheet — we&apos;ll build a starter dashboard for you.
                </p>
              </div>
              <div className="mt-2">
                <GenerateDashboardDialog />
              </div>
            </div>
          </div>
        ) : (
          <DatasetsListView
            datasets={datasets}
            dashboardByDataset={dashboardByDataset}
          />
        )}
      </div>
    </>
  );
}
