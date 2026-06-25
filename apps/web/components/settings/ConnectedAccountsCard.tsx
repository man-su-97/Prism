"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, Plug, Unplug } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Account = {
  id: string;
  providerId: string;
  accountId: string;
  createdAt: string | Date;
  scopes: string[];
};

const PROVIDER_LABEL: Record<string, string> = {
  google: "Google",
};

function formatDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ConnectedAccountsCard({
  googleEnabled,
}: {
  googleEnabled: boolean;
}) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Account | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const result = await authClient.listAccounts();
    if (result.error) {
      setError(result.error.message ?? "Could not load accounts.");
      return;
    }
    setAccounts((result.data ?? []) as Account[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onConnectGoogle() {
    setBusyProvider("google");
    setError(null);
    const result = await authClient.linkSocial({
      provider: "google",
      callbackURL: "/settings/connected",
    });
    if (result.error) {
      setBusyProvider(null);
      setError(result.error.message ?? "Could not start Google linking.");
      return;
    }
    // Better Auth returns a redirect URL the browser should follow to complete
    // the OAuth handshake. We leave busyProvider set so the button shows a
    // spinner until navigation kicks in.
    if (result.data?.url) {
      window.location.href = result.data.url;
    } else {
      setBusyProvider(null);
    }
  }

  async function onConfirmDisconnect() {
    if (!confirm) return;
    setBusyProvider(confirm.providerId);
    const result = await authClient.unlinkAccount({
      providerId: confirm.providerId,
      accountId: confirm.accountId,
    });
    setBusyProvider(null);
    if (result.error) {
      setError(result.error.message ?? "Could not disconnect account.");
      return;
    }
    setConfirm(null);
    toast.success(
      `${PROVIDER_LABEL[confirm.providerId] ?? confirm.providerId} disconnected.`,
    );
    load();
  }

  if (accounts === null) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading accounts…
      </div>
    );
  }

  // Hide the email/password "credential" pseudo-account — it isn't a linked
  // identity, it's how the user logs in directly. Same for any future
  // first-party providers we may use internally.
  const social = accounts.filter((a) => a.providerId !== "credential");
  const googleLinked = social.find((a) => a.providerId === "google");

  return (
    <div className="space-y-4">
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="divide-y">
        {social.length === 0 ? (
          <li className="text-muted-foreground py-3 text-sm">
            No external accounts linked yet.
          </li>
        ) : (
          social.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
                  <Plug className="size-4" />
                </div>
                <div className="min-w-0 text-sm">
                  <div className="font-medium">
                    {PROVIDER_LABEL[a.providerId] ?? a.providerId}
                  </div>
                  <div className="text-muted-foreground truncate text-xs">
                    Connected {formatDate(a.createdAt)}
                    {" · "}
                    <span className="font-mono">
                      {a.accountId.length > 14
                        ? `${a.accountId.slice(0, 6)}…${a.accountId.slice(-4)}`
                        : a.accountId}
                    </span>
                  </div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setConfirm(a)}
                disabled={busyProvider === a.providerId}
              >
                {busyProvider === a.providerId ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Unplug className="size-4" />
                )}
                Disconnect
              </Button>
            </li>
          ))
        )}
      </ul>

      {googleEnabled && !googleLinked ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border p-4">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">Google</p>
            <p className="text-muted-foreground text-xs">
              Sign in with Google and use Google Sheets as a data source.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={onConnectGoogle}
            disabled={busyProvider === "google"}
          >
            {busyProvider === "google" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <img src="/devicon_google.png" alt="" className="size-4" />
            )}
            Connect Google
          </Button>
        </div>
      ) : null}

      {!googleEnabled ? (
        <p className="text-muted-foreground text-xs">
          Google sign-in isn&apos;t configured on this deployment.{" "}
          <Badge variant="outline">GOOGLE_CLIENT_ID missing</Badge>
        </p>
      ) : null}

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect{" "}
              {confirm
                ? PROVIDER_LABEL[confirm.providerId] ?? confirm.providerId
                : ""}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.providerId === "google" ? (
                <>
                  Any Google Sheets datasets in your workspaces will stop
                  refreshing until you reconnect. You can reconnect at any time
                  from this page.
                </>
              ) : (
                <>
                  You&apos;ll lose the ability to sign in with this provider.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyProvider !== null}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                onConfirmDisconnect();
              }}
              disabled={busyProvider !== null}
            >
              {busyProvider !== null ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
