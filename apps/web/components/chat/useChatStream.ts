"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useUpgradePrompt } from "@/components/upgrade/UpgradePromptProvider";
import { buildApiError, LimitError, messageFromUnknown, parseApiError } from "@/lib/errors";
import type { ChatMessage, ChatTokens, StreamEvent, ToolCallRecord } from "./types";

type PendingAssistant = {
  text: string;
  toolCalls: ToolCallRecord[];
  widgetId: string | null;
};

const EMPTY_PENDING: PendingAssistant = { text: "", toolCalls: [], widgetId: null };

function parseEvents(buffer: string): { events: StreamEvent[]; rest: string } {
  const events: StreamEvent[] = [];
  let rest = buffer;
  let idx = rest.indexOf("\n\n");
  while (idx !== -1) {
    const block = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    for (const line of block.split("\n")) {
      const trimmed = line.startsWith("data: ") ? line.slice(6) : line;
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as StreamEvent);
      } catch {
        // ignore malformed line
      }
    }
    idx = rest.indexOf("\n\n");
  }
  return { events, rest };
}

export function useChatStream(dashboardId: string, opts: { onMutation?: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingAssistant | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<ChatTokens | null>(null);
  const [tokensExhausted, setTokensExhausted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const { openUpgrade } = useUpgradePrompt();

  const loadTokens = useCallback(async () => {
    try {
      const res = await fetch(
        `/dashboards/api?path=${encodeURIComponent("/api/billing/plan")}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        plan: { chat_tokens_per_month: number };
        usage: {
          chat_tokens_used: number;
          chat_tokens_remaining: number;
          chat_tokens_period_end: string | null;
        };
      };
      setTokens({
        used: data.usage.chat_tokens_used,
        remaining: data.usage.chat_tokens_remaining,
        cap: data.plan.chat_tokens_per_month,
        period_end:
          data.usage.chat_tokens_period_end ?? new Date(Date.now() + 30 * 86_400_000).toISOString(),
      });
      setTokensExhausted(data.usage.chat_tokens_remaining <= 0);
    } catch {
      // ignore — badge will stay hidden until first send
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(
        `/dashboards/api?path=${encodeURIComponent(`/api/chat/${dashboardId}`)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const rows = (await res.json()) as ChatMessage[];
      setMessages(rows);
    } catch {
      // ignore — UI will show whatever it had
    }
  }, [dashboardId]);

  useEffect(() => {
    void loadHistory();
    void loadTokens();
    return () => abortRef.current?.abort();
  }, [loadHistory, loadTokens]);

  const send = useCallback(
    async (message: string) => {
      if (!message.trim() || streaming || tokensExhausted) return;
      setError(null);
      setStreaming(true);
      setPending({ ...EMPTY_PENDING });
      const optimisticUserId = `local-${Date.now()}`;
      const optimistic: ChatMessage = {
        id: optimisticUserId,
        role: "user",
        content: message,
        tool_calls: [],
        widget_id: null,
        created_at: new Date().toISOString(),
      };
      setMessages((m) => [...m, optimistic]);
      let assistantId: string | null = null;

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(
          `/dashboards/api?path=${encodeURIComponent(`/api/chat/${dashboardId}`)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message }),
            signal: ctrl.signal,
          },
        );
        if (!res.ok || !res.body) {
          if (res.status === 402) {
            setTokensExhausted(true);
            setTokens((t) => (t ? { ...t, used: t.cap, remaining: 0 } : t));
          }
          // Drop the optimistic user message — server never accepted it.
          setMessages((m) => m.filter((msg) => msg.id !== optimisticUserId));
          throw await buildApiError(res);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let live: PendingAssistant = { ...EMPTY_PENDING };

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { events, rest } = parseEvents(buffer);
          buffer = rest;
          for (const ev of events) {
            switch (ev.type) {
              case "user_message_id":
                setMessages((m) =>
                  m.map((msg) =>
                    msg.id === optimisticUserId ? { ...msg, id: ev.id } : msg,
                  ),
                );
                break;
              case "tokens_status":
                setTokens({
                  used: ev.used,
                  remaining: ev.remaining,
                  cap: ev.cap,
                  period_end: ev.period_end,
                });
                setTokensExhausted(ev.remaining <= 0);
                break;
              case "assistant_message_id":
                assistantId = ev.id;
                break;
              case "text_delta":
                live = { ...live, text: live.text + ev.text };
                setPending({ ...live });
                break;
              case "final_answer":
                live = { ...live, text: ev.text };
                setPending({ ...live });
                break;
              case "tool_call":
                live = {
                  ...live,
                  toolCalls: [
                    ...live.toolCalls,
                    { name: ev.name, input: ev.input },
                  ],
                };
                setPending({ ...live });
                break;
              case "tool_result": {
                const next = [...live.toolCalls];
                for (let i = next.length - 1; i >= 0; i--) {
                  if (next[i].name === ev.name && next[i].output === undefined) {
                    next[i] = { ...next[i], output: ev.output, ok: ev.ok };
                    break;
                  }
                }
                live = { ...live, toolCalls: next };
                setPending({ ...live });
                break;
              }
              case "widget_created":
              case "widget_updated":
                live = { ...live, widgetId: ev.widget_id };
                setPending({ ...live });
                opts.onMutation?.();
                break;
              case "error":
                setError(ev.error);
                break;
              case "done":
                break;
              case "stream_closed":
                break;
            }
          }
        }

        // Finalise: snapshot the pending assistant turn into messages.
        if (live.text || live.toolCalls.length) {
          setMessages((m) => [
            ...m,
            {
              id: assistantId ?? `local-asst-${Date.now()}`,
              role: "assistant",
              content: live.text,
              tool_calls: live.toolCalls,
              widget_id: live.widgetId,
              created_at: new Date().toISOString(),
            },
          ]);
        }
      } catch (e) {
        if (e instanceof LimitError) {
          openUpgrade({ code: e.code, message: e.message });
        } else if ((e as Error).name !== "AbortError") {
          setError(messageFromUnknown(e, "Couldn't reach the chat backend."));
        }
      } finally {
        setStreaming(false);
        setPending(null);
        abortRef.current = null;
      }
    },
    [dashboardId, openUpgrade, opts, streaming, tokensExhausted],
  );

  const deleteMessage = useCallback(
    async (id: string) => {
      const prev = messages;
      setMessages((m) => m.filter((msg) => msg.id !== id));
      // Local-only id (optimistic, not yet persisted) — nothing to delete server-side.
      if (id.startsWith("local-")) return;
      try {
        const res = await fetch(
          `/dashboards/api?path=${encodeURIComponent(
            `/api/chat/${dashboardId}/messages/${id}`,
          )}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          throw new Error(await parseApiError(res));
        }
      } catch (e) {
        // Roll back on failure so the message reappears.
        setMessages(prev);
        throw e instanceof Error
          ? e
          : new Error(messageFromUnknown(e, "Couldn't delete message."));
      }
    },
    [dashboardId, messages],
  );

  return {
    messages,
    pending,
    streaming,
    error,
    send,
    reload: loadHistory,
    deleteMessage,
    tokens,
    tokensExhausted,
    reloadTokens: loadTokens,
  };
}
