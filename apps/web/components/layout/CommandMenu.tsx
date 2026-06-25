"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Database,
  LayoutDashboard,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

type Item = { id: string; name: string; kind: "dashboard" | "dataset" };

async function fetchItems(signal: AbortSignal): Promise<Item[]> {
  const [dashRes, dsRes] = await Promise.all([
    fetch(`/dashboards/api?path=${encodeURIComponent("/api/dashboards")}`, { signal }),
    fetch(`/datasets/api?path=${encodeURIComponent("/api/datasets")}`, { signal }),
  ]);
  const [dashes, datasets] = await Promise.all([
    dashRes.ok
      ? (dashRes.json() as Promise<{ id: string; name: string }[]>)
      : Promise.resolve([]),
    dsRes.ok
      ? (dsRes.json() as Promise<{ id: string; name: string }[]>)
      : Promise.resolve([]),
  ]);
  return [
    ...dashes.map((d) => ({ id: d.id, name: d.name, kind: "dashboard" as const })),
    ...datasets.map((d) => ({ id: d.id, name: d.name, kind: "dataset" as const })),
  ];
}

export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks an in-progress fetch so the effect doesn't double-fire without
  // adding `loading` to its deps (which would cause an extra run per state change).
  const fetchingRef = useRef(false);

  useEffect(() => {
    // Only fetch when dialog is open and we don't already have data or an error.
    // Retry is triggered by resetting both items and error to null via retry().
    if (!open || fetchingRef.current || items !== null || error !== null) return;

    fetchingRef.current = true;
    setLoading(true);
    const ctrl = new AbortController();

    fetchItems(ctrl.signal)
      .then((data) => {
        if (!ctrl.signal.aborted) setItems(data);
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        const msg =
          e instanceof Error && e.name !== "AbortError"
            ? "Couldn't load. Check your connection."
            : null;
        if (msg) setError(msg);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) {
          setLoading(false);
          fetchingRef.current = false;
        }
      });

    return () => {
      ctrl.abort();
      fetchingRef.current = false;
    };
  }, [open, items, error]);

  const retry = useCallback(() => {
    setError(null);
    setItems(null);
  }, []);

  const navigate = useCallback(
    (item: Item) => {
      onOpenChange(false);
      router.push(
        item.kind === "dashboard" ? `/dashboards/${item.id}` : `/datasets/${item.id}`,
      );
    },
    [router, onOpenChange],
  );

  const dashboards = items?.filter((i) => i.kind === "dashboard") ?? [];
  const datasets = items?.filter((i) => i.kind === "dataset") ?? [];
  const isEmpty = items !== null && items.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden p-0 shadow-2xl sm:max-w-xl"
        showCloseButton={false}
        aria-label="Search"
      >
        <Command>
          <CommandInput placeholder="Search dashboards, datasets…" autoFocus />
          <CommandList className="max-h-80">
            {/* Loading */}
            {loading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Fetch error with retry */}
            {!loading && error && (
              <div className="flex flex-col items-center gap-3 py-8 text-center text-sm">
                <AlertCircle className="size-5 text-destructive/70" />
                <span className="text-muted-foreground">{error}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={retry}
                  className="gap-1.5 text-xs"
                >
                  <RefreshCw className="size-3" />
                  Try again
                </Button>
              </div>
            )}

            {/* Empty workspace — no items exist at all */}
            {!loading && !error && isEmpty && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No dashboards or datasets in this workspace yet.
              </div>
            )}

            {/* Results — cmdk handles filtering; CommandEmpty fires when query matches nothing */}
            {!loading && !error && !isEmpty && (
              <>
                <CommandEmpty>No results found.</CommandEmpty>
                {dashboards.length > 0 && (
                  <CommandGroup heading="Dashboards">
                    {dashboards.map((item) => (
                      <CommandItem
                        key={item.id}
                        // Unique stable value prevents cmdk deduping same-name items;
                        // keywords keeps the item searchable by its display name.
                        value={`dashboard-${item.id}`}
                        keywords={[item.name]}
                        onSelect={() => navigate(item)}
                      >
                        <LayoutDashboard className="size-4 text-(--color-violet)" />
                        {item.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {dashboards.length > 0 && datasets.length > 0 && <CommandSeparator />}
                {datasets.length > 0 && (
                  <CommandGroup heading="Datasets">
                    {datasets.map((item) => (
                      <CommandItem
                        key={item.id}
                        value={`dataset-${item.id}`}
                        keywords={[item.name]}
                        onSelect={() => navigate(item)}
                      >
                        <Database className="size-4 text-(--color-teal)" />
                        {item.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
