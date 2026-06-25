import { DashboardClient } from "./DashboardClient";
import type { Widget } from "@/components/widgets/types";
import { backendJson } from "@/lib/backend";
import { messageFromUnknown } from "@/lib/errors";

type LayoutItem = { i: string; x: number; y: number; w: number; h: number };

type DashboardDetail = {
  id: string;
  dataset_id: string;
  name: string;
  kind: string;
  layout: LayoutItem[];
  overview: string | null;
  widgets: Widget[];
};

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let dash: DashboardDetail | null = null;
  let error: string | null = null;
  try {
    dash = await backendJson<DashboardDetail>(`/api/dashboards/${id}`);
  } catch (e) {
    error = messageFromUnknown(e, "Couldn't load this dashboard.");
  }

  if (!dash) {
    return (
      <main className="p-4 sm:p-6">
        <p className="text-destructive text-sm" role="alert">
          {error ?? "Not found."}
        </p>
      </main>
    );
  }

  return <DashboardClient initial={dash} />;
}
