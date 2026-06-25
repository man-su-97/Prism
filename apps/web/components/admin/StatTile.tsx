import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(2) + "K";
  return n.toLocaleString();
}

export function StatTile({
  label,
  value,
  hint,
  accent = "neutral",
}: {
  label: string;
  value: number | string;
  hint?: string;
  accent?: "neutral" | "success" | "warning" | "danger";
}) {
  const accentClass = {
    neutral: "text-foreground",
    success: "text-emerald-600 dark:text-emerald-400",
    warning: "text-amber-600 dark:text-amber-400",
    danger: "text-rose-600 dark:text-rose-400",
  }[accent];

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
          {label}
        </div>
        <div className={cn("mt-1 font-mono text-3xl font-semibold tabular-nums tracking-tight", accentClass)}>
          {typeof value === "number" ? formatNumber(value) : value}
        </div>
        {hint && <div className="text-muted-foreground mt-1 text-xs">{hint}</div>}
      </CardContent>
    </Card>
  );
}
