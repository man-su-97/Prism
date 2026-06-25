import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AdminUserDetail } from "@/lib/admin-types";
import { backendAdminFetch } from "@/lib/backend";

export const dynamic = "force-dynamic";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // probe response so we can distinguish 404 from generic error
  const res = await backendAdminFetch(`/api/admin/users/${id}`);
  if (res.status === 404) notFound();
  if (!res.ok) {
    return (
      <div className="p-4 sm:p-6">
        <Card>
          <CardContent className="pt-4 text-sm">
            Failed to load user. Status {res.status}.
          </CardContent>
        </Card>
      </div>
    );
  }
  const user = (await res.json()) as AdminUserDetail;

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <Button asChild variant="ghost" size="sm" className="self-start">
          <Link href="/admin/users">← Back to users</Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">
          {user.name ?? user.email}
        </h1>
        <p className="text-muted-foreground text-sm">{user.email}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">User ID</dt>
            <dd className="font-mono text-xs">{user.id}</dd>
            <dt className="text-muted-foreground">Email verified</dt>
            <dd>
              {user.email_verified ? (
                <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400">
                  yes
                </Badge>
              ) : (
                <Badge variant="outline" className="text-amber-600 dark:text-amber-400">
                  no
                </Badge>
              )}
            </dd>
            <dt className="text-muted-foreground">Joined</dt>
            <dd>{formatDate(user.created_at)}</dd>
            <dt className="text-muted-foreground">Last updated</dt>
            <dd>{formatDate(user.updated_at)}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Workspaces ({user.memberships.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {user.memberships.length === 0 ? (
            <p className="text-muted-foreground text-sm">No workspace memberships.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {user.memberships.map((m) => (
                  <TableRow key={m.organization_id}>
                    <TableCell>
                      <div className="font-medium">{m.name}</div>
                      <div className="text-muted-foreground text-xs">{m.slug}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{m.role}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDate(m.joined_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/admin/workspaces/${m.organization_id}`}>
                          Open
                        </Link>
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
          <CardTitle className="text-sm font-medium">Recent sessions</CardTitle>
        </CardHeader>
        <CardContent>
          {user.recent_sessions.length === 0 ? (
            <p className="text-muted-foreground text-sm">No sessions on record.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>User agent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {user.recent_sessions.map((ss, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="text-xs">{formatDate(ss.updated_at)}</TableCell>
                    <TableCell className="text-xs">{formatDate(ss.created_at)}</TableCell>
                    <TableCell className="text-xs">{formatDate(ss.expires_at)}</TableCell>
                    <TableCell className="text-xs">{ss.ip_address ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate text-xs">
                      {ss.user_agent ?? "—"}
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
