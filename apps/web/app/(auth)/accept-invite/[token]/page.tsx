"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { authClient, useSession } from "@/lib/auth-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Status = "idle" | "accepting" | "success" | "error";

export default function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const router = useRouter();
  const { token } = use(params);
  const { data: session, isPending } = useSession();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isPending) return;
    if (!session?.user) {
      router.replace(`/login?next=${encodeURIComponent(`/accept-invite/${token}`)}`);
      return;
    }

    async function accept() {
      setStatus("accepting");
      const result = await authClient.organization.acceptInvitation({
        invitationId: token,
      });
      if (result.error) {
        setStatus("error");
        setMessage(result.error.message ?? "Invitation could not be accepted.");
        return;
      }
      setStatus("success");
      setTimeout(() => router.replace("/"), 1200);
    }

    void accept();
  }, [isPending, session, token, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Joining workspace</CardTitle>
        <CardDescription>
          Validating your invitation token.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status === "accepting" || status === "idle" ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Hold on a moment.
          </div>
        ) : null}
        {status === "success" ? (
          <div className="text-success flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4" />
            You&apos;re in. Redirecting…
          </div>
        ) : null}
        {status === "error" ? (
          <div className="text-destructive flex items-start gap-2 text-sm">
            <XCircle className="mt-0.5 size-4 shrink-0" />
            <span>{message}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
