"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

function readDensityCookie(): "compact" | "comfortable" {
  if (typeof document === "undefined") return "comfortable";
  const match = document.cookie.match(/(?:^|;\s*)prism_density=([^;]+)/);
  return match?.[1] === "compact" ? "compact" : "comfortable";
}

export function PersonalizationCard() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  // next-themes hydrates on the client. Render a stable initial value before
  // mount, then swap to the real one to avoid hydration mismatch warnings.
  const [mounted, setMounted] = useState(false);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    setMounted(true);
    setCompact(readDensityCookie() === "compact");
  }, []);

  function onCompactChange(next: boolean) {
    setCompact(next);
    const value = next ? "compact" : "comfortable";
    // 1 year — long enough to feel persistent without being unbounded.
    document.cookie = `prism_density=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
    // Server-rendered layout reads this cookie to set data-density on <body>.
    router.refresh();
  }

  return (
    <div className="grid gap-6 sm:max-w-md">
      <div className="grid gap-2">
        <Label htmlFor="theme-select">Theme</Label>
        <Select
          value={mounted ? theme ?? "system" : "system"}
          onValueChange={(v) => setTheme(v)}
        >
          <SelectTrigger id="theme-select" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THEME_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          Stored locally in your browser.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <div className="space-y-0.5">
          <Label htmlFor="compact-switch" className="text-sm">
            Compact mode
          </Label>
          <p className="text-muted-foreground text-xs">
            Tighten card padding and main spacing.
          </p>
        </div>
        <Switch
          id="compact-switch"
          checked={compact}
          onCheckedChange={onCompactChange}
          aria-label="Toggle compact mode"
        />
      </div>
    </div>
  );
}
