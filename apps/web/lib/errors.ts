/*
 * Centralized API-error parsing.
 *
 * The FastAPI side speaks several error shapes:
 *   - HTTPException with a string detail   →  {"detail":"dataset_not_ready"}
 *   - HTTPException with a formatted detail →  {"detail":"bad_config: missing column"}
 *   - Pydantic 422 validation               →  {"detail":[{"loc":[...],"msg":"...","type":"..."}]}
 *   - Plain proxied text (auth proxy etc.) →  raw body
 *
 * The frontend used to surface these directly in error labels and toasts,
 * which leaked JSON to users. Everything that fetches the API should now
 * funnel into `parseApiError` (for a Response) or `messageFromUnknown` (for
 * a caught Error / unknown).
 *
 * Adding a new error code:
 *   1. raise HTTPException(status_code, "my_new_code") on the API side.
 *   2. Add a row to ERROR_DICTIONARY below with the friendly copy.
 */

const ERROR_DICTIONARY: Record<string, string> = {
  // Auth / scoping
  not_authenticated: "Please sign in to continue.",
  no_active_org: "Pick a workspace to continue.",
  forbidden: "You don't have permission to do that.",
  invalid_token: "This link or token is invalid or has expired.",
  missing_signature: "Request signature is missing.",
  invalid_signature: "Request signature is invalid.",

  // Datasets
  unsupported_source_kind: "That source type isn't supported yet.",
  dataset_not_found: "We couldn't find that dataset.",
  dataset_not_ready: "The dataset is still being processed. Try again in a moment.",
  upload_not_found: "We couldn't find the uploaded file. Try uploading again.",
  object_key_not_in_org: "That file doesn't belong to this workspace.",
  not_a_sheet_dataset: "This action only works on Google Sheets datasets.",
  invalid_sort_column: "That column can't be used for sorting.",
  invalid_sort_dir: "Sort direction must be ascending or descending.",
  dataset_busy:
    "This dataset is still being processed. Wait until it finishes (or fails) before deleting.",
  no_sheets_selected: "Pick at least one sheet from the workbook to ingest.",
  no_common_columns:
    "The sheets you picked don't share any column names. Pick sheets with at least one column in common.",
  excel_read_error:
    "We couldn't read that Excel file. It may be corrupted or password-protected.",
  worksheet_not_found:
    "One of the sheets you picked is no longer in the file. Try uploading again.",

  // Dashboards / widgets
  dashboard_not_found: "We couldn't find that dashboard.",
  bad_dashboard_id: "That dashboard ID isn't valid.",
  dashboard_source_not_found: "We couldn't find the dashboard you're duplicating.",
  source_dashboard_required: "Pick a dashboard to duplicate first.",
  widget_not_found: "We couldn't find that widget.",
  widget_missing_sql: "This widget hasn't been configured yet.",
  overview_not_editable: "The AI overview widget can't be edited directly.",
  overview_has_no_data: "There's nothing to summarize yet for this dataset.",

  // Plan / billing
  plan_not_purchasable: "That plan isn't available for purchase.",
  dataset_limit_reached: "You've hit your workspace's dataset limit. Upgrade your plan to add more.",
  widget_limit_reached: "You've hit the widget limit for this dashboard.",
  dashboard_limit_reached: "You've hit the dashboard limit for this dataset. Upgrade your plan to add more.",
  upload_rate_limit_exceeded: "Too many uploads — you can start up to 30 uploads per hour. Please wait a moment before trying again.",
  chat_rate_limited: "You've hit the AI chat rate limit. Try again later.",
  sheet_refresh_rate_limited: "Too many manual refreshes — you can refresh up to 12 times per hour. Please wait a moment.",
  chat_tokens_exhausted: "You've used all your chat messages for this billing period. Upgrade to keep chatting.",

  // Workspaces
  last_workspace:
    "You need at least one workspace to use Prism. Create another workspace before deleting this one.",
  not_workspace_owner: "Only the workspace owner can delete this workspace.",
  workspace_busy:
    "A dataset in this workspace is still being processed. Wait for it to finish, then try again.",

  // Generic
  unsafe_sql: "That query isn't allowed for safety reasons.",
  bad_config: "Widget configuration is invalid.",
  google_api: "Google API call failed.",
  google_auth: "Google sign-in is required to access this resource.",
};

