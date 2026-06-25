"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, FileSpreadsheet, Sheet } from "lucide-react";

import { StatusBadge } from "@/components/datasets/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fadeUpSmall, staggerParent } from "@/lib/motion";

export type DatasetItem = {
  id: string;
  name: string;
  source_kind: string;
  status: string;
  row_count: number | null;
};

function KindIcon({ kind }: { kind: string }) {
  if (kind === "sheet") return <Sheet className="size-3.5" />;
  return <FileSpreadsheet className="size-3.5" />;
}

export function RecentDatasetsCard({ items }: { items: DatasetItem[] }) {
  return (
    <Card size="sm" className="gap-2 ring-foreground/8">
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 pt-4">
        <CardTitle>Recent datasets</CardTitle>
        <Link
          href="/datasets"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
        >
          View all <ArrowRight className="size-3" />
        </Link>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {items.length === 0 ? (
          <div className="text-muted-foreground rounded-xl border border-dashed border-border/60 bg-muted/20 px-3 py-4 text-center text-xs">
            No datasets yet.{" "}
            <Link href="/datasets" className="text-foreground underline underline-offset-2">
              Upload one
            </Link>
            .
          </div>
        ) : (
          <motion.ul
            variants={staggerParent}
            initial="hidden"
            animate="visible"
            className="divide-y divide-border/60"
          >
            {items.map((d) => (
              <motion.li
                key={d.id}
                variants={fadeUpSmall}
                className="-mx-2 first:pt-0 last:pb-0"
              >
                <Link
                  href={`/datasets/${d.id}`}
                  className="hover:bg-muted/40 group flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="bg-(--color-teal-fill) text-(--color-teal) inline-flex size-7 shrink-0 items-center justify-center rounded-lg">
                      <KindIcon kind={d.source_kind} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-foreground truncate text-sm font-medium" title={d.name}>
                        {d.name}
                      </p>
                      <p className="text-muted-foreground font-mono text-xs tabular-nums md:text-[11px]">
                        {d.row_count != null
                          ? `${d.row_count.toLocaleString()} rows`
                          : "— rows"}{" "}
                        · {d.source_kind}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={d.status} />
                </Link>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </CardContent>
    </Card>
  );
}
