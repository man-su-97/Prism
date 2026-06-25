import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AdminUserList } from "@/lib/admin-types";
import { backendAdminJson } from "@/lib/backend";

export const dynamic = "force-dynamic";

type SearchParams = { search?: string; cursor?: string };

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  params.set("limit", "50");
  if (sp.search) params.set("search", sp.search);
  if (sp.cursor) params.set("cursor", sp.cursor);

  const data = await backendAdminJson<AdminUserList>(
    `/api/admin/users?${params.toString()}`,
  );

  const nextHref = data.next_cursor
    ? `/admin/users?${(() => {
        const p = new URLSearchParams();
        if (sp.search) p.set("search", sp.search);
        p.set("cursor", data.next_cursor!);
        return p.toString();
      })()}`
    : null;

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-muted-foreground text-sm">
          {data.items.length} shown
          {data.next_cursor ? " · more available" : ""}
        </p>
      </header>

      <Card>
        <CardContent className="pt-4">
          <form className="flex items-center gap-2">
            <Input
              type="search"
              name="search"
              defaultValue={sp.search ?? ""}
              placeholder="Search by email or name…"
              className="max-w-sm"
            />
            <Button type="submit" size="sm">
              Search
            </Button>
            {sp.search && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin/users">Clear</Link>
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
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Workspaces</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Last active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground text-center">
                    No users found.
                  </TableCell>
                </TableRow>
              )}
              {data.items.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    {u.email}{" "}
                    {!u.email_verified && (
                      <Badge variant="outline" className="ml-1 text-xs">
                        unverified
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{u.name ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{u.workspace_count}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDate(u.created_at)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDate(u.last_active_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/admin/users/${u.id}`}>View</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
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
