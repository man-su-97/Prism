"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { CommandMenu } from "@/components/layout/CommandMenu";

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  // Detect platform after mount so SSR and client agree on initial render.
  const [shortcut, setShortcut] = useState("⌘K");

  useEffect(() => {
    const isMac = /mac/i.test(navigator.userAgent);
    setShortcut(isMac ? "⌘K" : "Ctrl K");
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {/* Desktop pill — hidden below sm breakpoint */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open search (${shortcut})`}
        className={cn(
          "text-muted-foreground hidden h-8 max-w-xs flex-1 items-center gap-2 rounded-full",
          "border border-border/70 bg-muted/40 px-3 text-xs transition-colors",
          "hover:border-border hover:text-foreground hover:bg-muted/60 cursor-pointer sm:flex",
        )}
      >
        <Search className="size-3.5 shrink-0" />
        <span className="flex-1 truncate text-left">Search dashboards, datasets…</span>
        <kbd className="text-xs font-medium opacity-70">{shortcut}</kbd>
      </button>

      {/* Mobile icon button — visible only below sm breakpoint */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open search"
        className={cn(
          "flex size-8 items-center justify-center rounded-full sm:hidden",
          "border border-border/70 bg-muted/40 text-muted-foreground transition-colors",
          "hover:bg-muted/60 hover:text-foreground",
        )}
      >
        <Search className="size-4" />
      </button>

      <CommandMenu open={open} onOpenChange={setOpen} />
    </>
  );
}
