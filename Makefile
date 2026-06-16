.PHONY: setup dev dev-all dev-up dev-down dev-nuke dev-servers frontend-dev build up down dc-ps dc-logs dc-exec migrate-up migrate-down sqlc seed migrate-supabase import-transcripts lint test transcribe-batch transcribe-batch-ensure sync-sample-recordings

# Load .env if present
-include .env
export

# Auto-detect container runtime (docker compose or podman-compose)
ifeq ($(shell command -v podman 2>/dev/null),)
    COMPOSE = docker compose
else
    COMPOSE = podman-compose
endif

# ---------- Local development ----------

# First-time setup: copy env files, install frontend deps
setup:
	@test -f .env || (cp .env.example .env && echo "Created .env from .env.example")
	cd frontend && npm install
	@echo ""
	@echo "Done. Now run: make dev-all"

# Prepare local SQLite storage for local dev
dev-up:
	@mkdir -p tmp

# Stop local dev infrastructure
dev-down:
	@true

# Stop local dev infrastructure and remove volumes (full reset)
dev-nuke:
	@rm -f tmp/janushc-dash.db

# Run everything: infra, migrations, Go API, and Vite dev server
dev-all: dev-up
	@$(MAKE) migrate-up
	@echo "Starting API server and frontend dev server..."
	@trap 'kill 0' EXIT; \
		go run github.com/air-verse/air@latest & \
		cd frontend && npm run dev & \
		wait

# Run Go API + Vite frontend
dev-servers: migrate-up
	@echo "Starting Go API server and frontend..."
	@trap 'kill 0' EXIT; \
		go run github.com/air-verse/air@latest & \
		cd frontend && VITE_PORT=$${VITE_PORT:-3000} npm run dev -- --host & \
		wait

# Run Go API locally with live reload
dev:
	go run github.com/air-verse/air@latest

# Run Vite dev server
frontend-dev:
	cd frontend && npm run dev

# ---------- Devcontainer helpers ----------

DC_PROJECT = janushc-dash_devcontainer
# Always use docker compose for devcontainer targets (devcontainer CLI uses docker, not podman)
DC_COMPOSE = docker compose --project-name $(DC_PROJECT) -f .devcontainer/docker-compose.yml

# Show devcontainer service status
dc-ps:
	$(DC_COMPOSE) ps

# Tail devcontainer logs
dc-logs:
	$(DC_COMPOSE) logs -f $(SVC)

# Shell into devcontainer app
dc-exec:
	$(DC_COMPOSE) exec $(or $(SVC),app) bash

# Interactive SQLite shell inside the app container
dc-sqlite:
	$(DC_COMPOSE) exec app sqlite3 $${DATABASE_URL:-tmp/janushc-dash.db}

# Tear down devcontainer and remove volumes (full reset)
dc-nuke:
	$(DC_COMPOSE) down -v --rmi local

# Seed dev data inside devcontainer
dc-seed:
	$(DC_COMPOSE) exec -w /workspaces/janushc-dash app go run scripts/seed.go

# ---------- Docker (production-like) ----------

# Build Docker image
build:
	$(COMPOSE) build

# Start all services (production-like)
up:
	$(COMPOSE) up -d

# Stop all services
down:
	$(COMPOSE) down

# ---------- Database ----------

# Run database migrations up
migrate-up:
	@mkdir -p tmp
	go run -tags 'sqlite3' github.com/golang-migrate/migrate/v4/cmd/migrate@latest \
		-path migrations -database "$${DATABASE_URL:-sqlite3://tmp/janushc-dash.db}" up

# Roll back last migration
migrate-down:
	go run -tags 'sqlite3' github.com/golang-migrate/migrate/v4/cmd/migrate@latest \
		-path migrations -database "$${DATABASE_URL:-sqlite3://tmp/janushc-dash.db}" down 1

# ---------- Code generation ----------

# Regenerate sqlc code
sqlc:
	go run github.com/sqlc-dev/sqlc/cmd/sqlc@latest generate

# ---------- Quality ----------

# Run Go linter
lint:
	go vet ./...

# Run Go tests
test:
	go test ./...

# ---------- Data ----------

# Seed dev data
seed:
	go run scripts/seed.go

# Copy production Supabase/Postgres data into SQLite.
# Usage: SOURCE_DATABASE_URL='postgres://...' make migrate-supabase
migrate-supabase:
	@test -n "$${SOURCE_DATABASE_URL}" || (echo "Set SOURCE_DATABASE_URL first" && exit 1)
	go run scripts/migrate-supabase-to-sqlite.go -source "$${SOURCE_DATABASE_URL}" -dest "$${SQLITE_DEST:-tmp/janushc-prod.db}" -force

# Import tmp/transcripts/*.txt into scribe_sessions and process with Bedrock
import-transcripts:
	go run ./cmd/import-transcripts $(ARGS)

# Batch transcribe local recordings via AWS Transcribe Medical + S3
transcribe-batch:
	go run ./cmd/batch-transcribe-recordings

# Create/configure the S3 bucket, then batch transcribe. Requires bucket admin permissions.
transcribe-batch-ensure:
	go run ./cmd/batch-transcribe-recordings -ensure-bucket

# Pull shared Google Drive sample recordings, then transcribe/import via the prod image.
sync-sample-recordings:
	scripts/sync-sample-recordings.sh
