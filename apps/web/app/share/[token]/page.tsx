import Link from "next/link";
import { Link2Off } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Widget } from "@/components/widgets/types";

import { ShareView } from "./ShareView";

// Token comes from the URL and is verified against live state — no prerender.
export const dynamic = "force-dynamic";

type Layout = { i: string; x: number; y: number; w: number; h: number };

type SharedDashboard = {
  dashboard_id: string;
  dataset_id: string;
  name: string;
  kind: string;
  layout: Layout[];
  overview: string | null;
  widgets: Widget[];
};

async function fetchShared(
  token: string,
): Promise<SharedDashboard | { error: string }> {
  const apiBase = process.env.API_BASE_URL ?? "http://api:8000";
  const res = await fetch(`${apiBase}/api/share/${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    return { error: `${res.status}` };
  }
  return (await res.json()) as SharedDashboard;
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const data = await fetchShared(token);

  if ("error" in data) {
    return (
      <main className="bg-background relative flex min-h-screen items-center justify-center overflow-hidden p-6">
        <div className="bg-aurora animate-aurora pointer-events-none absolute inset-0 opacity-70" aria-hidden />
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-50" aria-hidden />
        <Card className="glass relative w-full max-w-md shadow-(--shadow-elevated) ring-foreground/10">
          <CardHeader>
            <div className="text-muted-foreground flex items-center gap-2">
              <span className="bg-muted inline-flex size-8 items-center justify-center rounded-full">
                <Link2Off className="size-4" />
              </span>
              <CardTitle>This share link isn&apos;t valid.</CardTitle>
            </div>
            <CardDescription>
              It may have expired or been revoked. Ask the dashboard owner for
              a new link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/">Open Prism</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return <ShareView token={token} dashboard={data} />;
}
