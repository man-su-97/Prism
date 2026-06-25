import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AdminWorkspaceList } from "@/lib/admin-types";
import { backendAdminJson } from "@/lib/backend";

export const dynamic = "force-dynamic";

type SearchParams = { search?: string; plan?: string; cursor?: string };

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function planBadgeVariant(plan: string): "default" | "secondary" | "outline" {
  if (plan === "team") return "default";
  if (plan === "pro") return "secondary";
  return "outline";
}

export default async function AdminWorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  params.set("limit", "50");
  if (sp.search) params.set("search", sp.search);
  if (sp.plan) params.set("plan", sp.plan);
  if (sp.cursor) params.set("cursor", sp.cursor);

  const data = await backendAdminJson<AdminWorkspaceList>(
    `/api/admin/workspaces?${params.toString()}`,
  );

  const nextHref = data.next_cursor
    ? `/admin/workspaces?${(() => {
        const p = new URLSearchParams();
        if (sp.search) p.set("search", sp.search);
        if (sp.plan) p.set("plan", sp.plan);
        p.set("cursor", data.next_cursor!);
        return p.toString();
      })()}`
    : null;

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Workspaces</h1>
        <p className="text-muted-foreground text-sm">
          {data.items.length} shown
          {data.next_cursor ? " · more available" : ""}
        </p>
      </header>

      <Card>
        <CardContent className="pt-4">
          <form className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              name="search"
              defaultValue={sp.search ?? ""}
              placeholder="Search by name or slug…"
              className="max-w-sm"
            />
            <select
              name="plan"
              defaultValue={sp.plan ?? ""}
              className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
            >
              <option value="">All plans</option>
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="team">Team</option>
            </select>
            <Button type="submit" size="sm">
              Filter
            </Button>
            {(sp.search || sp.plan) && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin/workspaces">Clear</Link>
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead className="text-right">Datasets</TableHead>
                <TableHead className="text-right">Dashboards</TableHead>
                <TableHead className="w-48">Chat tokens</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground text-center">
                    No workspaces match.
                  </TableCell>
                </TableRow>
              )}
              {data.items.map((w) => {
                const pct = w.chat_tokens_limit
                  ? Math.min(100, Math.round((w.chat_tokens_used / w.chat_tokens_limit) * 100))
                  : 0;
                return (
                  <TableRow key={w.id}>
                    <TableCell>
                      <div className="font-medium">{w.name}</div>
                      <div className="text-muted-foreground text-xs">{w.slug}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={planBadgeVariant(w.plan)} className="uppercase">
                        {w.plan}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{w.member_count}</TableCell>
                    <TableCell className="text-right tabular-nums">{w.dataset_count}</TableCell>
                    <TableCell className="text-right tabular-nums">{w.dashboard_count}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Progress value={pct} className="h-1.5" />
                        <span className="text-muted-foreground text-xs">
                          {w.chat_tokens_used} / {w.chat_tokens_limit}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDate(w.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/admin/workspaces/${w.id}`}>View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {nextHref && (
        <div className="flex justify-center">
          <Button asChild variant="outline" size="sm">
            <Link href={nextHref}>Load more</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
