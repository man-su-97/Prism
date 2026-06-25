import Link from "next/link";
import { notFound } from "next/navigation";

import { StatTile } from "@/components/admin/StatTile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AdminWorkspaceDetail } from "@/lib/admin-types";
import { backendAdminFetch } from "@/lib/backend";

export const dynamic = "force-dynamic";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function formatBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function datasetStatusAccent(
  status: string,
): "neutral" | "success" | "warning" | "danger" {
  if (status === "ready") return "success";
  if (status === "error") return "danger";
  return "warning";
}

export default async function AdminWorkspaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await backendAdminFetch(`/api/admin/workspaces/${id}`);
  if (res.status === 404) notFound();
  if (!res.ok) {
    return (
      <div className="p-4 sm:p-6">
        <Card>
          <CardContent className="pt-4 text-sm">
            Failed to load workspace. Status {res.status}.
          </CardContent>
        </Card>
      </div>
    );
  }
  const detail = (await res.json()) as AdminWorkspaceDetail;
  const w = detail.workspace;
  const pct = w.chat_tokens_limit
    ? Math.min(100, Math.round((w.chat_tokens_used / w.chat_tokens_limit) * 100))
    : 0;

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <Button asChild variant="ghost" size="sm" className="self-start">
          <Link href="/admin/workspaces">← Back to workspaces</Link>
        </Button>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{w.name}</h1>
          <Badge variant="outline" className="uppercase">
            {w.plan}
          </Badge>
          {w.status && (
            <Badge variant="outline" className="text-xs">
              {w.status}
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground text-sm">{w.slug}</p>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Members" value={w.member_count} />
        <StatTile label="Datasets" value={w.dataset_count} />
        <StatTile label="Dashboards" value={w.dashboard_count} />
        <StatTile
          label="Chat tokens used"
          value={`${w.chat_tokens_used} / ${w.chat_tokens_limit}`}
          hint={
            w.chat_tokens_period_end
              ? `Resets ${formatDate(w.chat_tokens_period_end)}`
              : undefined
          }
          accent={pct >= 90 ? "danger" : pct >= 70 ? "warning" : "neutral"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Plan & billing</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Plan</dt>
            <dd className="uppercase">{w.plan}</dd>
            <dt className="text-muted-foreground">Stripe status</dt>
            <dd>{w.status ?? "—"}</dd>
            <dt className="text-muted-foreground">Current period end</dt>
            <dd>{formatDate(w.current_period_end)}</dd>
            <dt className="text-muted-foreground">Chat tokens window</dt>
            <dd>
              <div className="flex max-w-xs flex-col gap-1">
                <Progress value={pct} className="h-1.5" />
                <span className="text-muted-foreground text-xs">
                  {w.chat_tokens_used} / {w.chat_tokens_limit}
                </span>
              </div>
            </dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Members ({detail.members.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {detail.members.length === 0 ? (
            <p className="text-muted-foreground text-sm">No members.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.members.map((m) => (
                  <TableRow key={m.user_id}>
                    <TableCell className="font-medium">{m.email}</TableCell>
                    <TableCell>{m.name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{m.role}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDate(m.joined_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/admin/users/${m.user_id}`}>View user</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Recent datasets ({detail.recent_datasets.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {detail.recent_datasets.length === 0 ? (
            <p className="text-muted-foreground text-sm">No datasets yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.recent_datasets.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          datasetStatusAccent(d.status) === "success"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : datasetStatusAccent(d.status) === "danger"
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-amber-600 dark:text-amber-400"
                        }
                      >
                        {d.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {d.row_count ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">{formatBytes(d.size_bytes)}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDate(d.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Recent dashboards ({detail.recent_dashboards.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {detail.recent_dashboards.length === 0 ? (
            <p className="text-muted-foreground text-sm">No dashboards yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">Widgets</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.recent_dashboards.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{d.kind}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{d.widget_count}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDate(d.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
