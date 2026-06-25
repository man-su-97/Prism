import { PageHeader } from "@/components/layout/PageHeader";
import { ConnectedAccountsCard } from "@/components/settings/ConnectedAccountsCard";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ConnectedPage() {
  await requireSession();
  // Surface whether Google is configured server-side so the client doesn't
  // attempt linkSocial against a misconfigured provider.
  const googleEnabled =
    Boolean(process.env.GOOGLE_CLIENT_ID) &&
    Boolean(process.env.GOOGLE_CLIENT_SECRET);

  return (
    <>
      <PageHeader
        title="Connected accounts"
        description="External identities linked to your Prism account."
      />
      <div className="space-y-6 p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Sign-in providers</CardTitle>
            <CardDescription>
              Disconnecting Google also stops any Google Sheets datasets from
              refreshing until you reconnect.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConnectedAccountsCard googleEnabled={googleEnabled} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
