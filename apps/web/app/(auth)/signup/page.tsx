"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { signIn, signUp } from "@/lib/auth-client";
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

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onGoogle() {
    await signIn.social({ provider: "google", callbackURL: "/onboarding/workspace" });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await signUp.email({ email, password, name });
    setLoading(false);
    if (result.error) {
      setError(result.error.message ?? "Sign-up failed");
      return;
    }
    // token===null means email verification required — emailOTP plugin has
    // already sent the OTP; redirect to the verification screen.
    if ((result.data as { token: string | null } | null)?.token === null) {
      router.replace(`/verify-email?email=${encodeURIComponent(email)}`);
      return;
    }
    router.replace("/onboarding/workspace");
    router.refresh();
  }

  return (
    <Card className="glass shadow-(--shadow-elevated) ring-foreground/10">
      <CardHeader>
        <CardTitle className="text-xl">Create your account</CardTitle>
        <CardDescription>Analytics for any dataset, in minutes.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
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
            <Label htmlFor="password">Password</Label>
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
          {error ? (
            <p className="text-destructive text-xs" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {loading ? "Creating…" : "Create account"}
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
        Already have an account?{" "}
        <Link href="/login" className="text-foreground ml-1 underline">
          Sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
