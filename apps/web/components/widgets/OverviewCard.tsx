import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Widget } from "./types";

export function OverviewCard({
  overview,
}: {
  widget: Widget;
  overview: string | null;
}) {
  if (overview) {
    return (
      <div className={cn(
        "relative flex h-full flex-col gap-2.5 pl-4",
        "before:absolute before:left-0 before:top-0 before:h-full before:w-0.75",
        "before:bg-linear-to-b before:from-(--brand-from) before:via-(--brand-via) before:to-(--brand-to)",
        "before:rounded-sm",
      )}>
        <div className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider md:text-[11px]">
          <span className="bg-linear-to-br from-(--brand-from) to-(--brand-to) inline-flex size-4 items-center justify-center rounded-md text-white">
            <Sparkles className="size-2.5" />
          </span>
          AI summary
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
          {overview}
        </p>
      </div>
    );
  }
  return (
    <div className="text-muted-foreground flex h-full flex-col items-start justify-center gap-2 text-sm">
      <span className="bg-muted inline-flex size-7 items-center justify-center rounded-full">
        <Sparkles className="size-3.5" />
      </span>
      <p>
        No AI overview available. Set{" "}
        <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
          ANTHROPIC_API_KEY
        </code>{" "}
        and reingest the dataset to generate one.
      </p>
    </div>
  );
}
