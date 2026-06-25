"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function TwoFactorVerifyForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const result =
      mode === "totp"
        ? await authClient.twoFactor.verifyTotp({
            code: code.trim(),
            trustDevice,
          })
        : await authClient.twoFactor.verifyBackupCode({
            code: backupCode.trim(),
          });

    setPending(false);
    if (result.error) {
      setError(
        result.error.message ??
          (mode === "totp"
            ? "That code didn't match."
            : "Backup code didn't match or has already been used."),
      );
      return;
    }
    router.replace(redirectTo);
    router.refresh();
  }

  return (
    <Tabs
      value={mode}
      onValueChange={(v) => {
        setMode(v as typeof mode);
        setError(null);
      }}
      className="space-y-4"
    >
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="totp">Authenticator</TabsTrigger>
        <TabsTrigger value="backup">Backup code</TabsTrigger>
      </TabsList>

      <form onSubmit={onSubmit} className="space-y-4">
        <TabsContent value="totp" className="space-y-4">
          <div className="space-y-2.5">
            <Label htmlFor="totp-code">6-digit code</Label>
            <Input
              id="totp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required={mode === "totp"}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={trustDevice}
              onCheckedChange={(v) => setTrustDevice(v === true)}
            />
            Trust this device for 30 days
          </label>
        </TabsContent>

        <TabsContent value="backup" className="space-y-4">
          <div className="space-y-2.5">
            <Label htmlFor="backup-code">Backup code</Label>
            <Input
              id="backup-code"
              autoComplete="off"
              required={mode === "backup"}
              value={backupCode}
              onChange={(e) => setBackupCode(e.target.value)}
              autoFocus
            />
            <p className="text-muted-foreground text-xs">
              Each backup code can be used once.
            </p>
          </div>
        </TabsContent>

        {error ? (
          <p className="text-destructive text-xs" role="alert">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          disabled={
            pending ||
            (mode === "totp" ? code.length !== 6 : backupCode.length === 0)
          }
          className="w-full"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? "Verifying…" : "Verify"}
        </Button>
      </form>
    </Tabs>
  );
}
