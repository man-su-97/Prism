"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Database, ExternalLink, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ListToolbar, type ViewMode } from "@/components/layout/ListToolbar";
import { DatasetCard } from "@/components/datasets/DatasetCard";
import { StatusBadge } from "@/components/datasets/StatusBadge";
import { staggerParent } from "@/lib/motion";
import { useLocalStorageState } from "@/lib/use-local-storage-state";
import { useUrlState } from "@/lib/use-url-state";

type Dataset = {
  id: string;
  name: string;
  source_kind: string;
  status: string;
  row_count: number | null;
  size_bytes: number | null;
  created_at: string;
};

const KIND_OPTIONS = [
  { value: "csv", label: "CSV" },
  { value: "xlsx", label: "XLSX" },
  { value: "xls", label: "XLS" },
  { value: "sheet", label: "Google Sheet" },
];

const STATUS_OPTIONS = [
  { value: "ready", label: "Ready" },
  { value: "ingesting", label: "Ingesting" },
  { value: "pending", label: "Pending" },
  { value: "uploading", label: "Uploading" },
  { value: "error", label: "Error" },
];

function fmtBytes(n: number | null): string {
  if (n == null) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function DatasetsListView({
  datasets,
  dashboardByDataset,
}: {
  datasets: Dataset[];
  dashboardByDataset: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [viewRaw, setView] = useLocalStorageState("prism.view.datasets", "grid");
  const view: ViewMode = viewRaw === "list" ? "list" : "grid";
  const [query, setQuery] = useUrlState("q", "");
  const [kind, setKind] = useUrlState("kind", "");
  const [status, setStatus] = useUrlState("status", "");

  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return datasets.filter((d) => {
      if (q && !d.name.toLowerCase().includes(q)) return false;
      if (kind && d.source_kind !== kind) return false;
      if (status && d.status !== status) return false;
      return true;
    });
  }, [datasets, deferredQuery, kind, status]);

  const hasFilters = !!(query || kind || status);

  // Atomically clear all query params — calling three separate setters reads
  // the same stale URLSearchParams snapshot and the last one wins, leaving
  // the others intact.
  function resetFilters() {
    router.replace(pathname, { scroll: false });
  }

  // Poll while any dataset is still ingesting so status badges update without
  // a manual page refresh (mirrors DatasetStatusPoller on the detail page).
  const anyInFlight = datasets.some(
    (d) => d.status === "pending" || d.status === "ingesting",
  );
  useEffect(() => {
    if (!anyInFlight) return;
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [anyInFlight, router]);

  return (
    <div className="space-y-6">
      <ListToolbar
        view={view}
        onViewChange={(v) => setView(v)}
        query={query}
        onQueryChange={setQuery}
        placeholder="Search datasets…"
        shown={filtered.length}
        total={datasets.length}
        itemNoun="dataset"
      >
        <Select
          value={kind || "all"}
          onValueChange={(v) => setKind(v === "all" ? "" : v)}
        >
          <SelectTrigger aria-label="Filter by source kind" className="rounded-full">
            <SelectValue placeholder="Kind" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            {KIND_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status || "all"}
          onValueChange={(v) => setStatus(v === "all" ? "" : v)}
        >
          <SelectTrigger aria-label="Filter by status" className="rounded-full">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters ? (
          <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
            Reset
          </Button>
        ) : null}
      </ListToolbar>

      <AnimatePresence mode="popLayout" initial={false}>
        {filtered.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="border-border/60 bg-muted/20 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center"
          >
            <div className="text-muted-foreground bg-background flex size-12 items-center justify-center rounded-full border border-border/60">
              <SearchX className="size-5" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">No datasets match these filters</p>
              <p className="text-muted-foreground text-xs">
                Try a different search or reset to see everything.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
              Reset filters
            </Button>
          </motion.div>
        ) : view === "grid" ? (
          <motion.div
            key="grid"
            variants={staggerParent}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          >
            {filtered.map((d) => (
              <DatasetCard
                key={d.id}
                dataset={d}
                dashboardId={dashboardByDataset[d.id]}
              />
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="overflow-hidden rounded-2xl border border-border/60 bg-card"
          >
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                  <TableHead className="text-right">Dashboard</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => {
                  const dashId = dashboardByDataset[d.id];
                  return (
                    <TableRow key={d.id} className="group/row">
                      <TableCell>
                        <Link
                          href={`/datasets/${d.id}`}
                          className="text-foreground inline-flex items-center gap-2 font-medium hover:underline"
                        >
                          <Database className="text-primary size-3.5 opacity-70" />
                          {d.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                        {d.source_kind}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={d.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-right tabular-nums">
                        {d.row_count?.toLocaleString() ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-right tabular-nums">
                        {fmtBytes(d.size_bytes)}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-right text-xs tabular-nums">
                        {new Date(d.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {dashId && d.status === "ready" ? (
                          <Link
                            href={`/dashboards/${dashId}`}
                            aria-label={`Open dashboard for ${d.name}`}
                            title="Open dashboard"
                            className="text-muted-foreground hover:text-primary hover:bg-primary/10 inline-flex size-8 items-center justify-center rounded-md transition-colors"
                          >
                            <ExternalLink className="size-4" />
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
