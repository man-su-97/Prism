# InsightBoard — operator Makefile.
# Run `make help` for the full target list.
#
# Environment toggle
#   make env-local   → switch to local Docker Desktop config, then: make build
#   make env-prod    → switch to production config,             then: make package

# ---------------------------------------------------------------------------
# Mode detection  (.mode file written by env-local / env-prod)
# ---------------------------------------------------------------------------
MODE_FILE := .mode
MODE      := $(shell cat $(MODE_FILE) 2>/dev/null || echo local)

COMPOSE_BASE := docker compose -f infra/docker-compose.yml
ifeq ($(MODE),prod)
  COMPOSE := $(COMPOSE_BASE)
else
  COMPOSE := $(COMPOSE_BASE) -f infra/docker-compose.local.yml
endif

PNPM           := pnpm
PNPM_WEB       := $(PNPM) --filter @insightboard/web
API_EXEC       := $(COMPOSE) exec api
WORKER_EXEC    := $(COMPOSE) exec worker
PG_EXEC        := $(COMPOSE) exec postgres
REDIS_EXEC     := $(COMPOSE) exec redis

API_HEALTH_URL := http://localhost:8000/api/health
WEB_HEALTH_URL := http://localhost:3000/healthz

.DEFAULT_GOAL := help
.PHONY: help install env-local env-prod mode \
        up build down restart ps logs logs-api logs-web logs-worker \
        api-shell worker-shell web-shell psql redis-cli \
        migrate migrate-new web-dev web-build typecheck lint fmt \
        api-test web-test test health smoke backup clean nuke package

## help: Print available targets.
help:
	@awk 'BEGIN { printf "Targets:\n" } \
	  /^## [a-zA-Z0-9_-]+:/ { \
	    sub(/^## /, ""); \
	    idx = index($$0, ":"); \
	    name = substr($$0, 1, idx - 1); \
	    desc = substr($$0, idx + 2); \
	    printf "  \033[36m%-14s\033[0m %s\n", name, desc \
	  }' $(MAKEFILE_LIST)

# ---------------------------------------------------------------------------
# Environment toggle
# ---------------------------------------------------------------------------

## env-local: Switch to local Docker Desktop config (localhost URLs + dev ports).
env-local:
	cp apps/web/.env.local apps/web/.env
	cp apps/api/.env.local apps/api/.env
	@echo local > $(MODE_FILE)
	@echo ""
	@echo "\033[32m✓ LOCAL env active\033[0m"
	@echo "  App  → http://localhost:3000"
	@echo "  API  → http://localhost:8000   (also /docs for Swagger)"
	@echo "  DB   → localhost:5432  user=strata  pw=strata  db=strata"
	@echo "  MinIO→ http://localhost:9001   (console)"
	@echo ""
	@echo "  Next: make build"

## env-prod: Switch to production config (server URLs — run before make package).
env-prod:
	cp apps/web/.env.prod apps/web/.env
	cp apps/api/.env.prod apps/api/.env
	@echo prod > $(MODE_FILE)
	@echo ""
	@echo "\033[33m✓ PROD env active\033[0m  (insightboard)"
	@echo "  API / postgres / redis ports are NOT exposed in this mode."
	@echo ""
	@echo "  Next: make package"

## mode: Show which environment is currently active.
mode:
	@echo "Active mode: \033[1m$(MODE)\033[0m  (edit $(MODE_FILE) or run make env-local / env-prod)"

# ---------------------------------------------------------------------------
# Setup + lifecycle
# ---------------------------------------------------------------------------

## install: Install JS deps via pnpm.
install:
	$(PNPM) install

## up: Start the full Compose stack (uses existing images).
up:
	$(COMPOSE) up -d

## build: Build images then start the stack.
build:
	$(COMPOSE) up -d --build

## down: Stop and remove containers (keeps volumes).
down:
	$(COMPOSE) down

## restart: Restart all services in-place.
restart:
	$(COMPOSE) restart

## ps: Show container status.
ps:
	$(COMPOSE) ps

# ---------------------------------------------------------------------------
# Logs
# ---------------------------------------------------------------------------

## logs: Tail logs for every service.
logs:
	$(COMPOSE) logs -f --tail=200

## logs-api: Tail API logs.
logs-api:
	$(COMPOSE) logs -f --tail=200 api

## logs-web: Tail Next.js logs.
logs-web:
	$(COMPOSE) logs -f --tail=200 web

## logs-worker: Tail Arq worker logs.
logs-worker:
	$(COMPOSE) logs -f --tail=200 worker

# ---------------------------------------------------------------------------
# Shells
# ---------------------------------------------------------------------------

## api-shell: Open a bash shell in the api container.
api-shell:
	$(API_EXEC) bash

## worker-shell: Open a bash shell in the worker container.
worker-shell:
	$(WORKER_EXEC) bash

## web-shell: Open a shell in the web container.
web-shell:
	$(COMPOSE) exec web sh

## psql: Open psql against the InsightBoard DB.
psql:
	$(PG_EXEC) psql -U strata -d strata

## redis-cli: Open redis-cli against the cache.
redis-cli:
	$(REDIS_EXEC) redis-cli

