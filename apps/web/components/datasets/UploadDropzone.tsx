"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
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

type Dataset = {
  id: string;
  name: string;
  status: string;
};

function inferKind(filename: string): "csv" | "xlsx" | "xls" | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".xls")) return "xls";
  return null;
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/datasets/api?path=${encodeURIComponent(path)}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
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

export function UploadDropzone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingPeek, setPendingPeek] = useState<PendingPeek | null>(null);
  const { openUpgrade } = useUpgradePrompt();

  const peekSheets = useCallback(
    async (objectKey: string, kind: "xlsx" | "xls"): Promise<SheetPickerSheet[]> => {
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
    },
    [],
  );

  const commitRegistration = useCallback(
    async (
      objectKey: string,
      kind: "csv" | "xlsx" | "xls",
      worksheetNames: string[] | undefined,
      finalName: string,
    ) => {
      setStatus("Registering dataset…");
      try {
        const ds = await apiJson<Dataset>("/api/datasets", {
          method: "POST",
          body: JSON.stringify({
            name: finalName,
            source_kind: kind,
            object_key: objectKey,
            ...(worksheetNames ? { worksheet_names: worksheetNames } : {}),
          }),
        });
        setStatus("");
        setProgress(null);
        setBusy(false);
        setPendingPeek(null);
        router.push(`/datasets/${ds.id}`);
        router.refresh();
      } catch (e) {
        setProgress(null);
        setStatus("");
        setBusy(false);
        setPendingPeek(null);
        if (e instanceof LimitError) {
          openUpgrade({ code: e.code, message: e.message });
          return;
        }
        setError(messageFromUnknown(e, "We couldn't upload your file."));
      }
    },
    [openUpgrade, router],
  );

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      const kind = inferKind(file.name);
      if (!kind) {
        setError("Only .csv, .xlsx, and .xls are supported.");
        return;
      }
      if (file.size > MAX_BYTES) {
        setError("File exceeds the 500 MB per-upload cap.");
        return;
      }

      const finalName = file.name.replace(/\.(csv|xlsx|xls)$/i, "");
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
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable)
              setProgress(Math.round((e.loaded / e.total) * 100));
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

        if (kind === "csv") {
          await commitRegistration(presign.object_key, "csv", undefined, finalName);
          return;
        }

        setStatus("Reading sheets…");
        const sheets = await peekSheets(presign.object_key, kind);
        if (sheets.length === 0) {
          setStatus("");
          setBusy(false);
          setError("We couldn't find any sheets in that workbook.");
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
        setProgress(null);
        setStatus("");
        setBusy(false);
        if (e instanceof LimitError) {
          openUpgrade({ code: e.code, message: e.message });
          return;
        }
        setError(messageFromUnknown(e, "We couldn't upload your file."));
      }
    },
    [commitRegistration, openUpgrade, peekSheets],
  );

  const onConfirmSheets = useCallback(
    async (titles: string[]) => {
      if (!pendingPeek || busy) return;
      setBusy(true);
      setError(null);
      await commitRegistration(
        pendingPeek.objectKey,
        pendingPeek.kind,
        titles,
        pendingPeek.finalName,
      );
    },
    [busy, commitRegistration, pendingPeek],
  );

  const onCancelSheets = useCallback(() => {
    if (busy) return;
    setPendingPeek(null);
    setError(null);
    setStatus("");
  }, [busy]);

  if (pendingPeek) {
    return (
      <div className="rounded-2xl border bg-card p-4 space-y-3">
        <SheetPicker
          sheets={pendingPeek.sheets}
          busy={busy}
          onConfirm={(titles) => void onConfirmSheets(titles)}
          onCancel={onCancelSheets}
        />
        {progress !== null ? (
          <div className="space-y-1">
            <Progress value={progress} indicatorClassName="bg-linear-to-r from-(--brand-from) via-(--brand-via) to-(--brand-to)" />
            <p className="text-muted-foreground text-xs">
              {status} {progress}%
            </p>
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
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void upload(file);
      }}
      className={cn(
        "relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-dashed p-10 text-center",
        "transition-all duration-200",
        dragging
          ? "border-primary bg-primary/8 shadow-[0_0_0_4px_oklch(from_var(--primary)_l_c_h/0.10)]"
          : "border-border bg-muted/20 hover:border-border/80 hover:bg-muted/30",
      )}
    >
      {/* Soft brand wash on drag — fades up subtly */}
      <span
        className={cn(
          "bg-aurora pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300",
          dragging && "opacity-60",
        )}
      />
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
      <div
        className={cn(
          "relative flex size-12 items-center justify-center rounded-2xl transition-all duration-200",
          dragging
            ? "bg-linear-to-br from-(--brand-from) via-(--brand-via) to-(--brand-to) text-white scale-110 shadow-[0_8px_24px_-6px_oklch(from_var(--primary)_l_c_h/0.35)]"
            : "bg-muted text-muted-foreground",
        )}
      >
        <FileSpreadsheet className="size-5" />
      </div>
      <div className="relative space-y-1">
        <p className="text-sm font-medium">
          {dragging ? "Drop to upload" : "Drop a CSV, XLSX, or XLS"}
        </p>
        <p className="text-muted-foreground text-xs">
          Up to 500 MB · we&apos;ll profile schema and auto-build a dashboard.
        </p>
      </div>
      <Button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="relative bg-(--color-lime) text-white dark:text-[#111111] hover:opacity-90 border-0"
      >
        <Upload className="size-4" />
        Choose a file
      </Button>
      {progress !== null ? (
        <div className="w-full max-w-xs space-y-1">
          <Progress value={progress} indicatorClassName="bg-linear-to-r from-(--brand-from) via-(--brand-via) to-(--brand-to)" />
          <p className="text-muted-foreground text-xs">
            {status} {progress}%
          </p>
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
