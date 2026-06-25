"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FileSpreadsheet, Loader2, Search } from "lucide-react";

import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpgradePrompt } from "@/components/upgrade/UpgradePromptProvider";
import { buildApiError, GoogleAuthError, LimitError, messageFromUnknown } from "@/lib/errors";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Spreadsheet = { id: string; name: string; modified_time?: string | null };
type Worksheet = {
  sheet_id: number;
  title: string;
  row_count?: number | null;
  column_count?: number | null;
};

type ConnectResponse = { dataset_id: string; status: string };

async function jsonFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/datasets/api?path=${encodeURIComponent(path)}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  // buildApiError returns a LimitError on 402 (workspace dataset cap on
  // /api/sheets/connect) so the catch can pop the upgrade dialog. The
  // listing GETs can't 402 — they get a regular Error.
  if (!res.ok) throw await buildApiError(res);
  const text = await res.text();
  return JSON.parse(text || "null") as T;
}

export function ConnectSheetForm({
  onSuccess,
  onError,
}: {
  onSuccess?: (res: ConnectResponse) => void;
  onError?: (msg: string) => void;
}) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [query, setQuery] = useState("");
  const [spreadsheets, setSpreadsheets] = useState<Spreadsheet[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<Spreadsheet | null>(null);
  const [worksheets, setWorksheets] = useState<Worksheet[]>([]);
  const [selectedWorksheet, setSelectedWorksheet] = useState<Worksheet | null>(
    null,
  );
  const [interval, setInterval] = useState(60);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleAuthExpired, setGoogleAuthExpired] = useState(false);
  const { openUpgrade } = useUpgradePrompt();

  function handleError(e: unknown, fallback: string) {
    if (e instanceof GoogleAuthError) {
      setGoogleAuthExpired(true);
      setError(e.message);
    } else {
      setGoogleAuthExpired(false);
      setError(messageFromUnknown(e, fallback));
    }
  }

  useEffect(() => {
    let cancelled = false;
    jsonFetch<{ connected: boolean }>("/api/sheets/connected")
      .then((d) => {
        if (!cancelled) setConnected(d.connected);
      })
      .catch(() => {
        if (!cancelled) setConnected(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = query ? `?q=${encodeURIComponent(query)}` : "";
    jsonFetch<Spreadsheet[]>(`/api/sheets/spreadsheets${params}`)
      .then((rows) => {
        if (!cancelled) setSpreadsheets(rows);
      })
      .catch((e) => {
        if (!cancelled) handleError(e, "Couldn't list your spreadsheets.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, query]);

  async function onPickSpreadsheet(sheet: Spreadsheet) {
    setSelectedSheet(sheet);
    setSelectedWorksheet(null);
    setWorksheets([]);
    setError(null);
    try {
      const rows = await jsonFetch<Worksheet[]>(
        `/api/sheets/spreadsheets/${encodeURIComponent(sheet.id)}/worksheets`,
      );
      setWorksheets(rows);
      if (rows.length > 0) setSelectedWorksheet(rows[0]);
    } catch (e) {
      handleError(e, "Couldn't load worksheets for that file.");
    }
  }

  async function onLinkGoogle() {
    await authClient.signIn.social({
      provider: "google",
      callbackURL: "/datasets",
      scopes: [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/spreadsheets.readonly",
      ],
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSheet || !selectedWorksheet || connecting) return;

    setConnecting(true);
    setError(null);
    try {
      const trimmed = name.trim();
      const body: Record<string, unknown> = {
        spreadsheet_id: selectedSheet.id,
        spreadsheet_name: selectedSheet.name,
        worksheet_title: selectedWorksheet.title,
        refresh_interval_minutes: interval,
      };
      // Sent only when the user typed something; backend (Unit 1) falls back
      // to the default `{spreadsheet} · {worksheet}` format otherwise.
      if (trimmed.length > 0) body.name = trimmed;

      const res = await jsonFetch<ConnectResponse>("/api/sheets/connect", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setConnecting(false);
      onSuccess?.(res);
    } catch (e) {
      if (e instanceof LimitError) {
        setConnecting(false);
        openUpgrade({ code: e.code, message: e.message });
        return;
      }
      handleError(e, "Couldn't connect that sheet.");
      setConnecting(false);
      onError?.(messageFromUnknown(e, "Couldn't connect that sheet."));
    }
  }

  if (connected === null) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Checking Google connection…
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="space-y-3 py-4">
        <p className="text-sm">
          Authorise Google so we can read your spreadsheets. Prism only
          requests read-only access to your Drive and Sheets.
        </p>
        <Button type="button" onClick={onLinkGoogle}>
          <img src="/devicon_google.png" alt="" className="size-4" />
          Continue with Google
        </Button>
        {error ? (
          <p className="text-destructive text-xs" role="alert">
            {error}
            {googleAuthExpired ? (
              <>
                {" "}
                <Link
                  href="/settings/connected"
                  className="underline underline-offset-2"
                >
                  Reconnect Google →
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    );
  }

  const placeholderName =
    selectedSheet && selectedWorksheet
      ? `${selectedSheet.name} · ${selectedWorksheet.title}`
      : "Leave blank to use a default name";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="sheet-search">Spreadsheet</Label>
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
          {/* inline style beats Tailwind v4 cascade — pl-* can't override px-* from the base Input class */}
          <Input
            id="sheet-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter spreadsheets…"
            style={{ paddingLeft: "2.25rem" }}
          />
        </div>
        <ul className="bg-background max-h-48 space-y-0.5 overflow-auto rounded-lg border border-border/60 p-1.5 shadow-sm">
          {loading ? (
            <li className="text-muted-foreground flex items-center gap-2 px-2 py-2 text-xs">
              <Loader2 className="size-3 animate-spin" /> Loading…
            </li>
          ) : null}
          {!loading && spreadsheets.length === 0 ? (
            <li className="text-muted-foreground px-2 py-2 text-xs">
              No spreadsheets found.
            </li>
          ) : null}
          {spreadsheets.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => void onPickSpreadsheet(s)}
                className={cn(
                  "hover:bg-accent flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                  selectedSheet?.id === s.id
                    ? "bg-accent ring-1 ring-border/60"
                    : null,
                )}
              >
                <FileSpreadsheet className="text-muted-foreground size-4 shrink-0" />
                <span className="truncate">{s.name}</span>
                {selectedSheet?.id === s.id ? (
                  <CheckCircle2 className="text-success ml-auto size-4 shrink-0" />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selectedSheet ? (
        <div className="space-y-2">
          <Label htmlFor="worksheet">Worksheet</Label>
          <Select
            value={selectedWorksheet?.title ?? ""}
            onValueChange={(v) => {
              const ws = worksheets.find((w) => w.title === v);
              setSelectedWorksheet(ws ?? null);
            }}
          >
            <SelectTrigger id="worksheet">
              <SelectValue placeholder="Select a worksheet" />
            </SelectTrigger>
            <SelectContent>
              {worksheets.map((w) => (
                <SelectItem key={w.title} value={w.title}>
                  {w.title}
                  {w.row_count != null ? ` (${w.row_count} rows)` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {selectedWorksheet ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="interval">Refresh interval (minutes)</Label>
            <Input
              id="interval"
              type="number"
              min={5}
              max={1440}
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
              className="w-32"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sheet-name">Name (optional)</Label>
            <Input
              id="sheet-name"
              value={name}
              placeholder={placeholderName}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </>
      ) : null}

      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
          {googleAuthExpired ? (
            <>
              {" "}
              <Link
                href="/settings/connected"
                className="underline underline-offset-2"
              >
                Reconnect Google →
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={!selectedWorksheet || connecting}
        >
          {connecting ? <Loader2 className="size-4 animate-spin" /> : null}
          {connecting ? "Connecting…" : "Generate dashboard"}
        </Button>
      </div>
    </form>
  );
}
