"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Loader2, Mail, RefreshCw, X } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
};

function InvitationRow({
  inv,
  organizationId,
}: {
  inv: Invitation;
  organizationId: string;
}) {
  const router = useRouter();
  const [resending, setResending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPending = inv.status === "pending";

  async function handleResend() {
    setResending(true);
    setError(null);
    const result = await authClient.organization.inviteMember({
      email: inv.email,
      role: inv.role as "member" | "admin" | "owner",
      organizationId,
      resend: true,
    });
    setResending(false);
    if (result.error) {
      setError(result.error.message ?? "Could not resend invitation.");
      return;
    }
    setResent(true);
    // brief confirmation, then restore normal state
    setTimeout(() => setResent(false), 2000);
    router.refresh();
  }

  async function handleCancel() {
    setCancelling(true);
    setError(null);
    const result = await authClient.organization.cancelInvitation({
      invitationId: inv.id,
    });
    setCancelling(false);
    if (result.error) {
      setError(result.error.message ?? "Could not cancel invitation.");
      return;
    }
    router.refresh();
  }

  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        {/* left: icon + email + role */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full">
            <Mail className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm">{inv.email}</p>
            <p className="text-muted-foreground text-xs capitalize">{inv.role}</p>
          </div>
        </div>

        {/* right: actions + status */}
        <div className="flex shrink-0 items-center gap-2">
          {isPending ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 gap-1.5 px-2 text-xs",
                  resent && "text-success",
                )}
                disabled={resending || cancelling}
                onClick={handleResend}
                title="Resend invitation email"
              >
                {resending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : resent ? (
                  <Check className="size-3" />
                ) : (
                  <RefreshCw className="size-3" />
                )}
                {resent ? "Sent" : "Resend"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive h-7 gap-1.5 px-2 text-xs"
                disabled={resending || cancelling}
                onClick={handleCancel}
                title="Cancel invitation"
              >
                {cancelling ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <X className="size-3" />
                )}
                Cancel
              </Button>
            </>
          ) : null}
          <Badge variant="outline" className="capitalize">
            {inv.status}
          </Badge>
        </div>
      </div>

      {error ? (
        <p className="text-destructive mt-1.5 pl-11 text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function InvitationList({
  invitations,
  organizationId,
}: {
  invitations: Invitation[];
  organizationId: string;
}) {
  if (invitations.length === 0) return null;

  return (
    <ul className="divide-y">
      {invitations.map((inv) => (
        <InvitationRow key={inv.id} inv={inv} organizationId={organizationId} />
      ))}
    </ul>
  );
}
