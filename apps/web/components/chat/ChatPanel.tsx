"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Zap, X, ArrowUp } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpgradePrompt } from "@/components/upgrade/UpgradePromptProvider";
import { messageFromUnknown } from "@/lib/errors";
import { cn } from "@/lib/utils";

import { MessageBubble } from "./Message";
import { useChatStream } from "./useChatStream";
import type { ChatMessage, ChatTokens } from "./types";

function formatResetCopy(period_end: string): string {
  const dt = new Date(period_end);
  if (Number.isNaN(dt.getTime())) return "soon";
  const diffMs = dt.getTime() - Date.now();
  const days = Math.round(diffMs / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 14) return `in ${days} days`;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const SUGGESTIONS = [
  "What was total revenue last month?",
  "Add a bar chart of orders by region",
  "Show top 5 customers by spend",
];

export function ChatPanel({
  open,
  dashboardId,
  onMutation,
  onOpenChange,
  className,
}: {
  open: boolean;
  dashboardId: string;
  onMutation: () => void;
  onOpenChange: (open: boolean) => void;
  className?: string;
}) {
  const {
    messages,
    pending,
    streaming,
    error,
    send,
    deleteMessage,
    tokens,
    tokensExhausted,
  } = useChatStream(dashboardId, { onMutation });
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { openUpgrade } = useUpgradePrompt();

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending?.text, pending?.toolCalls.length]);

  if (!open) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    await send(text);
  }

  async function fireSuggestion(prompt: string) {
    if (streaming) return;
    await send(prompt);
  }

  async function handleDelete(id: string) {
    try {
      await deleteMessage(id);
    } catch (e) {
      toast.error(messageFromUnknown(e, "Couldn't delete message."));
    }
  }

  const pendingAsMessage: ChatMessage | null = pending
    ? {
        id: "pending",
        role: "assistant",
        content: pending.text,
        tool_calls: pending.toolCalls,
        widget_id: pending.widgetId,
        created_at: new Date().toISOString(),
      }
    : null;

  return (
    <aside
      className={cn(
        // Mobile: true full-screen viewport overlay.
        // z-[100] clears the sticky header (z-30) and any shadcn sheet/dialog.
        // The parent DashboardClient has NO overflow:hidden so fixed positioning
        // is NOT trapped by a scroll-container ancestor (Chrome behaviour).
        "fixed inset-0 z-100 flex flex-col bg-background",
        // md+: inline sidebar anchored to the right of the dashboard grid.
        "md:relative md:inset-auto md:z-auto md:h-full md:w-96 md:shrink-0 md:border-l md:border-border/60",
        className,
      )}
      aria-label="Ask your data"
    >
      {/* Safe-area top padding for iOS notch */}
      <div
        className="relative gap-1 overflow-hidden border-b border-border/60 px-4 py-3.5"
        style={{ paddingTop: "max(0.875rem, env(safe-area-inset-top))" }}
      >
        <span
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_0%_0%,oklch(from_var(--brand-from)_l_c_h/0.10),transparent_60%)]"
          aria-hidden
        />
        <div className="relative flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className="bg-linear-to-br from-(--brand-from) via-(--brand-via) to-(--brand-to) inline-flex size-6 items-center justify-center rounded-lg text-white shadow-[0_2px_8px_-2px_oklch(from_var(--primary)_l_c_h/0.35)]">
              <Sparkles className="size-3.5" />
            </span>
            Ask your data
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close chat"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-4" />
          </Button>
        </div>
        <p className="relative mt-0.5 text-xs text-muted-foreground">
          Natural-language queries against this dashboard&apos;s dataset.
        </p>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto p-4">
        {messages.length === 0 && !pending ? (
          <div className="space-y-3">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              Try one of these
            </p>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <Button
                  key={s}
                  variant="outline"
                  size="sm"
                  className="h-auto justify-start whitespace-normal rounded-xl py-2 px-3 text-left text-xs transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-foreground hover:-translate-y-px"
                  onClick={() => void fireSuggestion(s)}
                >
                  <Sparkles className="text-primary size-3 shrink-0 opacity-80" />
                  {s}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} onDelete={handleDelete} />
            ))}
            {pendingAsMessage ? (
              <MessageBubble message={pendingAsMessage} streaming />
            ) : null}
            {error ? (
              <p className="text-destructive text-xs" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        )}
      </div>

      {tokensExhausted ? (
        <div className="border-t border-border/60 bg-background/80 p-3 space-y-2">
          <div className="rounded-xl border border-warning/30 bg-warning/5 px-3 py-2.5 text-xs">
            <div className="font-medium text-foreground">
              You&apos;ve used all {tokens?.cap ?? "your"} chat messages this month.
            </div>
            <div className="mt-0.5 text-muted-foreground">
              Resets {tokens ? formatResetCopy(tokens.period_end) : "soon"}.
            </div>
          </div>
          <Button
            size="sm"
            className="w-full rounded-full"
            onClick={() =>
              openUpgrade({
                code: "chat_tokens_exhausted",
                message: `You've used all ${tokens?.cap ?? "your"} chat messages this month.`,
              })
            }
          >
            <Zap className="size-3.5" />
            Upgrade for more
          </Button>
        </div>
      ) : (
        <div className="border-t border-border/60 bg-background/80 supports-backdrop-filter:bg-background/60 backdrop-blur">
          {tokens ? <TokenStatusBar tokens={tokens} /> : null}
          {/* pb uses safe-area-inset-bottom so the input clears the iOS home bar */}
          <form
            onSubmit={onSubmit}
            className="px-3 pt-1"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
            <div className="relative flex items-center gap-2 rounded-full border border-border bg-background/80 px-1 transition-colors focus-within:border-primary/50 focus-within:shadow-[0_0_0_4px_oklch(from_var(--primary)_l_c_h/0.12)]">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={streaming ? "Working…" : "Ask anything about this dataset"}
                disabled={streaming}
                className="flex-1 min-w-0 border-0 bg-transparent shadow-none focus-visible:border-0 focus-visible:ring-0 focus-visible:shadow-none"
              />
              <Button
                type="submit"
                size="icon-sm"
                disabled={streaming || !input.trim()}
                aria-label="Send"
                className="shrink-0 rounded-full"
              >
                <ArrowUp className="size-3.5" />
              </Button>
            </div>
          </form>
        </div>
      )}
    </aside>
  );
}

function TokenStatusBar({ tokens }: { tokens: ChatTokens }) {
  const pct = Math.min(
    100,
    Math.max(0, Math.round((tokens.remaining / Math.max(1, tokens.cap)) * 100)),
  );
  const low =
    tokens.remaining > 0 &&
    tokens.remaining <= Math.max(1, Math.floor(tokens.cap * 0.2));
  return (
    <div className="px-3 pt-2.5 pb-1.5">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span
          className={cn(
            "inline-flex items-center gap-1 font-mono font-medium tabular-nums",
            low ? "text-warning-foreground dark:text-warning" : "text-foreground/80",
          )}
        >
          <Zap className={cn("size-3", low ? "text-warning" : "text-primary/70")} />
          {tokens.remaining} of {tokens.cap} messages left
        </span>
        <span className="shrink-0 font-mono text-muted-foreground">
          Resets {formatResetCopy(tokens.period_end)}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted/70">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            low
              ? "bg-warning"
              : "bg-linear-to-r from-(--brand-from) via-(--brand-via) to-(--brand-to)",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
