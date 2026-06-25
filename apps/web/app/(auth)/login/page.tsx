"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { signIn } from "@/lib/auth-client";
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
import { PasswordInput } from "@/components/ui/password-input";
import { Separator } from "@/components/ui/separator";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";
  const accountDeleted = searchParams.get("deleted") === "1";
  const passwordReset = searchParams.get("reset") === "1";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setUnverified(false);
    const result = await signIn.email({ email, password });
    setLoading(false);
    if (result.error) {
      if (result.error.code === "EMAIL_NOT_VERIFIED") {
        setUnverified(true);
        return;
      }
      setError(result.error.message ?? "Sign-in failed");
      return;
    }
    // Better Auth's twoFactor plugin intercepts /sign-in/email when the user
    // has 2FA enabled. The credential session is NOT minted — instead the
    // response carries twoFactorRedirect=true and Better Auth has stored a
    // short-lived 2FA cookie. Send the user to /two-factor to finish.
    const data = result.data as { twoFactorRedirect?: boolean } | null;
    if (data?.twoFactorRedirect) {
      const dest = `/two-factor?redirect=${encodeURIComponent(next)}`;
      router.replace(dest);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function onGoogle() {
    // Social sign-in does a full OAuth redirect; Better Auth's twoFactor
    // hook on the after-sign-in step will redirect to /two-factor on its own
    // if the linked user has 2FA enabled, so no client-side interception
    // needed here.
    await signIn.social({ provider: "google", callbackURL: next });
  }

  return (
    <Card className="glass shadow-(--shadow-elevated) ring-foreground/10">
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription>Welcome back to Prism.</CardDescription>
      </CardHeader>
      <CardContent>
        {accountDeleted ? (
          <p
            className="text-success mb-4 rounded-md border border-success/20 bg-success/5 px-3 py-2 text-xs"
            role="status"
          >
            Your account has been deleted. Sign in to a different account or
            create a new one.
          </p>
        ) : null}
        {passwordReset ? (
          <p
            className="text-success mb-4 rounded-md border border-success/20 bg-success/5 px-3 py-2 text-xs"
            role="status"
          >
            Password updated successfully. Sign in with your new password.
          </p>
        ) : null}
        <form className="space-y-4" onSubmit={onSubmit} id="login-form">
          <div className="space-y-2.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {unverified ? (
            <p className="text-xs" role="alert">
              Your email isn&apos;t verified yet.{" "}
              <Link
                href={`/verify-email?email=${encodeURIComponent(email)}`}
                className="text-foreground underline underline-offset-4"
              >
                Verify now
              </Link>
            </p>
          ) : null}
          {error ? (
            <p className="text-destructive text-xs" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <div className="relative my-6">
          <Separator />
          <span className="bg-card text-muted-foreground absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-2 text-xs">
            or
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={onGoogle}
          className="w-full"
        >
          <img src="/devicon_google.png" alt="" className="size-4" />
          Continue with Google
        </Button>
      </CardContent>
      <CardFooter className="text-muted-foreground justify-center text-xs">
        New here?{" "}
        <Link href="/signup" className="text-foreground ml-1 underline">
          Create an account
        </Link>
      </CardFooter>
    </Card>
  );
}
