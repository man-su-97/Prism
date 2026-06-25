import { PageHeader } from "@/components/layout/PageHeader";
import { DeleteAccountPanel } from "@/components/settings/DeleteAccountPanel";
import { PersonalizationCard } from "@/components/settings/PersonalizationCard";
import { ProfileForm } from "@/components/settings/ProfileForm";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { pool } from "@/lib/db";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

async function userHasPassword(userId: string): Promise<boolean> {
  // Mirrors the lookup used by /settings/security so the delete flow can
  // show a password input only when one would actually be checked.
  const client = await pool().connect();
  try {
    const res = await client.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM "account"
         WHERE "userId" = $1 AND "providerId" = 'credential' AND "password" IS NOT NULL
       ) AS exists`,
      [userId],
    );
    return res.rows[0]?.exists ?? false;
  } finally {
    client.release();
  }
}

export default async function ProfilePage() {
  const session = await requireSession();
  const hasPassword = await userHasPassword(session.user.id);

  return (
    <>
      <PageHeader
        title="Profile"
        description="Manage your personal account."
      />
      <div className="space-y-6 p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Personal information</CardTitle>
            <CardDescription>
              Update the name we display on your account. Email changes go
              through verification and aren&apos;t supported here yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm
              initialName={session.user.name ?? ""}
              email={session.user.email}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Personalization</CardTitle>
            <CardDescription>
              Theme and density preferences for this browser.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PersonalizationCard />
          </CardContent>
        </Card>

        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Danger zone</CardTitle>
            <CardDescription>
              Permanently delete your account and any workspaces you&apos;re
              the only member of. This can&apos;t be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeleteAccountPanel
              email={session.user.email}
              hasPassword={hasPassword}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