/** Map a snake_case error code (with optional `: extra` suffix) to a friendly sentence. */
export function humanizeErrorCode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "Something went wrong.";

  // Detail strings can look like "bad_config: missing column 'x'". Treat the
  // prefix as the code and append any human-readable suffix.
  const colon = trimmed.indexOf(":");
  const code = colon >= 0 ? trimmed.slice(0, colon).trim() : trimmed;
  const extra = colon >= 0 ? trimmed.slice(colon + 1).trim() : "";

  if (ERROR_DICTIONARY[code]) {
    return extra ? `${ERROR_DICTIONARY[code]} (${extra})` : ERROR_DICTIONARY[code]!;
  }

  // No dictionary hit — but if the code looks snake_case, pretty-print it so
  // the user gets "Dataset not ready" instead of "dataset_not_ready".
  if (/^[a-z][a-z0-9_]*$/.test(code) && code.includes("_")) {
    const pretty = code
      .replace(/_/g, " ")
      .replace(/^./, (c) => c.toUpperCase());
    return extra ? `${pretty}: ${extra}` : `${pretty}.`;
  }

  // Otherwise it's already a sentence — return as-is.
  return trimmed;
}

/**
 * Walk a parsed FastAPI / generic JSON error body and return a single
 * human-readable string. Handles:
 *   - {"detail": "code"}                            → humanized
 *   - {"detail": [{"loc": [...], "msg": "..."}]}    → joined per-field
 *   - {"message": "..."} / {"error": "..."}         → returned directly
 *   - anything else                                  → null (caller falls back)
 */
function extractFromJson(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;

  // Pydantic 422
  if (Array.isArray(obj.detail)) {
    const parts: string[] = [];
    for (const item of obj.detail) {
      if (!item || typeof item !== "object") continue;
      const it = item as { msg?: unknown; loc?: unknown };
      const msg = typeof it.msg === "string" ? it.msg : "";
      const loc = Array.isArray(it.loc)
        ? it.loc
            .slice(1) // drop the leading "body" / "query" / "path"
            .filter((s) => typeof s === "string" || typeof s === "number")
            .join(".")
        : "";
      if (loc && msg) parts.push(`${loc}: ${msg}`);
      else if (msg) parts.push(msg);
    }
    if (parts.length > 0) {
      // Capitalize each part for readability.
      return parts
        .map((p) => p.replace(/^./, (c) => c.toUpperCase()))
        .join(" · ");
    }
  }

  // FastAPI HTTPException
  if (typeof obj.detail === "string") return humanizeErrorCode(obj.detail);

  // Generic envelopes
  if (typeof obj.message === "string") return obj.message;
  if (typeof obj.error === "string") return obj.error;
  if (obj.error && typeof obj.error === "object") {
    const inner = obj.error as Record<string, unknown>;
    if (typeof inner.message === "string") return inner.message;
  }

  return null;
}

/** Default fallback when we can't classify a response. */
function fallbackFor(status: number): string {
  if (status === 0) return "We couldn't reach the server. Check your connection.";
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "We couldn't find what you were looking for.";
  if (status === 408 || status === 504) return "The server took too long to respond. Try again.";
  if (status === 413) return "That file is too large.";
  if (status === 429) return "Too many requests — slow down and try again.";
  if (status >= 500) return "Something went wrong on our side. Try again shortly.";
  if (status >= 400) return "We couldn't complete that request.";
  return "Something went wrong.";
}

/**
 * Read a non-OK Response and return a friendly error message. Always resolves —
 * never throws — so callers can `throw new Error(await parseApiError(res))`.
 */
export async function parseApiError(res: Response): Promise<string> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    /* body already consumed or unreadable */
  }
  return messageFromBody(res.status, text);
}

function messageFromBody(status: number, text: string): string {
  if (text) {
    try {
      const json = JSON.parse(text);
      const fromJson = extractFromJson(json);
      if (fromJson) return fromJson;
    } catch {
      // Not JSON — fall through to text handling.
    }
    const stripped = text.replace(/<[^>]*>/g, "").trim();
    if (stripped && stripped.length < 200 && !stripped.startsWith("{")) {
      return humanizeErrorCode(stripped);
    }
  }
  return fallbackFor(status);
}

/**
 * Thrown by `buildApiError` when the backend returns 401 with a `google_auth`
 * detail. Callers can catch this specifically to show a "Reconnect Google →
 * Settings → Connected accounts" CTA rather than a plain error string.
 */
