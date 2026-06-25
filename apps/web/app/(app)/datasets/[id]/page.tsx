import { LayoutDashboard } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { UpgradePlanButton } from "@/components/layout/UpgradePlanButton";
import { DatasetTabs } from "@/components/datasets/DatasetTabs";
import type { SchemaColumn } from "@/components/datasets/SchemaTable";
import { StatusBadge } from "@/components/datasets/StatusBadge";
import { DatasetStatusPoller } from "@/components/datasets/DatasetStatusPoller";
import { DatasetHeaderActions } from "@/components/datasets/DatasetHeaderActions";
import { RefreshSheetButton } from "@/components/datasets/RefreshSheetButton";
import { HeaderRowControl } from "@/components/datasets/HeaderRowControl";
import { AutoDashPoller } from "@/components/datasets/AutoDashPoller";
import { DashboardCard } from "@/components/dashboards/DashboardCard";
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

type DatasetDetail = {
  id: string;
  name: string;
  source_kind: string;
  status: string;
  row_count: number | null;
  size_bytes: number | null;
  error: string | null;
  created_at: string;
  columns: SchemaColumn[];
  header_offset: number | null;
  sheet_last_sync_at: string | null;
};

export default async function DatasetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let ds: DatasetDetail | null = null;
  let fetchError: string | null = null;
  try {
    ds = await backendJson<DatasetDetail>(`/api/datasets/${id}`);
  } catch (e) {
    fetchError = messageFromUnknown(e, "Couldn't load this dataset.");
  }

  if (!ds) {
    return (
      <main className="p-4 sm:p-6">
        <p className="text-destructive text-sm">{fetchError ?? "Not found."}</p>
      </main>
    );
  }

  const inFlight = ds.status === "pending" || ds.status === "ingesting";

  // Pull every dashboard scoped to this dataset (the API already filters by
  // org via RLS; we further restrict client-side). Used both for the body
  // listing and to seed the "Duplicate" picker inside the create dialog.
  let dashboards: DashboardSummary[] = [];
  if (ds.status === "ready") {
    try {
      const all = await backendJson<DashboardSummary[]>("/api/dashboards");
      dashboards = (all ?? [])
        .filter((d) => d.dataset_id === ds.id)
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime(),
        );
    } catch {
      dashboards = [];
    }
  }

  return (
    <>
      <PageHeader
        title={ds.name}
        actions={
          <>
            {ds.source_kind === "sheet" ? (
              <RefreshSheetButton datasetId={ds.id} lastSyncAt={ds.sheet_last_sync_at} />
            ) : null}
            {ds.status === "ready" ? (
              <NewDashboardDialog
                datasets={[{ id: ds.id, name: ds.name }]}
                datasetId={ds.id}
                existingNames={dashboards.map((d) => d.name)}
                sourceDashboards={dashboards.map((d) => ({
                  id: d.id,
                  name: d.name,
                  dataset_id: d.dataset_id,
                }))}
              />
            ) : null}
            <DatasetHeaderActions datasetId={ds.id} datasetName={ds.name} />
          </>
        }
      >
        <div className="text-muted-foreground mt-1 flex items-center gap-3 text-sm">
          <StatusBadge status={ds.status} />
          <span className="uppercase tracking-wide text-xs">
            {ds.source_kind}
          </span>
          <span className="text-xs">
            {ds.row_count != null
              ? `${ds.row_count.toLocaleString()} rows`
              : "—"}
          </span>
        </div>
      </PageHeader>

      <div className="space-y-6 p-4 sm:p-6">
        {inFlight ? <DatasetStatusPoller datasetId={ds.id} /> : null}

        {ds.source_kind !== "sheet" ? (
          <HeaderRowControl
            datasetId={ds.id}
            headerOffset={ds.header_offset}
          />
        ) : null}

        {ds.error ? (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardHeader>
              <CardTitle className="text-destructive text-sm">
                Ingestion error
              </CardTitle>
            </CardHeader>
            <CardContent className="text-destructive text-sm">
              {ds.error.replace(/^[a-z_]+:\s*/, "")}
            </CardContent>
            {ds.error.includes("Upgrade your plan") ? (
              <CardFooter className="border-0 bg-transparent pt-0 pb-4">
                <UpgradePlanButton />
              </CardFooter>
            ) : null}
          </Card>
        ) : null}

        {ds.status === "ready" ? (
          <section aria-labelledby="dataset-dashboards-heading" className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2
                id="dataset-dashboards-heading"
                className="text-sm font-semibold tracking-tight"
              >
                Dashboards
              </h2>
              <span className="text-muted-foreground text-xs tabular-nums">
                {dashboards.length} total
              </span>
            </div>
            {dashboards.length === 0 ? (
              <AutoDashPoller>
                <div className="border-border/60 bg-muted/20 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center">
                  <div className="text-muted-foreground bg-background flex size-10 items-center justify-center rounded-full border border-border/60">
                    <LayoutDashboard className="size-4" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">No dashboards yet</p>
                    <p className="text-muted-foreground text-xs">
                      The auto-generated dashboard didn&apos;t build, or it was
                      deleted. Create one to get started.
                    </p>
                  </div>
                  <NewDashboardDialog
                    datasets={[{ id: ds.id, name: ds.name }]}
                    datasetId={ds.id}
                    existingNames={[]}
                    sourceDashboards={[]}
                    trigger={
                      <Button size="sm" variant="outline">
                        Create dashboard
                      </Button>
                    }
                  />
                </div>
              </AutoDashPoller>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {dashboards.map((d) => (
                  <DashboardCard
                    key={d.id}
                    dashboard={d}
                    datasetName={ds.name}
                  />
                ))}
              </div>
            )}
          </section>
        ) : null}

        <DatasetTabs
          datasetId={ds.id}
          status={ds.status}
          rowCount={ds.row_count}
          columns={ds.columns}
        />
      </div>
    </>
  );
}
