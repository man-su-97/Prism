import { MiniLineChart } from "@/components/admin/MiniLineChart";
import { StatTile } from "@/components/admin/StatTile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  AdminOverview,
  AdminTimeSeries,
} from "@/lib/admin-types";
import { backendAdminJson } from "@/lib/backend";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const [overview, signups, chat] = await Promise.all([
    backendAdminJson<AdminOverview>("/api/admin/overview"),
    backendAdminJson<AdminTimeSeries>("/api/admin/usage/signups?days=30"),
    backendAdminJson<AdminTimeSeries>("/api/admin/usage/chat?days=30"),
  ]);

  const planEntries = Object.entries(overview.workspaces_by_plan).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-muted-foreground text-sm">
          Generated {new Date(overview.generated_at).toLocaleString()}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Total users"
          value={overview.total_users}
          hint={`+${overview.new_users_7d} in last 7d`}
        />
        <StatTile
          label="Workspaces"
          value={overview.total_workspaces}
          hint={`+${overview.new_workspaces_7d} in last 7d`}
        />
        <StatTile
          label="Active 24h"
          value={overview.active_sessions_24h}
          hint="sessions touched"
        />
        <StatTile
          label="Chat msgs 30d"
          value={overview.chat_messages_30d}
          hint="user role only"
        />
        <StatTile
          label="Datasets"
          value={overview.datasets_total}
          hint="across all workspaces"
        />
        <StatTile
          label="Datasets in error"
          value={overview.datasets_in_error}
          accent={overview.datasets_in_error > 0 ? "danger" : "success"}
          hint={overview.datasets_in_error > 0 ? "needs investigation" : "all green"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              New users · last {signups.days} days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MiniLineChart points={signups.points} />
            <div className="text-muted-foreground mt-2 text-xs">
              {signups.total} signups in window
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Chat messages · last {chat.days} days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MiniLineChart points={chat.points} />
            <div className="text-muted-foreground mt-2 text-xs">
              {chat.total} user messages in window
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Workspaces by plan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {planEntries.map(([plan, count]) => (
              <div
                key={plan}
                className="border-border/60 bg-muted/30 flex flex-col rounded-md border px-4 py-2"
              >
                <span className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                  {plan}
                </span>
                <span className="text-foreground text-xl font-semibold tabular-nums">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
