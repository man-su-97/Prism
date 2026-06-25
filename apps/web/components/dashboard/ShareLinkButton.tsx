"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Globe2,
  Link2,
  Loader2,
  Mail,
  Share2,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { messageFromUnknown, parseApiError } from "@/lib/errors";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TTL_OPTIONS: { label: string; value: string; hours: number | null }[] = [
  { label: "Never expires", value: "never", hours: null },
  { label: "1 hour", value: "1", hours: 1 },
  { label: "1 day", value: "24", hours: 24 },
  { label: "7 days", value: "168", hours: 24 * 7 },
];

type Visibility = "public" | "private";

type ShareRow = {
  id: string;
  token: string;
  recipient_email: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
};

function shareUrlFor(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/share/${token}`;
}

async function jsonFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/dashboards/api?path=${encodeURIComponent(path)}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(await parseApiError(res));
  const txt = await res.text();
  return JSON.parse(txt || "null") as T;
}

export function ShareLinkButton({
  dashboardId,
  dashboardName,
}: {
  dashboardId: string;
  dashboardName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [ttl, setTtl] = useState<string>("never");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [email, setEmail] = useState("");
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadShares = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await jsonFetch<ShareRow[]>(
        `/api/dashboards/${dashboardId}/shares`,
      );
      setShares(rows);
    } catch (e) {
      setError(messageFromUnknown(e, "Couldn't load existing share links."));
    } finally {
      setLoading(false);
    }
  }, [dashboardId]);

  useEffect(() => {
    if (open) void loadShares();
  }, [open, loadShares]);

  async function onCreate() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const hours = TTL_OPTIONS.find((o) => o.value === ttl)?.hours ?? null;
      const recipient = visibility === "private" ? email.trim() : null;
      if (visibility === "private" && !recipient) {
        throw new Error("Enter an email to send the link to.");
      }
      const created = await jsonFetch<ShareRow>(
        `/api/dashboards/${dashboardId}/share`,
        {
          method: "POST",
          body: JSON.stringify({
            ttl_hours: hours,
            recipient_email: recipient,
          }),
        },
      );
      if (recipient) {
        const res = await fetch("/dashboards/api/share-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: recipient,
            dashboardName: dashboardName ?? "your dashboard",
            shareUrl: shareUrlFor(created.token),
            expiresAt: created.expires_at,
          }),
        });
        if (!res.ok) throw new Error(await parseApiError(res));
        setSuccess(`Invite sent to ${recipient}.`);
        setEmail("");
      } else {
        setSuccess("Public link created.");
      }
      setShares((prev) => [created, ...prev]);
    } catch (e) {
      setError(messageFromUnknown(e, "Couldn't create the share link."));
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(id: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(
        `/dashboards/api?path=${encodeURIComponent(`/api/dashboards/${dashboardId}/shares/${id}`)}`,
        { method: "DELETE" },
      );
      if (!res.ok && res.status !== 204) throw new Error(await parseApiError(res));
      setShares((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, revoked_at: new Date().toISOString() } : s,
        ),
      );
    } catch (e) {
      setError(messageFromUnknown(e, "Couldn't revoke that link."));
    }
  }

  async function copy(id: string, token: string) {
    try {
      await navigator.clipboard.writeText(shareUrlFor(token));
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      // older browsers — fall back silently
    }
  }

  const activeShares = shares.filter((s) => !s.revoked_at);
  const revokedShares = shares.filter((s) => s.revoked_at);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" aria-label="Share dashboard">
          <Share2 className="size-4" />
          <span className="hidden sm:inline">Share</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share dashboard</DialogTitle>
          <DialogDescription>
            Create a read-only link, or send a private invite to a specific
            email.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="visibility">Visibility</Label>
              <Select
                value={visibility}
                onValueChange={(v) => setVisibility(v as Visibility)}
              >
                <SelectTrigger id="visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">
                    <span className="inline-flex items-center gap-2">
                      <Globe2 className="size-4" />
                      Public link
                    </span>
                  </SelectItem>
                  <SelectItem value="private">
                    <span className="inline-flex items-center gap-2">
                      <Mail className="size-4" />
                      Email to a person
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ttl">Expires</Label>
              <Select value={ttl} onValueChange={setTtl}>
                <SelectTrigger id="ttl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TTL_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {visibility === "private" ? (
            <div className="space-y-2">
              <Label htmlFor="recipient">Recipient email</Label>
              <Input
                id="recipient"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@example.com"
              />
              <p className="text-muted-foreground text-xs">
                The link is still a view-only URL — anyone with it can open
                the dashboard. The recipient gets it by email and is recorded
                below so you can revoke it.
              </p>
            </div>
          ) : null}

          {error ? (
            <p className="text-destructive text-xs" role="alert">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="text-success text-xs">{success}</p>
          ) : null}

          <Button onClick={onCreate} disabled={busy} className="w-full">
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy
              ? visibility === "private"
                ? "Sending…"
                : "Creating…"
              : visibility === "private"
                ? "Send invite"
                : "Create link"}
          </Button>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Existing links</Label>
              {loading ? (
                <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
              ) : null}
            </div>
            {activeShares.length === 0 && revokedShares.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                No share links yet.
              </p>
            ) : (
              <ul className="divide-border/60 max-h-64 divide-y overflow-y-auto rounded-md border">
                {activeShares.map((s) => (
                  <ShareItem
                    key={s.id}
                    share={s}
                    onCopy={() => copy(s.id, s.token)}
                    onRevoke={() => onRevoke(s.id)}
                    copied={copiedId === s.id}
                  />
                ))}
                {revokedShares.map((s) => (
                  <ShareItem
                    key={s.id}
                    share={s}
                    onCopy={() => {}}
                    onRevoke={() => {}}
                    copied={false}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShareItem({
  share,
  onCopy,
  onRevoke,
  copied,
}: {
  share: ShareRow;
  onCopy: () => void;
  onRevoke: () => void;
  copied: boolean;
}) {
  const revoked = Boolean(share.revoked_at);
  const expired =
    !revoked &&
    share.expires_at !== null &&
    new Date(share.expires_at).getTime() <= Date.now();

  let badge: string;
  let badgeTone: string;
  if (revoked) {
    badge = "Revoked";
    badgeTone = "bg-muted text-muted-foreground";
  } else if (expired) {
    badge = "Expired";
    badgeTone = "bg-muted text-muted-foreground";
  } else if (share.recipient_email) {
    badge = "Private";
    badgeTone = "bg-primary/10 text-primary";
  } else {
    badge = "Public";
    badgeTone = "bg-success/10 text-success";
  }

  return (
    <li className="flex items-start gap-3 px-3 py-4 text-xs">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeTone}`}
          >
            {badge}
          </span>
          <span className="text-foreground/90 truncate font-medium">
            {share.recipient_email ?? "Anyone with the link"}
          </span>
        </div>
        <div className="text-muted-foreground flex flex-wrap gap-x-3">
          <span>Created {formatDate(share.created_at)}</span>
          <span>
            {share.expires_at
              ? `Expires ${formatDate(share.expires_at)}`
              : "No expiry"}
          </span>
          {share.revoked_at ? (
            <span>Revoked {formatDate(share.revoked_at)}</span>
          ) : null}
        </div>
      </div>
      {!revoked && !expired ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onCopy}
            aria-label="Copy link"
            title="Copy link"
          >
            {copied ? (
              <Check className="text-success size-4" />
            ) : (
              <Link2 className="size-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive size-7"
            onClick={onRevoke}
            aria-label="Revoke"
            title="Revoke"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

