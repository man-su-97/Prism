# Prism

AI-powered analytics dashboard platform — multi-tenant SaaS that turns uploaded
datasets (CSV, XLSX, Google Sheets) into interactive analytics dashboards with
an AI chat companion.

Stack: Next.js 16 + React 19 + Tailwind v4 + shadcn/ui on the web; FastAPI +
Python 3.12 on the API; DuckDB + Parquet for analytics; Postgres for app
state; Redis for jobs and cache; MinIO for object storage; Caddy for TLS;
Anthropic Claude for the chat agent; Stripe for billing; Better Auth for
identity.

## Quickstart

```
docker compose -f infra/docker-compose.yml up --build
```

- App:  https://app.localhost  (Caddy issues an internal cert; accept it)
- API:  https://api.localhost   ·   https://api.localhost/api/health
- MinIO console: http://localhost:9001  (user: strata · pass: strata-secret)
- Stripe webhook (dev): `stripe listen --forward-to http://localhost:8000/api/billing/webhook`

First-time setup:

1. Sign up at https://app.localhost/signup, then create an organization.
2. Drop a CSV/XLSX on **/datasets** or click **+ Connect Google Sheet**.
3. The ingestion worker profiles columns, writes parquet, and auto-generates
   a starter dashboard (KPIs + line/bar/pie + an AI overview when an
   Anthropic key is set).
4. From any dashboard you can rearrange widgets, add new ones via the wizard,
   chat to the data, share a read-only link, or download a widget as CSV.

## Repository layout

```
Prism/
├── apps/
│   ├── web/                Next.js 16 (App Router, Turbopack dev)
│   └── api/                FastAPI + Alembic + Arq worker
├── infra/
│   ├── docker-compose.yml  web · api · worker · postgres · redis · minio · caddy
│   ├── Dockerfile.{web,api}
│   ├── Caddyfile
│   └── backup.sh           Postgres + MinIO + Parquet snapshot
├── .github/workflows/      lint + typecheck + smoke
└── README.md
```

## Phase map (see `CLAUDE.md`)

| Phase | Scope                                                                   |
|-------|-------------------------------------------------------------------------|
| 1     | Monorepo, compose stack, health endpoints, CI                           |
| 2     | Better Auth + orgs + JWT bridge + Postgres RLS                          |
| 3     | Dataset ingestion (CSV/XLSX → Parquet) with column profiling            |
| 4     | Auto-generated dashboards (KPIs, line/bar/pie, AI overview)             |
| 5     | Drag/drop editing + manual widget wizard + Redis widget cache           |
| 6     | Claude tool-use chat agent (SSE streaming)                              |
| 7     | Google Sheets connector with cron-based refresh                         |
| 8     | Stripe billing (Free/Pro/Team) + plan-aware limits                      |
| 9     | Share links · CSV export · observability · backup · docs (this README)  |

## Environment variables

Copy `apps/api/.env.example` and `apps/web/.env.example` and fill in the
fields. The required vs optional split below is for a real deployment;
everything works locally with defaults.

| Var                          | Where  | Required | Purpose                                                       |
|------------------------------|--------|----------|---------------------------------------------------------------|
| `DATABASE_URL`               | api    | yes      | asyncpg URL for Postgres                                       |
| `REDIS_URL`                  | api    | yes      | redis:// URL for Arq + cache                                   |
| `MINIO_ENDPOINT`             | api    | yes      | internal MinIO host:port                                       |
| `MINIO_PUBLIC_ENDPOINT`      | api    | yes      | browser-reachable host:port for presigned PUT                  |
| `MINIO_ACCESS_KEY` / `SECRET_KEY` / `BUCKET` | api | yes | MinIO creds                                            |
| `BACKEND_JWT_SECRET`         | api+web| yes      | HS256 secret used by the JWT bridge                            |
| `BETTER_AUTH_SECRET` / `URL` | web    | yes      | Better Auth signing key + canonical host                       |
| `AUTH_DATABASE_URL`          | web    | yes      | sync Postgres URL for Better Auth's pg adapter                 |
| `API_BASE_URL`               | web    | yes      | how Next.js reaches FastAPI (defaults to `http://api:8000`)    |
| `ANTHROPIC_API_KEY`          | api    | optional | enables auto-dash overview + chat agent                        |
| `ANTHROPIC_MODEL`            | api    | optional | default `claude-sonnet-4-6`                                    |
| `GOOGLE_CLIENT_ID` / `CLIENT_SECRET` | api+web | optional | Google sign-in + Sheets sync                          |
| `STRIPE_SECRET_KEY`          | api    | optional | enables billing                                                |
| `STRIPE_WEBHOOK_SECRET`      | api    | optional | webhook signature verification                                 |
| `STRIPE_PRO_PRICE_ID` / `STRIPE_TEAM_PRICE_ID` | api | optional | Stripe price ids                                  |
| `SHARE_LINK_SECRET`          | api    | optional | rotate to invalidate every outstanding share link              |
| `SENTRY_DSN`                 | api+web| optional | error reporting (api) and SSR error capture (web)              |
| `SENTRY_TRACES_SAMPLE_RATE`  | api+web| optional | tracing sample fraction (default 0)                            |
| `LOG_LEVEL` / `LOG_FORMAT`   | api    | optional | log level + `json` (default) or `text`                         |
| `PARQUET_ROOT`               | api    | optional | parquet volume path (default `/data/parquet`)                  |
| `SUPERADMIN_EMAILS`          | api+web| optional | CSV allowlist for the read-only `/admin` portal                |

