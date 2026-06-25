# Stratasphere — Implementation Plan

## Context

**Stratasphere** is a multi-tenant SaaS that turns any uploaded dataset (Excel, CSV, Google Sheets) into an interactive analytics dashboard with an AI chat companion. The user uploads a file → the system profiles the columns, generates a starter dashboard (KPIs + charts + overview), and lets the user (a) drag/drop/resize widgets and (b) chat with their data in natural language — including asking the chatbot to add or modify widgets on the dashboard.

The product collapses three workflows that today require three tools:
- BI dashboard builders (Tableau, Looker) — too heavyweight, no AI authoring
- Spreadsheet analysis — manual, doesn't scale past one file
- Chat-with-your-data tools — answer questions but don't persist insights as widgets

The greenfield workspace is `/home/vicky/Work/projects/strata` (empty). v1 ships as a self-hosted multi-tenant SaaS via Docker Compose.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│ Browser                                                                │
│  Next.js 15 (App Router) · React 19 · Tailwind · shadcn/ui            │
│  Recharts · react-grid-layout · Better Auth client · Stripe checkout  │
└──────────────┬────────────────────────────────┬────────────────────────┘
               │ HTTPS (session cookie)         │
               ▼                                ▼
┌──────────────────────────────┐   ┌──────────────────────────────────┐
│ Next.js server (Node)        │   │ FastAPI (Python 3.12)            │
│  • Better Auth (sessions,    │   │  • /datasets    ingest, profile  │
│    orgs, invites)            │   │  • /dashboards  CRUD + auto-gen  │
│  • Stripe webhooks           │   │  • /widgets     CRUD             │
│  • UI route handlers         │   │  • /query       SQL execution    │
│  • Issues short-lived JWT    │◀──┤  • /chat        Claude tool-use  │
│    for backend calls         │   │  • Verifies Better Auth JWT      │
└──────────┬───────────────────┘   └──────┬───────────────┬──────────┘
           │                              │               │
           ▼                              ▼               ▼
┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────┐
│ Postgres (metadata)  │   │ DuckDB + Parquet     │   │ MinIO (S3)   │
│  users, orgs,        │   │  per-workspace store │   │  raw uploads │
│  dashboards, widgets,│   │  one Parquet file    │   │  exports     │
│  datasets, chats,    │   │  per dataset table   │   │              │
│  subscriptions, RLS  │   │                      │   │              │
└──────────────────────┘   └──────────────────────┘   └──────────────┘
                                      ▲
                                      │
                          ┌───────────┴────────────┐
                          │ Arq worker (Redis)     │
                          │  ingestion, profiling, │
                          │  Google Sheets sync    │
                          └────────────────────────┘
                                      │
                                      ▼
                          ┌────────────────────────┐
                          │ Anthropic Claude API   │
                          │  text-to-SQL + tools   │
                          └────────────────────────┘
