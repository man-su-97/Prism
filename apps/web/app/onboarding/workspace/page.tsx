"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { LogoFull } from "@/components/layout/Logo";

import { authClient, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function defaultWorkspaceName(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  if (!first) return "";
  return `${first}'s workspace`;
}

export default function OnboardingWorkspacePage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (nameTouched) return;
    const suggested = defaultWorkspaceName(session?.user?.name);
    if (!suggested) return;
    setName(suggested);
    if (!slugTouched) setSlug(slugify(suggested));
  }, [session?.user?.name, nameTouched, slugTouched]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const finalSlug = slug.trim() || slugify(name);
    const created = await authClient.organization.create({
      name,
      slug: finalSlug,
    });

    if (created.error || !created.data) {
      setLoading(false);
      setError(created.error?.message ?? "Could not create workspace.");
      return;
    }

    await authClient.organization.setActive({ organizationId: created.data.id });
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="bg-muted/30 flex min-h-screen flex-col items-center justify-center gap-6 p-4 sm:p-6">
      <LogoFull />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your workspace</CardTitle>
          <CardDescription>
            All your datasets and dashboards live inside a workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => {
                  setNameTouched(true);
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
                placeholder="My workspace"
                required
              />
            </div>
            <div className="space-y-2.5">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
                pattern="[a-z0-9-]+"
                className="font-mono"
                required
              />
              <p className="text-muted-foreground text-xs">
                Lowercase letters, numbers and dashes. Used in URLs.
              </p>
            </div>
            {error ? (
              <p className="text-destructive text-xs" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? <Loader2 className="size-4 animate-spin" /> : null}
              {loading ? "Creating…" : "Create workspace"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