## Deployment

Single-VPS Docker Compose was the design target:

1. Provision an Ubuntu/Debian box with Docker + Compose v2. Point DNS for
   `app.<domain>` and `api.<domain>` at it.
2. Replace `app.localhost` / `api.localhost` in `infra/Caddyfile` with your
   hostnames. Caddy will auto-provision Let's Encrypt certs.
3. Generate strong values for `BETTER_AUTH_SECRET`, `BACKEND_JWT_SECRET`, and
   `SHARE_LINK_SECRET`. Set MinIO credentials. Fill in optional integrations
   you want enabled.
4. `docker compose -f infra/docker-compose.yml up -d --build`.
5. Migrations run on api boot (see `apps/api/scripts/entrypoint.sh`). Verify
   with `curl https://api.<domain>/api/health`.
6. Configure Stripe webhook destination to
   `https://api.<domain>/api/billing/webhook` (events:
   `customer.subscription.created/updated/deleted`,
   `checkout.session.completed`).
7. Run `./infra/backup.sh` from cron nightly. Backups land in `./backups/<utc>/`.

### Observability

- API exposes `/metrics` for Prometheus when `prometheus-fastapi-instrumentator`
  is installed (it's in `pyproject.toml`). Scrape it from inside the docker
  network — Caddy doesn't expose it publicly.
- Set `SENTRY_DSN` to enable error reporting on both api and web. The api uses
  `sentry-sdk` with the logging integration (any `logging.error(...)` becomes
  an issue). The web app uses `@sentry/nextjs` via `instrumentation.ts`.
- Logs are JSON to stdout by default. Set `LOG_FORMAT=text` for human-readable
  output during local debugging.

### Backups & restore

`./infra/backup.sh [output_dir]` produces a dated directory with:

- `postgres.dump` — `pg_dump --format=custom`
- `minio.tar.gz`   — full MinIO data volume
- `parquet.tar.gz` — full parquet volume
- `manifest.json`  — created-at timestamp

To restore: drop the parquet + minio volumes, untar each archive into the
matching volume, then `pg_restore -U strata -d strata postgres.dump` from
inside the postgres container.

### Super-admin portal

A read-only internal portal lives at `/admin` (and `/api/admin/*`) for
operators who need to see signups, per-workspace usage, chat-token
consumption, plan distribution, and worker health without writing ad-hoc
SQL. Access is gated by an env-var allowlist on both the web and api
services:

```
SUPERADMIN_EMAILS=alice@example.com,bob@example.com
```

Notes:

- The same variable must be set on **both** `web` and `api` containers
  (both `.env` files). The web layer gates page rendering; the api layer
  re-checks the email against the allowlist before answering, so a leak
  in one layer doesn't grant access on the other.
- Anyone whose Better Auth `user.email` matches (case-insensitive) sees
  the portal. The portal is URL-only — there is no nav entry from the
  regular user app, by design.
- Non-allowlisted callers (signed in or out) get a plain 404 from every
  `/admin/*` page and every `/api/admin/*` endpoint. The portal must not
  reveal its own existence.
- v1 is **read-only**. There are no mutation endpoints under
  `/api/admin/*`. The bypass RLS policies added in migration
  `20260514_0003` are `FOR SELECT` only.
- Leaving `SUPERADMIN_EMAILS` blank locks the portal entirely.

## Conventions

Read `CLAUDE.md` for the contract every contributor (human or agent) should
follow. The headlines:

- Every tenant table gets `org_id` + RLS keyed on `app.org_id`.
- All DuckDB SQL — including the chat agent's — flows through
  `app/services/duck.py::validate_sql`. No ATTACH, no file paths, SELECT/WITH
  only.
- Anything that takes >2 s belongs on Arq, not in the request thread.
- Widget data is built server-side from structured config, never free SQL
  from the wizard.
- The web app reaches the API through a short-lived JWT minted from the
  Better Auth session — the browser never talks to FastAPI directly except
  for share-link views.

## License

UNLICENSED — internal scaffold for now.