# ---------------------------------------------------------------------------
# Database / migrations
# ---------------------------------------------------------------------------

## migrate: Run alembic upgrade head inside the api container.
migrate:
	$(API_EXEC) alembic upgrade head

## migrate-new: Create an empty Alembic revision. Usage: make migrate-new MSG="add foo".
migrate-new:
	@if [ -z "$(MSG)" ]; then echo "usage: make migrate-new MSG=\"description\""; exit 2; fi
	$(API_EXEC) alembic revision -m "$(MSG)"

# ---------------------------------------------------------------------------
# Frontend dev
# ---------------------------------------------------------------------------

## web-dev: Start Next.js dev server on the host (talks to compose api).
web-dev:
	$(PNPM_WEB) dev

## web-build: Production build of the Next.js app.
web-build:
	$(PNPM_WEB) build

## typecheck: Run TS + mypy.
typecheck:
	$(PNPM_WEB) typecheck
	-$(API_EXEC) sh -lc "mypy app" || true

## lint: Run ESLint + ruff.
lint:
	$(PNPM_WEB) lint
	-$(API_EXEC) sh -lc "ruff check ." || true

## fmt: Run Prettier on JS/TS and ruff format on Python.
fmt:
	$(PNPM) format
	-$(API_EXEC) sh -lc "ruff format ." || true

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

## api-test: Run pytest inside the api container (no tests yet — placeholder).
api-test:
	$(API_EXEC) sh -lc "pytest -q" || echo "(no tests yet — see CLAUDE.md 'What's NOT yet built')"

## web-test: Run web unit tests (no harness yet — placeholder).
web-test:
	$(PNPM_WEB) test || echo "(no tests yet — see CLAUDE.md 'What's NOT yet built')"

## test: Run all tests.
test: api-test web-test

# ---------------------------------------------------------------------------
# Smoke / verification
# ---------------------------------------------------------------------------

## health: Curl both health endpoints (direct ports).
health:
	@printf "api  → "; curl -fsS $(API_HEALTH_URL) || echo "FAIL"
	@echo
	@printf "web  → "; curl -fsS $(WEB_HEALTH_URL) || echo "FAIL"
	@echo

## smoke: Verify compose config + health endpoints respond.
smoke:
	$(COMPOSE) config --quiet && echo "compose-ok"
	@$(MAKE) --no-print-directory health

# ---------------------------------------------------------------------------
# Backup / teardown
# ---------------------------------------------------------------------------

## backup: Snapshot Postgres, MinIO and the Parquet volume to ./backups/<utc>/.
backup:
	./infra/backup.sh

## clean: Stop the stack and remove anonymous volumes.
clean:
	$(COMPOSE) down --remove-orphans

## nuke: Stop the stack and DELETE named volumes (postgres, minio, parquet, caddy).
nuke:
	$(COMPOSE) down -v --remove-orphans

# ---------------------------------------------------------------------------
# Packaging for offline deploy (no Docker Hub publish — `docker save`/`load`)
# ---------------------------------------------------------------------------

PKG_DIR     := dist
PKG_IMAGES  := $(PKG_DIR)/insightboard-images.tar.gz
PKG_RUNTIME := $(PKG_DIR)/insightboard-runtime.tar.gz
PKG_APP_IMAGES  := insightboard-api insightboard-web insightboard-worker
PKG_BASE_IMAGES := postgres:17-alpine redis:7-alpine minio/minio:latest caddy:2-alpine

## package: Build prod images and bundle them + runtime config into ./dist/.
package:
	@if [ "$(MODE)" != "prod" ]; then \
	  echo "\033[31mERROR: run \`make env-prod\` before packaging.\033[0m"; exit 1; \
	fi
	@mkdir -p $(PKG_DIR)
	docker build -f infra/Dockerfile.web -t insightboard-web .
	docker build -f infra/Dockerfile.api -t insightboard-api .
	docker tag insightboard-api insightboard-worker
	@echo "→ saving images to $(PKG_IMAGES)"
	docker save $(PKG_APP_IMAGES) $(PKG_BASE_IMAGES) | gzip > $(PKG_IMAGES)
	@echo "→ bundling runtime config to $(PKG_RUNTIME)"
	@tar czf $(PKG_RUNTIME) \
	  --transform 's|infra/Caddyfile\.prod|infra/Caddyfile|' \
	  infra/docker-compose.yml \
	  infra/Caddyfile.prod \
	  $(wildcard apps/api/.env) \
	  $(wildcard apps/web/.env)
	@echo
	@du -h $(PKG_IMAGES) $(PKG_RUNTIME)
	@echo
	@echo "Transfer the two files above to the target host, then run:"
	@echo "  gunzip -c insightboard-images.tar.gz | docker load"
	@echo "  tar xzf insightboard-runtime.tar.gz"
	@echo "  docker compose -f infra/docker-compose.yml up -d"
	@if [ ! -f apps/api/.env ] || [ ! -f apps/web/.env ]; then \
	  echo; \
	  echo "WARNING: apps/api/.env and/or apps/web/.env not bundled (missing)."; \
	  echo "Create them on the target before \`compose up\` or services will start with empty secrets."; \
	fi
