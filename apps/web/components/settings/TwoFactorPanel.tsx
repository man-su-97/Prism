"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Download, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

type EnableStep = "password" | "verify" | "backup";

export function TwoFactorPanel({
  initiallyEnabled,
  passwordRequired,
}: {
  initiallyEnabled: boolean;
  passwordRequired: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initiallyEnabled);

  // ─── Enable dialog state ────────────────────────────────────────────────
  const [enableOpen, setEnableOpen] = useState(false);
  const [step, setStep] = useState<EnableStep>("password");
  const [enablePassword, setEnablePassword] = useState("");
  const [totpURI, setTotpURI] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [enableBusy, setEnableBusy] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);

  // ─── Regenerate / disable state ────────────────────────────────────────
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenPassword, setRegenPassword] = useState("");
  const [regenCodes, setRegenCodes] = useState<string[] | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableBusy, setDisableBusy] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);

  function resetEnableState() {
    setStep("password");
    setEnablePassword("");
    setTotpURI(null);
    setVerifyCode("");
    setBackupCodes([]);
    setEnableBusy(false);
    setEnableError(null);
  }

  async function onSubmitEnablePassword(e: React.FormEvent) {
    e.preventDefault();
    setEnableBusy(true);
    setEnableError(null);
    const result = await authClient.twoFactor.enable({
      password: enablePassword,
      // Issuer also set on the server plugin; passing here is belt-and-braces
      // so the otpauth URI shows the right app name regardless.
      issuer: "Prism",
    });
    setEnableBusy(false);
    if (result.error) {
      setEnableError(result.error.message ?? "Couldn't start enrollment.");
      return;
    }
    setTotpURI(result.data?.totpURI ?? null);
    setBackupCodes(result.data?.backupCodes ?? []);
    setStep("verify");
  }

  async function onSubmitVerify(e: React.FormEvent) {
    e.preventDefault();
    setEnableBusy(true);
    setEnableError(null);
    const result = await authClient.twoFactor.verifyTotp({
      code: verifyCode.trim(),
    });
    setEnableBusy(false);
    if (result.error) {
      setEnableError(
        result.error.message ?? "That code didn't match. Try again.",
      );
      return;
    }
    setEnabled(true);
    setStep("backup");
  }

  function onEnableDialogChange(open: boolean) {
    setEnableOpen(open);
    if (!open) {
      resetEnableState();
      router.refresh();
    }
  }

  async function onSubmitRegenerate(e: React.FormEvent) {
    e.preventDefault();
    setRegenBusy(true);
    setRegenError(null);
    const result = await authClient.twoFactor.generateBackupCodes({
      password: regenPassword,
    });
    setRegenBusy(false);
    if (result.error) {
      setRegenError(
        result.error.message ?? "Couldn't regenerate backup codes.",
      );
      return;
    }
    setRegenCodes(result.data?.backupCodes ?? []);
    setRegenPassword("");
    toast.success("Backup codes regenerated.");
  }

  function onRegenDialogChange(open: boolean) {
    setRegenOpen(open);
    if (!open) {
      setRegenCodes(null);
      setRegenPassword("");
      setRegenError(null);
      setRegenBusy(false);
    }
  }

  async function onConfirmDisable() {
    setDisableBusy(true);
    setDisableError(null);
    const result = await authClient.twoFactor.disable({
      password: disablePassword,
    });
    setDisableBusy(false);
    if (result.error) {
      setDisableError(result.error.message ?? "Couldn't disable 2FA.");
      return;
    }
    setEnabled(false);
    setDisableOpen(false);
    setDisablePassword("");
    toast.success("Two-factor authentication disabled.");
    router.refresh();
  }

  if (!passwordRequired) {
    return (
      <p className="text-muted-foreground text-sm">
        Two-factor enrollment requires a password on your account. Sign-in via
        Google alone isn&apos;t enough.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <div className="flex items-start gap-3">
          {enabled ? (
            <ShieldCheck className="text-success mt-0.5 size-5" />
          ) : (
            <ShieldOff className="text-muted-foreground mt-0.5 size-5" />
          )}
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              Authenticator app
              {enabled ? (
                <Badge variant="outline" className="text-success">
                  Enabled
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  Off
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-xs">
              {enabled
                ? "You'll be asked for a 6-digit code on every sign-in."
                : "Use an app like 1Password, Authy or Google Authenticator."}
            </p>
          </div>
        </div>
        {enabled ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRegenOpen(true)}
            >
              Regenerate codes
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDisableOpen(true)}
            >
              Disable
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={() => setEnableOpen(true)}>
            Enable
          </Button>
        )}
      </div>

      {/* ─── Enable dialog (3-step stepper) ──────────────────────────────── */}
      <Dialog open={enableOpen} onOpenChange={onEnableDialogChange}>
        <DialogContent className="sm:max-w-md">
          {step === "password" ? (
            <form onSubmit={onSubmitEnablePassword} className="space-y-4">
              <DialogHeader>
                <DialogTitle>Confirm your password</DialogTitle>
                <DialogDescription>
                  Enter your current password to start two-factor enrollment.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2.5">
                <Label htmlFor="tfa-password">Current password</Label>
                <PasswordInput
                  id="tfa-password"
                  autoComplete="current-password"
                  required
                  value={enablePassword}
                  onChange={(e) => setEnablePassword(e.target.value)}
                />
              </div>
              {enableError ? (
                <p className="text-destructive text-xs" role="alert">
                  {enableError}
                </p>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onEnableDialogChange(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={enableBusy}>
                  {enableBusy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Continue
                </Button>
              </DialogFooter>
            </form>
          ) : null}

          {step === "verify" && totpURI ? (
            <form onSubmit={onSubmitVerify} className="space-y-4">
              <DialogHeader>
                <DialogTitle>Scan and verify</DialogTitle>
                <DialogDescription>
                  Scan this QR code in your authenticator app, then enter the
                  6-digit code it shows.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col items-center gap-3">
                <div className="rounded-md bg-white p-3">
                  <QRCodeSVG value={totpURI} size={172} marginSize={0} />
                </div>
                <SecretReveal totpURI={totpURI} />
              </div>
              <div className="space-y-2.5">
                <Label htmlFor="tfa-verify-code">6-digit code</Label>
                <Input
                  id="tfa-verify-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  required
                  value={verifyCode}
                  onChange={(e) =>
                    setVerifyCode(e.target.value.replace(/\D/g, ""))
                  }
                />
              </div>
              {enableError ? (
                <p className="text-destructive text-xs" role="alert">
                  {enableError}
                </p>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onEnableDialogChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={enableBusy || verifyCode.length !== 6}
                >
                  {enableBusy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Verify and enable
                </Button>
              </DialogFooter>
            </form>
          ) : null}

          {step === "backup" ? (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle>Save your backup codes</DialogTitle>
                <DialogDescription>
                  Each code can be used once if you lose access to your
                  authenticator. Store them somewhere safe — they won&apos;t be
                  shown again.
                </DialogDescription>
              </DialogHeader>
              <BackupCodesGrid codes={backupCodes} />
              <DialogFooter>
                <Button onClick={() => onEnableDialogChange(false)}>
                  I&apos;ve saved them
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ─── Regenerate dialog ───────────────────────────────────────────── */}
      <Dialog open={regenOpen} onOpenChange={onRegenDialogChange}>
        <DialogContent className="sm:max-w-md">
          {regenCodes ? (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle>New backup codes</DialogTitle>
                <DialogDescription>
                  Old codes are no longer valid. Save the new set somewhere
                  safe.
                </DialogDescription>
              </DialogHeader>
              <BackupCodesGrid codes={regenCodes} />
              <DialogFooter>
                <Button onClick={() => onRegenDialogChange(false)}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={onSubmitRegenerate} className="space-y-4">
              <DialogHeader>
                <DialogTitle>Regenerate backup codes</DialogTitle>
                <DialogDescription>
                  Confirm your password to issue a fresh set. The previous set
                  will stop working immediately.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2.5">
                <Label htmlFor="regen-password">Current password</Label>
                <PasswordInput
                  id="regen-password"
                  autoComplete="current-password"
                  required
                  value={regenPassword}
                  onChange={(e) => setRegenPassword(e.target.value)}
                />
              </div>
              {regenError ? (
                <p className="text-destructive text-xs" role="alert">
                  {regenError}
                </p>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onRegenDialogChange(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={regenBusy}>
                  {regenBusy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Regenerate
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── Disable confirmation ────────────────────────────────────────── */}
      <AlertDialog open={disableOpen} onOpenChange={setDisableOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable two-factor?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;ll only need your password to sign in. We recommend
              re-enabling 2FA as soon as possible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2.5">
            <Label htmlFor="disable-password">Current password</Label>
            <PasswordInput
              id="disable-password"
              autoComplete="current-password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
            />
          </div>
          {disableError ? (
            <p className="text-destructive text-xs" role="alert">
              {disableError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disableBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Keep the dialog open until the request resolves so the
                // password input stays mounted.
                e.preventDefault();
                onConfirmDisable();
              }}
              disabled={disableBusy || disablePassword.length === 0}
            >
              {disableBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Disable 2FA
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SecretReveal({ totpURI }: { totpURI: string }) {
  const [shown, setShown] = useState(false);
  // otpauth://totp/{label}?secret=ABC&issuer=...  — pull the secret out for
  // users who can't scan and need to type it.
  const secret = (() => {
    try {
      return new URL(totpURI).searchParams.get("secret") ?? "";
    } catch {
      return "";
    }
  })();

  if (!secret) return null;

  return (
    <div className="w-full text-center">
      {shown ? (
        <div className="space-y-1">
          <p className="font-mono text-sm tracking-wider break-all">{secret}</p>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(secret);
              toast.success("Secret copied.");
            }}
            className="text-muted-foreground hover:text-foreground text-xs underline"
          >
            Copy
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShown(true)}
          className="text-muted-foreground hover:text-foreground text-xs underline"
        >
          Can&apos;t scan? Show secret
        </button>
      )}
    </div>
  );
}

function BackupCodesGrid({ codes }: { codes: string[] }) {
  function onCopy() {
    navigator.clipboard.writeText(codes.join("\n"));
    toast.success("Backup codes copied.");
  }

  function onDownload() {
    const blob = new Blob([codes.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "prism-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <ul className="bg-muted/50 grid grid-cols-2 gap-1 rounded-md p-3 font-mono text-sm">
        {codes.map((c) => (
          <li key={c} className="tracking-wider">
            {c}
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCopy}>
          <Copy className="size-3.5" /> Copy
        </Button>
        <Button variant="outline" size="sm" onClick={onDownload}>
          <Download className="size-3.5" /> Download
        </Button>
      </div>
    </div>
  );
}
