import { headers } from "next/headers";

import { HomeHero } from "@/components/home/HomeHero";
import { RecentDashboardsStrip, type DashboardItem } from "@/components/home/RecentDashboardsStrip";
import { RecentDatasetsCard, type DatasetItem } from "@/components/home/RecentDatasetsCard";
import { StatTiles } from "@/components/home/StatTiles";
import { TipsCard } from "@/components/home/TipsCard";
import { auth } from "@/lib/auth";
import { backendJson } from "@/lib/backend";
import { requireActiveOrg } from "@/lib/session";

// Per-request: session cookie + live counts.
export const dynamic = "force-dynamic";

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
  source_kind: string;
  status: string;
  row_count: number | null;
  size_bytes: number | null;
  created_at: string;
};

type PlanResponse = {
  plan: {
    name: string;
    max_datasets: number;
  };
};

async function safeJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return await backendJson<T>(path);
  } catch {
    return fallback;
  }
}

export default async function HomePage() {
  const session = await requireActiveOrg();
  const activeWorkspaceId = session.session.activeOrganizationId!;
  const userName = session.user.name ?? session.user.email;

  const [dashboards, datasets, plan, fullWorkspace] = await Promise.all([
    safeJson<DashboardSummary[]>("/api/dashboards", []),
    safeJson<DatasetSummary[]>("/api/datasets", []),
    safeJson<PlanResponse | null>("/api/billing/plan", null),
    auth.api
      .getFullOrganization({
        headers: await headers(),
        query: { organizationId: activeWorkspaceId },
      })
      .catch(() => null),
  ]);

  const datasetsById = new Map<string, DatasetSummary>(
    datasets.map((d) => [d.id, d] as const),
  );

  const recentDashboards: DashboardItem[] = [...dashboards]
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    .slice(0, 6)
    .map((d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      created_at: d.created_at,
      dataset_name: datasetsById.get(d.dataset_id)?.name ?? null,
    }));

  const recentDatasets: DatasetItem[] = [...datasets]
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    .slice(0, 5)
    .map((d) => ({
      id: d.id,
      name: d.name,
      source_kind: d.source_kind,
      status: d.status,
      row_count: d.row_count,
    }));

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <HomeHero
        name={userName}
        workspaceName={fullWorkspace?.name ?? null}
        primaryDashboardHref={
          recentDashboards.length > 0 ? `/dashboards/${recentDashboards[0]!.id}` : null
        }
        hasDashboards={recentDashboards.length > 0}
      />

      <StatTiles
        datasetCount={datasets.length}
        dashboardCount={dashboards.length}
        planName={plan?.plan.name ?? "Free"}
        datasetCap={plan?.plan.max_datasets ?? 0}
      />

      <RecentDashboardsStrip items={recentDashboards} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentDatasetsCard items={recentDatasets} />
        </div>
        <div>
          <TipsCard />
        </div>
      </div>
    </div>
  );
}
