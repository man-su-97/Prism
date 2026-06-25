"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  Loader2,
  LogOut,
  ShieldAlert,
  Trash2,
} from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { messageFromUnknown, parseApiError } from "@/lib/errors";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

type SoloWorkspace = { id: string; name: string; has_billing: boolean };
type LeavingWorkspace = { id: string; name: string; role: string };
type TransferWorkspace = {
  id: string;
  name: string;
  successor_user_id: string;
  successor_member_id: string;
};
type Blocker = { id: string; name: string; reason: string };

type Preview = {
  solo_workspaces: SoloWorkspace[];
  shared_workspaces_leaving: LeavingWorkspace[];
  shared_workspaces_transfer: TransferWorkspace[];
  blockers: Blocker[];
};

const PREVIEW_PATH =
  "/settings/profile/api/teardown?path=/api/me/account-teardown/preview";
const TEARDOWN_PATH =
  "/settings/profile/api/teardown?path=/api/me/account-teardown";

export function DeleteAccountPanel({
  email,
  hasPassword,
}: {
  email: string;
  hasPassword: boolean;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"idle" | "tearing-down" | "deleting-user">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    setPreviewError(null);
    try {
      const res = await fetch(PREVIEW_PATH, { cache: "no-store" });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = (await res.json()) as Preview;
      setPreview(data);
    } catch (err) {
      setPreviewError(messageFromUnknown(err, "Could not load the deletion preview."));
    }
  }, []);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  function resetDialog() {
    setEmailInput("");
    setPassword("");
    setError(null);
    setBusy(false);
    setStage("idle");
  }

  async function onConfirmDelete() {
    setBusy(true);
    setError(null);

    // Part 1 — tear down workspaces / Stripe / parquet on the FastAPI side.
    setStage("tearing-down");
    try {
      const res = await fetch(TEARDOWN_PATH, {
        method: "POST",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await parseApiError(res));
    } catch (err) {
      setBusy(false);
      setStage("idle");
      setError(messageFromUnknown(err, "Couldn't tear down your account data."));
      return;
    }

    // Part 2 — Better Auth deletes user/sessions/accounts/member/twoFactor.
    setStage("deleting-user");
    const result = await authClient.deleteUser(
      hasPassword ? { password } : {},
    );
    if (result.error) {
      setBusy(false);
      setStage("idle");
      // Workspaces are already gone — we can't undo that. Surface the auth
      // error and let the user retry: hitting POST /api/me/account-teardown
      // again is idempotent (preview will be empty, server will no-op).
      setError(
        result.error.message ??
          "Couldn't delete your account. Sign out and back in, then try again.",
      );
      return;
    }

    router.replace("/login?deleted=1");
  }

  if (previewError) {
    return (
      <div className="space-y-3">
        <p className="text-destructive text-sm" role="alert">
          {previewError}
        </p>
        <Button variant="outline" size="sm" onClick={loadPreview}>
          Retry
        </Button>
      </div>
    );
  }

  if (preview === null) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" /> Checking what would be
        deleted…
      </div>
    );
  }

  const { solo_workspaces, shared_workspaces_leaving, shared_workspaces_transfer, blockers } =
    preview;
  const canDelete = blockers.length === 0;
  const emailMatches = emailInput.trim().toLowerCase() === email.toLowerCase();
  const passwordOk = hasPassword ? password.length > 0 : true;

  return (
    <div className="space-y-4">
      <ul className="space-y-2 text-sm">
        {solo_workspaces.length > 0 ? (
          <li className="flex items-start gap-3">
            <Trash2 className="text-destructive mt-0.5 size-4 shrink-0" />
            <span>
              <strong>
                {solo_workspaces.length} workspace
                {solo_workspaces.length === 1 ? "" : "s"} will be deleted
              </strong>{" "}
              with all of their datasets, dashboards and stored files.
              <span className="text-muted-foreground block text-xs">
                {solo_workspaces.map((w) => w.name).join(" · ")}
              </span>
            </span>
          </li>
        ) : null}

        {shared_workspaces_leaving.length > 0 ? (
          <li className="flex items-start gap-3">
            <LogOut className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <span>
              You&apos;ll be removed from {shared_workspaces_leaving.length}{" "}
              shared workspace
              {shared_workspaces_leaving.length === 1 ? "" : "s"}.
              <span className="text-muted-foreground block text-xs">
                {shared_workspaces_leaving.map((w) => w.name).join(" · ")}
              </span>
            </span>
          </li>
        ) : null}

        {shared_workspaces_transfer.length > 0 ? (
          <li className="flex items-start gap-3">
            <ArrowRightLeft className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <span>
              Ownership of {shared_workspaces_transfer.length} workspace
              {shared_workspaces_transfer.length === 1 ? "" : "s"} will
              transfer to the longest-standing admin.
              <span className="text-muted-foreground block text-xs">
                {shared_workspaces_transfer.map((w) => w.name).join(" · ")}
              </span>
            </span>
          </li>
        ) : null}

        {solo_workspaces.length === 0 &&
        shared_workspaces_leaving.length === 0 &&
        shared_workspaces_transfer.length === 0 &&
        blockers.length === 0 ? (
          <li className="text-muted-foreground">
            No workspaces — just your account row will be removed.
          </li>
        ) : null}
      </ul>

      {blockers.length > 0 ? (
        <div className="border-destructive/30 bg-destructive/5 rounded-lg border p-4 text-sm">
          <div className="flex items-start gap-3">
            <ShieldAlert className="text-destructive mt-0.5 size-4 shrink-0" />
            <div className="space-y-2">
              <p className="font-medium">
                Promote another owner or admin before continuing
              </p>
              <p className="text-muted-foreground text-xs">
                You&apos;re the only owner of the workspaces below and there
                aren&apos;t any admins to take over. Open each workspace and
                promote a member to admin, then come back.
              </p>
              <ul className="space-y-1">
                {blockers.map((b) => (
                  <li key={b.id} className="flex items-center gap-2 text-xs">
                    <span>{b.name}</span>
                    <Link
                      href="/settings/workspace"
                      className="text-foreground underline"
                    >
                      Manage workspace
                    </Link>
                  </li>
                ))}
              </ul>
              <Button variant="outline" size="sm" onClick={loadPreview}>
                Refresh
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          variant="destructive"
          disabled={!canDelete}
          onClick={() => {
            resetDialog();
            setOpen(true);
          }}
        >
          <Trash2 className="size-4" /> Delete account
        </Button>
        {!canDelete ? (
          <p className="text-muted-foreground text-xs">
            Resolve the workspaces above first.
          </p>
        ) : null}
      </div>

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          if (!next) resetDialog();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="text-destructive size-5" />
              Delete your account permanently?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes your sign-in, sessions, two-factor secrets, and the
              workspaces listed above. We can&apos;t recover it.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <div className="space-y-2.5">
              <Label htmlFor="delete-email-confirm">
                Type <span className="font-mono">{email}</span> to confirm
              </Label>
              <Input
                id="delete-email-confirm"
                autoComplete="off"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                disabled={busy}
              />
            </div>

            {hasPassword ? (
              <div className="space-y-2.5">
                <Label htmlFor="delete-password">Current password</Label>
                <PasswordInput
                  id="delete-password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                />
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">
                Your account signs in via Google. Make sure you&apos;ve signed
                in within the last 5 minutes — otherwise the deletion will be
                rejected and you&apos;ll need to sign out and back in to
                refresh your session.
              </p>
            )}

            {error ? (
              <p className="text-destructive text-xs" role="alert">
                {error}
              </p>
            ) : null}

            {stage !== "idle" ? (
              <p className="text-muted-foreground text-xs">
                {stage === "tearing-down"
                  ? "Cleaning up workspaces and files…"
                  : "Removing your account…"}
              </p>
            ) : null}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || !emailMatches || !passwordOk}
              onClick={(e) => {
                e.preventDefault();
                onConfirmDelete();
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {busy ? "Deleting…" : "Delete account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
