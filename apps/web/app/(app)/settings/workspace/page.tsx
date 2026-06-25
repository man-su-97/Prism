import { headers } from "next/headers";
import { UserRound } from "lucide-react";

import { InviteForm } from "@/components/auth/InviteForm";
import { PageHeader } from "@/components/layout/PageHeader";
import { DeleteWorkspaceSection } from "@/components/settings/DeleteWorkspaceSection";
import { InvitationList } from "@/components/settings/InvitationList";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { auth } from "@/lib/auth";
import { requireActiveOrg } from "@/lib/session";

export default async function WorkspaceSettingsPage() {
  // Use requireActiveOrg, not session.activeOrganizationId — the cookieCache
  // (see lib/auth.ts) can hold a stale null after a fresh login, while the
  // user actually has workspaces. requireActiveOrg falls back to the DB.
  const session = await requireActiveOrg();
  const activeWorkspaceId = session.session.activeOrganizationId!;
  const hdrs = await headers();

  const [fullWorkspace, workspaces] = await Promise.all([
    auth.api.getFullOrganization({
      headers: hdrs,
      query: { organizationId: activeWorkspaceId },
    }),
    auth.api.listOrganizations({ headers: hdrs }),
  ]);

  const members = fullWorkspace?.members ?? [];
  const invitations = fullWorkspace?.invitations ?? [];

  // Owner-only affordance. The dialog itself surfaces the last_workspace
  // block (when workspaces.length <= 1) and any post-preview race the server
  // detects, so we render the card whenever the caller is the owner.
  const myMembership = members.find((m) => m.userId === session.user.id);
  const isOwner = myMembership?.role === "owner";
  const nextWorkspace = (workspaces ?? []).find(
    (w) => w.id !== activeWorkspaceId,
  );

  return (
    <>
      <PageHeader
        title="Workspace"
        description={fullWorkspace?.name ?? undefined}
      />
      <div className="space-y-6 p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              People with access to this workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {members.length === 0 ? (
              <p className="text-muted-foreground text-sm">No members yet.</p>
            ) : (
              <ul className="divide-y">
                {members.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-center gap-3">
                      <div className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-full">
                        <UserRound className="size-4" />
                      </div>
                      <div className="text-sm">
                        <div className="font-medium">
                          {m.user?.email ?? m.userId}
                        </div>
                      </div>
                    </div>
                    <Badge variant="outline" className="capitalize">
                      {m.role}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invitations</CardTitle>
            <CardDescription>
              Invite a teammate by email. They&apos;ll get a join link.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <InviteForm organizationId={activeWorkspaceId} />
            {invitations.length > 0 ? (
              <>
                <Separator />
                <InvitationList
                  invitations={invitations}
                  organizationId={activeWorkspaceId}
                />
              </>
            ) : null}
          </CardContent>
        </Card>

        {isOwner ? (
          <DeleteWorkspaceSection
            workspaceName={fullWorkspace?.name ?? "this workspace"}
            nextWorkspaceId={nextWorkspace?.id ?? null}
          />
        ) : null}
      </div>
    </>
  );
}
