"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";

import { emailOtp } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function VerifyEmailPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";

  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!email) router.replace("/signup");
  }, [email, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await emailOtp.verifyEmail({ email, otp: otp.trim() });
    setLoading(false);
    if (result.error) {
      setError(mapOtpError(result.error.message));
      return;
    }
    router.replace("/onboarding/workspace");
    router.refresh();
  }

  async function onResend() {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setResendSuccess(false);
    setError(null);
    const result = await emailOtp.sendVerificationOtp({
      email,
      type: "email-verification",
    });
    setResending(false);
    if (result.error) {
      setError("Failed to resend. Please try again.");
      return;
    }
    setResendSuccess(true);
    setOtp("");
    setCooldown(60);
  }

  if (!email) return null;

  return (
    <Card className="glass shadow-(--shadow-elevated) ring-foreground/10">
      <CardHeader>
        <div className="bg-primary/10 mx-auto mb-2 flex size-10 items-center justify-center rounded-full">
          <Mail className="text-primary size-5" />
        </div>
        <CardTitle className="text-center text-xl">Check your email</CardTitle>
        <CardDescription className="text-center">
          We sent a 6-digit code to{" "}
          <span className="text-foreground font-medium">{email}</span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2.5">
            <Label htmlFor="otp">Verification code</Label>
            <Input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="000000"
              className="text-center font-mono text-lg tracking-widest"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              autoFocus
              required
            />
            <p className="text-muted-foreground text-xs">
              The code expires in 10 minutes.
            </p>
          </div>
          {error ? (
            <p className="text-destructive text-xs" role="alert">
              {error}
            </p>
          ) : null}
          {resendSuccess ? (
            <p className="text-xs text-green-600" role="status">
              A new code was sent to {email}.
            </p>
          ) : null}
          <Button
            type="submit"
            disabled={loading || otp.length !== 6}
            className="w-full"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {loading ? "Verifying…" : "Verify email"}
          </Button>
        </form>
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={onResend}
            disabled={resending || cooldown > 0}
            className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            {resending ? (
              "Sending…"
            ) : cooldown > 0 ? (
              <>Resend code in {cooldown}s</>
            ) : (
              "Resend code"
            )}
          </button>
        </div>
      </CardContent>
      <CardFooter className="text-muted-foreground justify-center text-xs">
        Wrong email?{" "}
        <Link href="/signup" className="text-foreground ml-1 underline">
          Start over
        </Link>
      </CardFooter>
    </Card>
  );
}

function mapOtpError(msg: string | undefined): string {
  if (!msg) return "Verification failed. Please try again.";
  if (msg.includes("expired") || msg.includes("EXPIRED"))
    return "This code has expired. Please request a new one.";
  if (msg.includes("attempts") || msg.includes("MANY"))
    return "Too many incorrect attempts. Please request a new code.";
  if (msg.includes("invalid") || msg.includes("INVALID"))
    return "Incorrect code. Please check and try again.";
  return msg;
}
