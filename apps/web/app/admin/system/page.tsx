import { StatTile } from "@/components/admin/StatTile";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminSystemHealth } from "@/lib/admin-types";
import { backendAdminJson } from "@/lib/backend";

export const dynamic = "force-dynamic";

export default async function AdminSystemPage() {
  const data = await backendAdminJson<AdminSystemHealth>("/api/admin/system/health");

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">System</h1>
        <p className="text-muted-foreground text-sm">
          Snapshot generated {new Date(data.generated_at).toLocaleString()}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Backing services</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 text-sm">
            <Badge
              variant="outline"
              className={
                data.postgres_ok
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              }
            >
              Postgres {data.postgres_ok ? "ok" : "down"}
            </Badge>
            <Badge
              variant="outline"
              className={
                data.redis_ok
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              }
            >
              Redis {data.redis_ok ? "ok" : "down"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Arq queue depth"
          value={data.arq_queue_depth}
          hint="jobs waiting"
          accent={data.arq_queue_depth > 50 ? "warning" : "neutral"}
        />
        <StatTile
          label="Arq in-progress"
          value={data.arq_in_progress}
          hint="active workers"
        />
        <StatTile
          label="Datasets in error"
          value={data.datasets_error_count}
          accent={data.datasets_error_count > 0 ? "danger" : "success"}
        />
        <StatTile
          label="PG connections"
          value={data.pg_connection_count}
          hint="current database"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Notes</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-2 text-sm">
          <p>
            Arq queue depth is read from the Redis sorted set <code>arq:queue</code>.
            If <code>WorkerSettings.queue_name</code> is customised in
            <code> apps/api/app/worker.py</code>, the key in
            <code> apps/api/app/routers/admin.py</code> must follow.
          </p>
          <p>
            In-progress count comes from scanning <code>arq:in-progress:*</code>{" "}
            with a 1000-key cap; counts above that ceiling will under-report.
          </p>
          <p>
            For full request-latency / status-code metrics, scrape the
            <code> /metrics</code> endpoint from Prometheus rather than reading
            from this page.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
