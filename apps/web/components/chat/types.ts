export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls: ToolCallRecord[];
  widget_id: string | null;
  created_at: string;
};

export type ToolCallRecord = {
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  ok?: boolean;
};

export type ChatTokens = {
  used: number;
  remaining: number;
  cap: number;
  period_end: string;
};

export type StreamEvent =
  | { type: "user_message_id"; id: string }
  | { type: "tokens_status"; used: number; remaining: number; cap: number; period_end: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; name: string; ok: boolean; output: unknown }
  | { type: "widget_created"; widget_id: string }
  | { type: "widget_updated"; widget_id: string }
  | { type: "final_answer"; text: string }
  | { type: "assistant_message_id"; id: string }
  | { type: "error"; error: string }
  | { type: "done"; stop_reason?: string; created_widget_ids?: string[]; updated_widget_ids?: string[] }
  | { type: "stream_closed" };
