"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, Loader2, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { SheetPicker, type SheetPickerSheet } from "@/components/datasets/SheetPicker";
import { useUpgradePrompt } from "@/components/upgrade/UpgradePromptProvider";
import { buildApiError, LimitError, messageFromUnknown, parseApiError } from "@/lib/errors";
import { cn } from "@/lib/utils";

const ACCEPTED = ".csv,.xlsx,.xls";
const MAX_BYTES = 500 * 1024 * 1024;

type PresignResponse = {
  object_key: string;
  url: string;
  expires_in_seconds: number;
};

type Dataset = { id: string; name: string; status: string };

function inferKind(filename: string): "csv" | "xlsx" | "xls" | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".xls")) return "xls";
  return null;
}

function defaultName(filename: string): string {
  return filename.replace(/\.(csv|xlsx|xls)$/i, "");
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/datasets/api?path=${encodeURIComponent(path)}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw await buildApiError(res);
  return res.json() as Promise<T>;
}

type PendingPeek = {
  objectKey: string;
  kind: "xlsx" | "xls";
  sheets: SheetPickerSheet[];
  finalName: string;
};

export function UploadDatasetForm({
  onSuccess,
  onError,
}: {
  onSuccess?: (dataset: Dataset) => void;
  onError?: (msg: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pendingPeek, setPendingPeek] = useState<PendingPeek | null>(null);
  const { openUpgrade } = useUpgradePrompt();

  async function peekSheets(
    objectKey: string,
    kind: "xlsx" | "xls",
  ): Promise<SheetPickerSheet[]> {
    const res = await fetch(
      `/datasets/api?path=${encodeURIComponent("/api/datasets/peek-sheets")}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ object_key: objectKey, source_kind: kind }),
      },
    );
    if (!res.ok) throw new Error(await parseApiError(res));
    return res.json() as Promise<SheetPickerSheet[]>;
  }

  async function registerDataset(payload: {
    name: string;
    source_kind: "csv" | "xlsx" | "xls";
    object_key: string;
    worksheet_names?: string[];
  }): Promise<Dataset> {
    return apiJson<Dataset>("/api/datasets", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  function resetAfterFinish() {
    setBusy(false);
    setProgress(null);
    setStatus("");
  }

  async function commitRegistration(
    objectKey: string,
    kind: "csv" | "xlsx" | "xls",
    worksheetNames: string[] | undefined,
    finalName: string,
  ) {
    setStatus("Registering dataset…");
    try {
      const ds = await registerDataset({
        name: finalName,
        source_kind: kind,
        object_key: objectKey,
        ...(worksheetNames ? { worksheet_names: worksheetNames } : {}),
      });
      resetAfterFinish();
      setPendingPeek(null);
      onSuccess?.(ds);
    } catch (e) {
      if (e instanceof LimitError) {
        resetAfterFinish();
        setPendingPeek(null);
        openUpgrade({ code: e.code, message: e.message });
        return;
      }
      fail(messageFromUnknown(e, "We couldn't upload your file."));
    }
  }

  function pickFile(f: File | null) {
    if (!f) return;
    if (!inferKind(f.name)) {
      setError("Only .csv, .xlsx, and .xls are supported.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("File exceeds the 500 MB per-upload cap.");
      return;
    }
    setFile(f);
    setError(null);
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function fail(msg: string) {
    setError(msg);
    setBusy(false);
    setProgress(null);
    setStatus("");
    onError?.(msg);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;

    setError(null);
    const kind = inferKind(file.name);
    if (!kind) {
      fail("Only .csv, .xlsx, and .xls are supported.");
      return;
    }
    if (file.size > MAX_BYTES) {
      fail("File exceeds the 500 MB per-upload cap.");
      return;
    }

    const trimmed = name.trim();
    const finalName = trimmed.length > 0 ? trimmed : defaultName(file.name);

    setBusy(true);
    try {
      setStatus("Requesting upload URL…");
      const presign = await apiJson<PresignResponse>("/api/datasets/presign", {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          content_type: file.type || "application/octet-stream",
        }),
      });

      setStatus("Uploading to storage…");
      setProgress(0);
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", presign.url, true);
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable)
            setProgress(Math.round((ev.loaded / ev.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`upload_failed_${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("upload_network_error"));
        xhr.setRequestHeader(
          "Content-Type",
          file.type || "application/octet-stream",
        );
        xhr.send(file);
      });

      setProgress(null);

      // CSV: register straight away. xlsx/xls: peek sheets first so the
      // user can pick when there's >1 (single-sheet workbooks auto-pick).
      if (kind === "csv") {
        await commitRegistration(presign.object_key, "csv", undefined, finalName);
        return;
      }

      setStatus("Reading sheets…");
      const sheets = await peekSheets(presign.object_key, kind);
      if (sheets.length === 0) {
        fail("We couldn't find any sheets in that workbook.");
        return;
      }
      if (sheets.length === 1) {
        await commitRegistration(
          presign.object_key,
          kind,
          [sheets[0]!.title],
          finalName,
        );
        return;
      }
      // ≥2 sheets: hand off to the picker step.
      setStatus("");
      setBusy(false);
      setPendingPeek({
        objectKey: presign.object_key,
        kind,
        sheets,
        finalName,
      });
    } catch (e) {
      if (e instanceof LimitError) {
        resetAfterFinish();
        openUpgrade({ code: e.code, message: e.message });
        return;
      }
      fail(messageFromUnknown(e, "We couldn't upload your file."));
    }
  }

  async function onConfirmSheets(titles: string[]) {
    if (!pendingPeek || busy) return;
    setBusy(true);
    setError(null);
    await commitRegistration(
      pendingPeek.objectKey,
      pendingPeek.kind,
      titles,
      pendingPeek.finalName,
    );
  }

  function onCancelSheets() {
    if (busy) return;
    setPendingPeek(null);
    setError(null);
    setStatus("");
  }

  if (pendingPeek) {
    return (
      <div className="space-y-4">
        <SheetPicker
          sheets={pendingPeek.sheets}
          busy={busy}
          onConfirm={(titles) => void onConfirmSheets(titles)}
          onCancel={onCancelSheets}
        />
        {progress !== null ? (
          <div className="space-y-1.5 rounded-lg border bg-muted/30 px-3 py-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{status || "Uploading…"}</span>
              <span className="font-medium tabular-nums">{progress}%</span>
            </div>
            <Progress
              value={progress}
              className="h-2"
              indicatorClassName="bg-linear-to-r from-(--brand-from) via-(--brand-via) to-(--brand-to)"
            />
          </div>
        ) : status ? (
          <p className="text-muted-foreground text-xs">{status}</p>
        ) : null}
        {error ? (
          <p className="text-destructive text-xs" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="upload-file">CSV, XLSX, or XLS file</Label>
        <div
          role="button"
          tabIndex={busy ? -1 : 0}
          aria-disabled={busy}
          onClick={() => {
            if (!busy) inputRef.current?.click();
          }}
          onKeyDown={(e) => {
            if (busy) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            if (busy) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (busy) return;
            e.preventDefault();
            setDragging(false);
            pickFile(e.dataTransfer.files?.[0] ?? null);
          }}
          className={cn(
            "relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed p-6 text-center outline-none",
            "transition-all duration-200 focus-visible:ring-ring/50 focus-visible:ring-2",
            busy && "pointer-events-none opacity-60",
            dragging
              ? "border-primary bg-primary/8 shadow-[0_0_0_4px_oklch(from_var(--primary)_l_c_h/0.10)]"
              : "border-border bg-muted/20 hover:bg-muted/30 hover:border-border/80 cursor-pointer",
          )}
        >
          <Input
            id="upload-file"
            ref={inputRef}
            type="file"
            accept={ACCEPTED}
            disabled={busy}
            className="hidden"
            onChange={(e) => {
              pickFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          {file ? (
            <div className="relative flex w-full min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="bg-primary/10 text-primary shrink-0 rounded-xl p-2">
                  <FileSpreadsheet className="size-5" />
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {formatSize(file.size)} · click or drop to replace
                  </p>
                </div>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Remove file"
                disabled={busy}
                className="shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                  setError(null);
                }}
              >
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <>
              <span
                className={cn(
                  "bg-aurora pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300",
                  dragging && "opacity-60",
                )}
              />
              <div
                className={cn(
                  "relative flex size-10 items-center justify-center rounded-2xl transition-all duration-200",
                  dragging
                    ? "bg-linear-to-br from-(--brand-from) via-(--brand-via) to-(--brand-to) text-white scale-110"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <FileSpreadsheet className="size-5" />
              </div>
              <div className="relative space-y-0.5">
                <p className="text-sm font-medium">
                  {dragging ? "Drop to upload" : "Drop a CSV, XLSX, or XLS, or click to browse"}
                </p>
                <p className="text-muted-foreground text-xs">
                  Up to 500 MB · we&apos;ll profile schema and auto-build a
                  dashboard.
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="upload-name">Name (optional)</Label>
        <Input
          id="upload-name"
          value={name}
          disabled={busy}
          placeholder={file ? defaultName(file.name) : "Leave blank to use the file's name"}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      {progress !== null ? (
        <div className="space-y-1.5 rounded-lg border bg-muted/30 px-3 py-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{status || "Uploading…"}</span>
            <span className="font-medium tabular-nums">{progress}%</span>
          </div>
          <Progress
            value={progress}
            className="h-2"
            indicatorClassName="bg-linear-to-r from-(--brand-from) via-(--brand-via) to-(--brand-to)"
          />
        </div>
      ) : status ? (
        <p className="text-muted-foreground text-xs">{status}</p>
      ) : null}

      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={!file || busy}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          {busy ? "Uploading…" : "Generate dashboard"}
        </Button>
      </div>
    </form>
  );
}
