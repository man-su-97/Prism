"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { messageFromUnknown } from "@/lib/errors";

export type DeleteImpactRow = { label: string; count: number };

export function DeleteEntityDialog({
  open,
  onOpenChange,
  title,
  entityLabel,
  entityName,
  impact,
  blockedReason,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: string;
  entityLabel: string;
  entityName: string;
  impact: DeleteImpactRow[];
  blockedReason?: string | null;
  onConfirm: () => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTyped("");
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const nameMatches = typed.trim() === entityName.trim();
  const blocked = Boolean(blockedReason);
  const visibleImpact = impact.filter((row) => row.count > 0);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setBusy(false);
      setError(messageFromUnknown(err, `Couldn't delete this ${entityLabel}.`));
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="text-destructive size-5" />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the {entityLabel} and everything anchored
            to it. We can&apos;t recover it.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          {blocked ? (
            <p
              className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3.5 text-xs"
              role="alert"
            >
              {blockedReason}
            </p>
          ) : null}

          {visibleImpact.length > 0 ? (
            <ul className="text-muted-foreground space-y-1 text-xs">
              {visibleImpact.map((row) => (
                <li key={row.label}>
                  <span className="text-foreground font-medium">
                    {row.count}
                  </span>{" "}
                  {row.label}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-xs">
              No linked items will be affected.
            </p>
          )}

          <div className="space-y-2.5">
            <Label htmlFor="delete-entity-confirm">
              Type{" "}
              <span className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
                {entityName}
              </span>{" "}
              to confirm
            </Label>
            <Input
              id="delete-entity-confirm"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={busy || blocked}
            />
          </div>

          {error ? (
            <p className="text-destructive text-xs" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || blocked || !nameMatches}
            className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/40"
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy ? "Deleting…" : `Delete ${entityLabel}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