```

**Why this split**
- Next.js owns auth (Better Auth is TS-only) and the UI; FastAPI owns data, analytics, and AI — Python's pandas/duckdb/openpyxl ecosystem handles the data work natively.
- DuckDB is the analytical engine; Postgres is only for app metadata. Keeping them separate lets DuckDB hold tens of millions of rows in Parquet without bloating Postgres.
- Arq (Redis-backed async tasks) avoids blocking the API thread on large file ingestion.

---

## Repository layout

```
strata/
├── apps/
│   ├── web/                    # Next.js 15
│   │   ├── app/
│   │   │   ├── (auth)/         # login, signup, accept-invite
│   │   │   ├── (app)/          # authenticated routes
│   │   │   │   ├── dashboards/[id]/page.tsx
│   │   │   │   ├── datasets/page.tsx
│   │   │   │   └── settings/billing/page.tsx
│   │   │   └── api/auth/[...all]/route.ts   # Better Auth handler
│   │   ├── components/
│   │   │   ├── dashboard/      # grid, widget shell, edit toolbar
│   │   │   ├── widgets/        # KpiCard, LineChart, BarChart, etc.
│   │   │   ├── chat/           # chat panel, message renderer
│   │   │   └── upload/         # dropzone, progress
│   │   ├── lib/
│   │   │   ├── auth.ts         # Better Auth server config
│   │   │   ├── api-client.ts   # typed fetch wrapper → FastAPI
│   │   │   └── stripe.ts
│   │   └── package.json
│   └── api/                    # FastAPI
│       ├── app/
│       │   ├── main.py
│       │   ├── deps/auth.py    # verify Better Auth JWT
│       │   ├── routers/
│       │   │   ├── datasets.py
│       │   │   ├── dashboards.py
│       │   │   ├── widgets.py
│       │   │   ├── query.py
│       │   │   └── chat.py
│       │   ├── services/
│       │   │   ├── ingest.py        # Excel/CSV/Sheets → Parquet
│       │   │   ├── profile.py       # column type inference, stats
│       │   │   ├── autodash.py      # heuristic dashboard generator
│       │   │   ├── duck.py          # per-workspace DuckDB connection
│       │   │   └── chat_agent.py    # Claude tool-use loop
│       │   ├── models/         # SQLAlchemy ORM + Pydantic schemas
│       │   └── workers/tasks.py  # Arq jobs
│       └── pyproject.toml
├── packages/
│   └── shared-types/           # generated TS types from Pydantic via openapi-typescript
├── infra/
│   ├── docker-compose.yml
│   ├── Dockerfile.web
│   ├── Dockerfile.api
│   ├── Caddyfile               # reverse proxy + TLS
│   └── postgres/migrations/    # Alembic
└── README.md
```

---

## Data model (Postgres)

Tenant boundary is `organization` (Better Auth concept). Every row carries `organization_id`; Postgres Row-Level Security enforces isolation.

| Table | Key columns | Notes |
|-------|-------------|-------|
| `organizations` | id, slug, stripe_customer_id, plan | Better Auth org |
| `users` | id, email, name | Better Auth user |
| `memberships` | user_id, org_id, role | owner / admin / member |
| `datasets` | id, org_id, name, source_type, source_uri, status, row_count, column_count | source_type ∈ excel\|csv\|gsheet |
| `dataset_columns` | id, dataset_id, name, dtype, semantic_type, stats_json | semantic_type ∈ numeric / datetime / categorical / id / text |
| `dashboards` | id, org_id, dataset_id, name, layout_json | layout = react-grid-layout array |
| `widgets` | id, dashboard_id, type, title, config_json, position_json | type ∈ kpi / line / bar / pie / table / overview |
| `chat_sessions` | id, dashboard_id, user_id | one per dashboard per user |
| `chat_messages` | id, session_id, role, content, tool_calls_json, widget_id | links assistant turns to any widget created |
| `subscriptions` | org_id, stripe_subscription_id, status, current_period_end | |

DuckDB stores actual data as `{org_id}/{dataset_id}.parquet` on the host volume, opened on-demand per request.

---

## Core flows

### 1. File upload → auto-dashboard

1. User drops `sales.xlsx` in the web UI.
2. `apps/web` requests a presigned PUT URL from `apps/api`, uploads directly to MinIO.
3. Next.js calls `POST /datasets` with the object key.
4. FastAPI enqueues `ingest_dataset` (Arq):
   - Stream from MinIO, parse with pandas/openpyxl (chunked for >500K rows).
   - Type inference (`profile.py`): numeric / datetime / categorical / id / text. Compute min/max/distinct/null counts.
   - Write `{org_id}/{dataset_id}.parquet`. Record schema in `dataset_columns`.
5. `autodash.py` generates a starter dashboard:
   - **4 KPI cards**: pick top numeric columns → SUM or AVG (heuristic: column name hints — `revenue|sales|total` → SUM; `price|rate` → AVG). Always include a row count.
   - **2–3 charts**:
     - If a datetime column exists → line chart of primary numeric over time.
     - If a categorical column with <30 distinct values exists → bar chart of numeric by category.
     - Pie chart for share-of-total on the strongest categorical.
   - **Overview text** generated by Claude (one prompt with schema + first 20 rows + summary stats).
6. Frontend polls `/datasets/:id` or subscribes via SSE for completion, then redirects to the new dashboard.

### 2. Chat — agentic loop

`POST /chat/:dashboard_id` streams Claude responses. The Claude prompt receives:
- The dataset schema + sample rows + summary stats (cached via Anthropic prompt caching — schemas rarely change).
- The current dashboard's widget list.
- Recent conversation turns (multi-turn context).

Claude is given these tools:

| Tool | Purpose |
|------|---------|
| `run_sql(sql: str)` | Execute against the dataset's DuckDB Parquet. Returns rows as JSON (capped at 1k). |
| `propose_chart(spec)` | Validate a Recharts chart spec (type, x, y, agg). No side effects. |
| `add_widget(spec, position?)` | Create a widget on the dashboard. Returns widget_id. |
| `update_widget(widget_id, spec)` | Edit an existing widget. |
| `final_answer(text, attachments?)` | Render in chat with optional inline chart. |

The chat agent loop (`chat_agent.py`):
- Loop until Claude calls `final_answer` or hits a step cap (e.g., 6 tool calls).
- All SQL is executed in a sandboxed DuckDB connection scoped to that workspace's Parquet files; reject `ATTACH`, file paths, or anything not `SELECT`/`WITH`.
- Streamed via SSE so the user sees thinking → tool calls → final answer.

### 3. Dashboard editing

- Layout state lives in `dashboards.layout_json` (react-grid-layout `Layout[]`).
- Drag/resize → debounced `PATCH /dashboards/:id` with the new layout.
- "Add widget" button opens a wizard: pick column(s) + agg + chart type → `POST /widgets`.
- Each widget renders by calling `POST /widgets/:id/data` — server resolves config → SQL → DuckDB → returns Recharts-ready data. Results cached in Redis keyed on `(widget_id, dataset_version)`.

### 4. Google Sheets

- OAuth flow on the web side stores refresh tokens encrypted in `datasets.source_uri`.
- Sync job (Arq cron): refetches the sheet, rewrites the Parquet, bumps `datasets.version` to invalidate widget caches.

---

## Multi-tenancy & security

- **Auth**: Better Auth on Next.js with the organization plugin. After login, Next.js mints a short-lived JWT (5 min, signed with a shared secret) containing `user_id` and `org_id`; FastAPI verifies on every request and uses `org_id` for all queries.
- **Postgres RLS**: `org_id = current_setting('app.org_id')::uuid` on every tenant table. FastAPI sets the GUC per-request after JWT verification.
- **DuckDB isolation**: each request opens a fresh DuckDB connection that only attaches Parquet files under `{org_id}/`. Reject any SQL referencing absolute paths.
- **MinIO**: per-org bucket prefix, presigned URLs scoped to the user's `org_id`.
- **Rate limits**: per-org on `/chat` (Claude usage is the cost driver) and per-user on uploads.

---

## Critical files to create

**Backend**
- `apps/api/app/main.py` — FastAPI app + middleware
- `apps/api/app/deps/auth.py` — JWT verification, sets RLS GUC
- `apps/api/app/services/ingest.py` — file → Parquet pipeline (reuse pandas, openpyxl)
- `apps/api/app/services/profile.py` — column type inference + stats
- `apps/api/app/services/autodash.py` — heuristic dashboard generator
- `apps/api/app/services/duck.py` — per-workspace DuckDB connection factory + SQL safety check
- `apps/api/app/services/chat_agent.py` — Claude tool-use loop (uses `anthropic` SDK with prompt caching on the schema block)
- `apps/api/app/workers/tasks.py` — Arq jobs (ingest, gsheet sync)
- `apps/api/app/routers/{datasets,dashboards,widgets,query,chat}.py`

**Frontend**
- `apps/web/lib/auth.ts` — Better Auth server config with organization plugin
- `apps/web/app/(app)/dashboards/[id]/page.tsx` — dashboard view
- `apps/web/components/dashboard/Grid.tsx` — react-grid-layout wrapper
- `apps/web/components/widgets/index.tsx` — widget registry (KPI, Line, Bar, Pie, Table)
- `apps/web/components/chat/ChatPanel.tsx` — SSE stream renderer
- `apps/web/components/upload/UploadDropzone.tsx` — presigned upload + progress

**Infra**
- `infra/docker-compose.yml` — services: web, api, worker, postgres, redis, minio, caddy
- `infra/Caddyfile` — reverse proxy + automatic TLS for app + api subdomains
- `infra/postgres/migrations/0001_init.sql` — initial Alembic migration

---

## Libraries to reuse (don't reinvent)

| Need | Library | Notes |
|------|---------|-------|
| Excel parsing | `openpyxl` + `pandas.read_excel` | streaming for large files |
| CSV | `pandas.read_csv(chunksize=...)` | |
| Analytical SQL | `duckdb` | reads Parquet directly |
| Column profiling | `pandas` + lightweight heuristics | semantic types ourselves; ydata-profiling is overkill |
| Async jobs | `arq` | Redis-backed, FastAPI-friendly |
| Claude SDK | `anthropic` Python | use prompt caching for schema block |
| Charts | `recharts` + `shadcn/ui` chart wrappers | |
| Grid layout | `react-grid-layout` | |
| Auth | `better-auth` + organization plugin | |
| Billing | `stripe` + `@stripe/stripe-js` | Better Auth has a Stripe plugin |
| Google Sheets | `google-api-python-client` | OAuth via Better Auth Google provider, reuse the refresh token |

---

## Build order

1. **Foundations**: monorepo (pnpm + turbo), docker-compose with Postgres/Redis/MinIO, Caddy, Alembic, healthchecks.
2. **Auth + orgs**: Better Auth (email + Google), org creation, invites, JWT bridge to FastAPI, RLS migrations.
3. **Dataset ingestion**: upload → MinIO → Arq ingest → Parquet → profile. Datasets list UI.
4. **Auto-dashboard generation**: `autodash.py` + render KPI/Line/Bar/Pie/Overview widgets end-to-end (read-only dashboard view).
5. **Dashboard editing**: drag/drop/resize grid, add/remove widget wizard, widget data caching in Redis.
6. **Chat agent**: `/chat` endpoint, Claude tool-use loop, `run_sql` + `add_widget` + `update_widget`, SSE streaming, multi-turn memory.
7. **Google Sheets**: OAuth, initial sync, scheduled refresh.
8. **Billing**: Stripe products (Free / Pro / Team), checkout, webhook → `subscriptions`, plan-based limits (datasets, rows, chat calls/mo).
9. **Polish**: dashboard share links (view-only token), CSV export, error states, observability (Sentry + structured logs).

---

## Verification

End-to-end test plan (run after each milestone, full pass before launch):

1. **Boot**: `docker compose up` brings up all services; Caddy serves `app.localhost` and `api.localhost`; health endpoints return 200.
2. **Auth**: sign up via email → create org → invite a teammate → teammate accepts → both see the same workspace; cross-org request returns 403.
3. **Upload**: upload a 50K-row sales `.xlsx` → ingestion completes in <60s → redirected to dashboard with 4 KPIs, line chart over a date column, bar chart by category, AI overview paragraph.
4. **Large file**: upload a 2M-row CSV → ingestion completes via Arq → widget queries return in <2s.
5. **Drag/drop**: rearrange and resize widgets → reload → layout persists.
6. **Add widget UI**: open widget wizard → pick a numeric column + agg + bar chart → widget renders with correct data.
7. **Chat — answer**: ask "what was total revenue on 2026-03-05?" → chat returns the correct number with the SQL used.
8. **Chat — multi-turn**: follow up "now break that down by region" → returns grouped table.
9. **Chat — add widget**: "add a widget showing monthly revenue trend" → new line chart appears on the dashboard.
10. **Chat — edit widget**: "change the revenue chart to a bar chart" → existing widget's `config_json.type` flips, renders as bar.
11. **SQL safety**: send a malicious prompt asking Claude to read files outside the workspace → SQL guard rejects, chat surfaces a safe error.
12. **Billing**: complete Stripe checkout → org plan upgrades → webhook updates `subscriptions`; cancel → grace period to `current_period_end`.
13. **Tenant isolation**: in two browser sessions logged into different orgs, confirm dataset/dashboard lists don't leak.
14. **Reload survival**: restart docker-compose → all data, files, and DuckDB Parquet remain.

Automated tests:
- Backend: `pytest` — services (profile, autodash, SQL guard) get unit tests; routers get integration tests against a Postgres test container; Claude agent loop is tested with a mock Anthropic client and recorded tool transcripts.
- Frontend: Playwright covers the auth → upload → dashboard → chat happy path.
- CI: GitHub Actions runs lint + type-check + unit tests + Playwright on a docker-compose stack.
