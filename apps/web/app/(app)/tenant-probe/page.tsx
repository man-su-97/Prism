import { revalidatePath } from "next/cache";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { backendFetch, backendJson } from "@/lib/backend";
import { messageFromUnknown } from "@/lib/errors";

type ProbeRow = { id: string; org_id: string; note: string };

async function createProbe(formData: FormData) {
  "use server";
  const note = String(formData.get("note") ?? "").trim();
  if (!note) return;
  await backendFetch("/api/tenant-probe", {
    method: "POST",
    body: JSON.stringify({ note }),
  });
  revalidatePath("/tenant-probe");
}

export default async function TenantProbePage() {
  let rows: ProbeRow[] = [];
  let error: string | null = null;
  try {
    rows = await backendJson<ProbeRow[]>("/api/tenant-probe");
  } catch (e) {
    error = messageFromUnknown(e, "Couldn't reach the API.");
  }

  return (
    <>
      <PageHeader
        title="Tenant isolation probe"
        description="Rows here are guarded by Postgres RLS keyed on app.org_id. You should only ever see rows from your own workspace."
      />
      <div className="space-y-6 p-4 sm:p-6">
        <form action={createProbe} className="flex gap-2">
          <Input
            name="note"
            placeholder="Leave a note for your workspace…"
            className="flex-1"
          />
          <Button type="submit">Add</Button>
        </form>

        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}

        {rows.length === 0 && !error ? (
          <p className="text-muted-foreground text-sm">
            No rows yet for this workspace.
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <Card key={r.id}>
                <CardHeader className="pb-2">
                  <CardDescription className="font-mono text-xs">
                    {r.id}
                  </CardDescription>
                  <CardTitle className="text-sm font-normal">{r.note}</CardTitle>
                </CardHeader>
                <CardContent className="hidden" />
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
