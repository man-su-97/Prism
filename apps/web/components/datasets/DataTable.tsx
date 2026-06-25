"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { messageFromUnknown, parseApiError } from "@/lib/errors";

const PAGE_SIZE = 50;

type SortDir = "asc" | "desc";

type RowsResponse = {
  columns: string[];
  rows: Record<string, unknown>[];
  total: number | null;
  truncated: boolean;
};

async function fetchRows(
  datasetId: string,
  body: { limit: number; offset: number; sort_by: string | null; sort_dir: SortDir | null },
  signal: AbortSignal,
): Promise<RowsResponse> {
  const res = await fetch(
    `/datasets/api?path=${encodeURIComponent(`/api/datasets/${datasetId}/rows`)}`,
    {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    },
  );
  if (!res.ok) throw new Error(await parseApiError(res));
  return (await res.json()) as RowsResponse;
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function DataTable({
  datasetId,
  status,
  rowCount,
  fallbackColumns,
}: {
  datasetId: string;
  status: string;
  rowCount: number | null;
  fallbackColumns: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const page = Math.max(1, Number(params.get("page")) || 1);
  const sortBy = params.get("sort") || null;
  const sortDirRaw = (params.get("dir") || "").toLowerCase();
  const sortDir: SortDir | null =
    sortBy && (sortDirRaw === "asc" || sortDirRaw === "desc") ? sortDirRaw : null;

  const [data, setData] = useState<RowsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const updateParams = useCallback(
    (deltas: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(deltas)) {
        if (v === null || v === "") sp.delete(k);
        else sp.set(k, v);
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  useEffect(() => {
    if (status !== "ready") return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetchRows(
      datasetId,
      {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        sort_by: sortBy,
        sort_dir: sortDir,
      },
      ctrl.signal,
    )
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setError(messageFromUnknown(e, "Couldn't load rows."));
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [datasetId, status, page, sortBy, sortDir]);

  const columns = useMemo(
    () => (data?.columns?.length ? data.columns : fallbackColumns),
    [data, fallbackColumns],
  );

  const total = data?.total ?? rowCount;
  const offset = (page - 1) * PAGE_SIZE;
  const shown = data?.rows.length ?? 0;
  const hasPrev = page > 1;
  const hasNext =
    data != null && (total != null ? offset + shown < total : data.truncated);

  const cycleSort = useCallback(
    (col: string) => {
      // asc -> desc -> none (and reset to page 1)
      if (sortBy !== col) {
        updateParams({ sort: col, dir: "asc", page: null });
        return;
      }
      if (sortDir === "asc") {
        updateParams({ dir: "desc", page: null });
        return;
      }
      updateParams({ sort: null, dir: null, page: null });
    },
    [sortBy, sortDir, updateParams],
  );

  if (status !== "ready") {
    return (
      <p className="text-muted-foreground text-sm">
        Data will appear here once ingestion completes.
      </p>
    );
  }

  if (error) {
    return (
      <div className="text-destructive flex items-start gap-2 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  if (!data && loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader className="bg-muted/40 sticky top-0">
            <TableRow>
              {columns.map((c) => {
                const active = sortBy === c;
                return (
                  <TableHead key={c} className="text-xs">
                    <button
                      type="button"
                      onClick={() => cycleSort(c)}
                      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                    >
                      <span>{c}</span>
                      {active && sortDir === "asc" ? (
                        <ArrowUp className="size-3" />
                      ) : null}
                      {active && sortDir === "desc" ? (
                        <ArrowDown className="size-3" />
                      ) : null}
                    </button>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data && data.rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length || 1}
                  className="text-muted-foreground text-xs"
                >
                  No rows on this page.
                </TableCell>
              </TableRow>
            ) : null}
            {data?.rows.map((r, i) => (
              <TableRow key={i} className="hover:bg-[rgba(200,255,0,0.04)]">
                {columns.map((c) => (
                  <TableCell
                    key={c}
                    className="text-muted-foreground max-w-xs truncate align-top text-xs"
                  >
                    {formatCell(r[c])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span>
          {shown > 0 ? (
            <>
              Showing {(offset + 1).toLocaleString()}–
              {(offset + shown).toLocaleString()}
              {total != null ? ` of ${total.toLocaleString()}` : ""}
            </>
          ) : (
            "—"
          )}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!hasPrev || loading}
            onClick={() =>
              updateParams({ page: page > 2 ? String(page - 1) : null })
            }
          >
            <ChevronLeft className="size-4" />
            Prev
          </Button>
          <span className="rounded bg-(--color-lime) px-2 py-0.5 text-xs font-medium font-mono tabular-nums text-white dark:text-[#111111]">
            {page}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNext || loading}
            onClick={() => updateParams({ page: String(page + 1) })}
          >
            Next
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
