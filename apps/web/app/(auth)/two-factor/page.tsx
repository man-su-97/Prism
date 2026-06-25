import { TwoFactorVerifyForm } from "@/components/auth/TwoFactorVerifyForm";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function TwoFactorPage({
  searchParams,
}: {
  // Next 16 — searchParams is async.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const redirectRaw = params.redirect;
  const redirect =
    typeof redirectRaw === "string" && redirectRaw.startsWith("/")
      ? redirectRaw
      : "/";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor verification</CardTitle>
        <CardDescription>
          Open your authenticator app and enter the 6-digit code, or use a
          backup code if you don&apos;t have access to it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TwoFactorVerifyForm redirectTo={redirect} />
      </CardContent>
    </Card>
  );
}
