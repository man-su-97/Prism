import Link from "next/link";

import { PageHeader } from "@/components/layout/PageHeader";
import { PasswordForm } from "@/components/settings/PasswordForm";
import { TwoFactorPanel } from "@/components/settings/TwoFactorPanel";
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

async function loadFlags(userId: string) {
  const client = await pool().connect();
  try {
    const passwordRes = await client.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM "account"
         WHERE "userId" = $1 AND "providerId" = 'credential' AND "password" IS NOT NULL
       ) AS exists`,
      [userId],
    );
    const tfaRes = await client.query<{ enabled: boolean | null }>(
      'SELECT "twoFactorEnabled" AS enabled FROM "user" WHERE id = $1',
      [userId],
    );
    return {
      hasPassword: passwordRes.rows[0]?.exists ?? false,
      twoFactorEnabled: tfaRes.rows[0]?.enabled ?? false,
    };
  } finally {
    client.release();
  }
}

export default async function SecurityPage() {
  const session = await requireSession();
  const { hasPassword, twoFactorEnabled } = await loadFlags(session.user.id);

  return (
    <>
      <PageHeader
        title="Security"
        description="Password and two-factor authentication."
      />
      <div className="space-y-6 p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>
              Use a unique password you don&apos;t use on any other site.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasPassword ? (
              <PasswordForm />
            ) : (
              <p className="text-muted-foreground text-sm">
                Your account signs in via Google. To set a password, link an
                email/password method from the{" "}
                <Link
                  href="/settings/connected"
                  className="text-foreground underline"
                >
                  Connected accounts
                </Link>{" "}
                page first.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Two-factor authentication</CardTitle>
            <CardDescription>
              Require a 6-digit authenticator code in addition to your password
              when signing in.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TwoFactorPanel
              initiallyEnabled={twoFactorEnabled}
              passwordRequired={hasPassword}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