export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

function detectGoogleAuth(status: number, parsed: unknown): boolean {
  if (status !== 401) return false;
  if (!parsed || typeof parsed !== "object") return false;
  const detail = (parsed as Record<string, unknown>).detail;
  if (typeof detail !== "string") return false;
  return detail.split(":")[0]?.trim() === "google_auth";
}

/**
 * Thrown by `throwApiError` when the backend returns 402 with a plan-limit
 * detail. The `code` identifies which limit was hit so UI can pop a
 * contextual upgrade prompt; the message is already human-readable.
 */
export class LimitError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly detail: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "LimitError";
  }
}

const LIMIT_CODES = new Set([
  "plan_limit",
  "chat_tokens_exhausted",
  "dataset_limit_reached",
  "widget_limit_reached",
  "dashboard_limit_reached",
  "chat_rate_limited",
]);

function detectLimit(
  status: number,
  parsed: unknown,
): { code: string; detail: Record<string, unknown> | null } | null {
  // 402 is reserved for plan-limit errors. Anything else falls through.
  if (status !== 402) return null;
  if (!parsed || typeof parsed !== "object") {
    return { code: "plan_limit", detail: null };
  }
  const obj = parsed as Record<string, unknown>;
  const detail = obj.detail;
  if (typeof detail === "string") {
    const code = detail.split(":")[0]?.trim() ?? "plan_limit";
    return {
      code: LIMIT_CODES.has(code) ? code : "plan_limit",
      detail: null,
    };
  }
  if (detail && typeof detail === "object") {
    const inner = detail as Record<string, unknown>;
    const rawCode = typeof inner.error === "string" ? inner.error : null;
    const code = rawCode && LIMIT_CODES.has(rawCode) ? rawCode : "plan_limit";
    return { code, detail: inner };
  }
  return { code: "plan_limit", detail: null };
}

/**
 * Build an Error for a non-OK Response. Returns a `LimitError` for 402
 * limit payloads (so callers can pop the upgrade dialog), plain `Error`
 * otherwise.
 *
 * Replace `if (!res.ok) throw new Error(await parseApiError(res));` with
 * `if (!res.ok) throw await buildApiError(res);` at call sites that touch
 * limit-prone endpoints (chat post, dataset POST, sheet connect, widget
 * create). In the catch:
 *   if (e instanceof LimitError) openUpgrade({ code: e.code, message: e.message });
 *   else setError(messageFromUnknown(e, "..."));
 */
export async function buildApiError(res: Response): Promise<Error> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    /* body already consumed or unreadable */
  }
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not JSON */
    }
  }
  const limit = detectLimit(res.status, parsed);
  const message = messageFromBody(res.status, text);
  if (detectGoogleAuth(res.status, parsed)) return new GoogleAuthError(message);
  if (limit) return new LimitError(message, limit.code, limit.detail);
  return new Error(message);
}

/**
 * Surface a friendly message from a value caught in a `catch` block. Strings
 * that look like JSON are re-parsed; structured errors thrown by our fetch
 * helpers are unwrapped.
 */
export function messageFromUnknown(err: unknown, fallback = "Something went wrong."): string {
  if (!err) return fallback;
  if (typeof err === "string") return tidy(err) ?? fallback;
  if (err instanceof Error) return tidy(err.message) ?? fallback;
  if (typeof err === "object") {
    try {
      const s = JSON.stringify(err);
      return tidy(s) ?? fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function tidy(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Strings that look like raw JSON — re-parse and extract.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const json = JSON.parse(trimmed);
      const extracted = extractFromJson(json);
      if (extracted) return extracted;
    } catch {
      /* fall through */
    }
  }
  // Strings of the form "api 400: {...json...}" produced by old fetch wrappers.
  const apiMatch = trimmed.match(/^api\s+(\d+):\s*(.*)$/i);
  if (apiMatch) {
    const inner = apiMatch[2]!;
    if (inner.startsWith("{") || inner.startsWith("[")) {
      try {
        const json = JSON.parse(inner);
        const extracted = extractFromJson(json);
        if (extracted) return extracted;
      } catch {
        /* fall through */
      }
    }
    return fallbackFor(Number(apiMatch[1]));
  }
  // Bare snake_case code that bubbled up unchanged.
  if (/^[a-z][a-z0-9_]*$/.test(trimmed)) return humanizeErrorCode(trimmed);
  return trimmed;
}
