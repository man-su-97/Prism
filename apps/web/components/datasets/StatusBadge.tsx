import { AlertCircle, Clock, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tone = "pending" | "ingesting" | "ready" | "error" | "unknown";

function toneFor(status: string): Tone {
  switch (status) {
    case "pending":
    case "uploading":
      return "pending";
    case "ingesting":
      return "ingesting";
    case "ready":
      return "ready";
    case "error":
      return "error";
    default:
      return "unknown";
  }
}

const styles: Record<Tone, string> = {
  pending:
    "border-warning/30 bg-warning/10 text-warning-foreground dark:text-warning",
  ingesting:
    "border-primary/30 bg-primary/10 text-primary",
  ready:
    "border-success/30 bg-success/10 text-success",
  error:
    "border-destructive/30 bg-destructive/10 text-destructive",
  unknown:
    "border-border bg-muted text-muted-foreground",
};

function IconFor({ tone }: { tone: Tone }) {
  switch (tone) {
    case "pending":
      return <Clock className="size-3" />;
    case "ingesting":
      return <Loader2 className="size-3 animate-spin" />;
    case "ready":
      return (
        <span className="relative inline-flex size-2 items-center justify-center">
          <span className="absolute inline-flex size-2 rounded-full bg-success opacity-50 motion-safe:animate-ping" />
          <span className="bg-success relative inline-flex size-1.5 rounded-full" />
        </span>
      );
    case "error":
      return <AlertCircle className="size-3" />;
    default:
      return null;
  }
}

export function StatusBadge({ status }: { status: string }) {
  const tone = toneFor(status);
  return (
    <Badge variant="outline" className={cn("gap-1 capitalize", styles[tone])}>
      <IconFor tone={tone} />
      {status}
    </Badge>
  );
}
