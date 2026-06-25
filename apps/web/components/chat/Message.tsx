"use client";

import { motion } from "framer-motion";
import { Check, Copy, Trash2 } from "lucide-react";
import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

import type { ChatMessage } from "./types";

const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => (
    <p className="leading-relaxed [&:not(:first-child)]:mt-2">{children}</p>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => (
    <h1 className="mt-3 mb-1 text-base font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-3 mb-1 text-sm font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</h3>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-2 hover:opacity-80"
    >
      {children}
    </a>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <code className="font-mono text-[12px]" {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="bg-foreground/10 rounded px-1 py-0.5 font-mono text-[12px]"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="bg-foreground/10 my-2 max-h-64 overflow-auto rounded-md p-2 font-mono text-[12px] leading-relaxed">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-foreground/20 my-2 border-l-2 pl-3 italic opacity-90">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="border-foreground/15 min-w-full border-collapse border text-xs">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-foreground/5">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="border-foreground/15 border px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-foreground/15 border px-2 py-1 align-top">
      {children}
    </td>
  ),
  hr: () => <hr className="border-foreground/15 my-2" />,
};

export function MessageBubble({
  message,
  streaming = false,
  onDelete,
}: {
  message: ChatMessage;
  streaming?: boolean;
  onDelete?: (id: string) => void | Promise<void>;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const canAct = !streaming && !!message.content;

  async function handleCopy() {
    if (!message.content) return;
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard blocked (e.g. insecure context) — silently no-op.
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "group/msg flex flex-col gap-1",
        isUser ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "max-w-[85%] space-y-1 rounded-2xl px-3.5 py-2 text-sm shadow-[0_1px_0_oklch(from_var(--foreground)_l_c_h/0.04)]",
          isUser
            ? "bg-linear-to-br from-primary to-[oklch(from_var(--primary)_calc(l*0.9)_c_h)] text-primary-foreground"
            : "bg-muted/70 text-foreground ring-1 ring-border/60",
        )}
      >
        {message.content ? (
          isUser ? (
            <p className="whitespace-pre-wrap leading-relaxed">
              {message.content}
              {streaming ? (
                <span className="ml-0.5 inline-block h-3.5 w-0.5 -translate-y-px animate-pulse rounded-sm bg-current align-middle opacity-70" />
              ) : null}
            </p>
          ) : (
            <div className="break-words">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                {message.content}
              </ReactMarkdown>
              {streaming ? (
                <span className="ml-0.5 inline-block h-3.5 w-0.5 -translate-y-px animate-pulse rounded-sm bg-current align-middle opacity-70" />
              ) : null}
            </div>
          )
        ) : streaming ? (
          <span className="inline-flex items-center gap-1">
            <span className="size-1.5 animate-bounce rounded-full bg-current opacity-60 [animation-delay:0ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-current opacity-60 [animation-delay:120ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-current opacity-60 [animation-delay:240ms]" />
          </span>
        ) : null}
        {message.widget_id ? (
          <a
            href={`#widget-${message.widget_id}`}
            className="block text-xs underline underline-offset-2 opacity-80 transition-opacity hover:opacity-100"
          >
            View affected widget →
          </a>
        ) : null}
      </div>
      {canAct ? (
        <div
          className={cn(
            "flex items-center gap-0.5 px-1 transition-opacity duration-150 focus-within:opacity-100",
            "opacity-100 md:opacity-0 md:group-hover/msg:opacity-100",
            isUser ? "flex-row-reverse" : "flex-row",
          )}
        >
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? "Copied" : "Copy message"}
            title={copied ? "Copied" : "Copy"}
            className="text-muted-foreground hover:text-foreground hover:bg-muted/80 inline-flex size-8 items-center justify-center rounded-md transition-colors md:size-6"
          >
            {copied ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
          {onDelete ? (
            <button
              type="button"
              onClick={() => void onDelete(message.id)}
              aria-label="Delete message"
              title="Delete"
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 inline-flex size-8 items-center justify-center rounded-md transition-colors md:size-6"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
    </motion.div>
  );
}
