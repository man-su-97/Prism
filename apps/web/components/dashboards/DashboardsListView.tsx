"use client";

import Link from "next/link";
import { useDeferredValue, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { LayoutDashboard, SearchX } from "lucide-react";

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
import { DashboardCard } from "@/components/dashboards/DashboardCard";
import { staggerParent } from "@/lib/motion";
import { useLocalStorageState } from "@/lib/use-local-storage-state";
import { useUrlState } from "@/lib/use-url-state";

type DashboardSummary = {
  id: string;
  dataset_id: string;
  name: string;
  kind: string;
  created_at: string;
};

type DatasetRef = { id: string; name: string };

const KIND_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "manual", label: "Manual" },
];

export function DashboardsListView({
  dashboards,
  datasetsById,
}: {
  dashboards: DashboardSummary[];
  datasetsById: Record<string, DatasetRef>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [viewRaw, setView] = useLocalStorageState("prism.view.dashboards", "grid");
  const view: ViewMode = viewRaw === "list" ? "list" : "grid";
  const [query, setQuery] = useUrlState("q", "");
  const [dataset, setDataset] = useUrlState("dataset", "");
  const [kind, setKind] = useUrlState("kind", "");

  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return dashboards.filter((d) => {
      if (q && !d.name.toLowerCase().includes(q)) return false;
      if (dataset && d.dataset_id !== dataset) return false;
      if (kind && d.kind !== kind) return false;
      return true;
    });
  }, [dashboards, deferredQuery, dataset, kind]);

  const datasetOptions = useMemo(
    () =>
      Object.values(datasetsById).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    [datasetsById],
  );

  const hasFilters = !!(query || dataset || kind);

  function resetFilters() {
    // Single replace clears all params atomically — calling individual setters
    // in sequence fails because each reads the same stale params snapshot and
    // the last one overwrites the others.
    router.replace(pathname, { scroll: false });
  }

  return (
    <div className="space-y-6">
      <ListToolbar
        view={view}
        onViewChange={(v) => setView(v)}
        query={query}
        onQueryChange={setQuery}
        placeholder="Search dashboards…"
        shown={filtered.length}
        total={dashboards.length}
        itemNoun="dashboard"
      >
        <Select
          value={dataset || "all"}
          onValueChange={(v) => setDataset(v === "all" ? "" : v)}
        >
          <SelectTrigger aria-label="Filter by dataset" className="rounded-full">
            <SelectValue placeholder="Dataset" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All datasets</SelectItem>
            {datasetOptions.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={kind || "all"}
          onValueChange={(v) => setKind(v === "all" ? "" : v)}
        >
          <SelectTrigger aria-label="Filter by kind" className="rounded-full">
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
              <p className="text-sm font-medium">No dashboards match these filters</p>
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
            className="grid auto-rows-[16rem] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          >
            {filtered.map((d, i) => (
              <DashboardCard
                key={d.id}
                dashboard={d}
                datasetName={datasetsById[d.dataset_id]?.name}
                featured={i === 0 && filtered.length > 2}
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
                  <TableHead>Dataset</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => {
                  const ds = datasetsById[d.dataset_id];
                  return (
                    <TableRow key={d.id} className="group/row">
                      <TableCell>
                        <Link
                          href={`/dashboards/${d.id}`}
                          className="text-foreground inline-flex items-center gap-2 font-medium hover:underline"
                        >
                          <LayoutDashboard className="text-primary size-3.5 opacity-70" />
                          {d.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {ds ? (
                          <Link
                            href={`/datasets/${ds.id}`}
                            className="hover:text-foreground hover:underline"
                          >
                            {ds.name}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground capitalize">
                        {d.kind}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-right text-xs tabular-nums">
                        {new Date(d.created_at).toLocaleString()}
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
