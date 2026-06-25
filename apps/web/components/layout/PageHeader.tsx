import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  /** Optional small label above the title. Renders as a muted, uppercase tag. */
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6 sm:px-6 sm:py-6",
        "border-b border-border/60",
        className,
      )}
    >
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? (
          <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium uppercase tracking-wider md:text-[11px]">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-foreground text-2xl font-semibold tracking-tight sm:text-[28px]">
          {title}
        </h1>
        {description ? (
          <p className="text-muted-foreground max-w-2xl text-sm">{description}</p>
        ) : null}
        {children}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
