"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { emailOtp } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";

  // OTP is stored in sessionStorage by verify-reset-otp so it never appears
  // in the URL. Read it once on mount and clear it immediately so it doesn't
  // linger if the user navigates back.
  const [otp, setOtp] = useState("");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem("reset_otp") ?? "";
    sessionStorage.removeItem("reset_otp");
    if (!email || !stored) {
      router.replace("/forgot-password");
      return;
    }
    setOtp(stored);
  }, [email, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    setError(null);
    const result = await emailOtp.resetPassword({ email, otp, password });
    setLoading(false);
    if (result.error) {
      if (
        result.error.message?.includes("expired") ||
        result.error.message?.includes("EXPIRED")
      ) {
        setError("The reset code has expired. Please start over.");
        return;
      }
      setError(result.error.message ?? "Password reset failed. Please try again.");
      return;
    }
    router.replace("/login?reset=1");
  }

  // Render nothing until sessionStorage OTP is loaded (avoids a flash of the
  // form before the useEffect redirect can fire when otp is missing).
  if (!email || !otp) return null;

  return (
    <Card className="glass shadow-(--shadow-elevated) ring-foreground/10">
      <CardHeader>
        <CardTitle className="text-xl">Set new password</CardTitle>
        <CardDescription>
          Choose a strong password for{" "}
          <span className="text-foreground font-medium">{email}</span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2.5">
            <Label htmlFor="password">New password</Label>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
            <p className="text-muted-foreground text-xs">
              At least 8 characters.
            </p>
          </div>
          <div className="space-y-2.5">
            <Label htmlFor="confirm">Confirm password</Label>
            <PasswordInput
              id="confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={8}
              required
            />
          </div>
          {error ? (
            <p className="text-destructive text-xs" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            disabled={loading || !password || !confirm}
            className="w-full"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {loading ? "Updating…" : "Update password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
