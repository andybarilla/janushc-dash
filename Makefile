.PHONY: setup dev dev-all dev-up dev-down dev-nuke dev-servers frontend-dev build up down migrate-up migrate-down sqlc seed lint test

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

# Start postgres for local dev
dev-up:
	$(COMPOSE) -f docker-compose.dev.yml up -d

# Stop local dev infrastructure
dev-down:
	$(COMPOSE) -f docker-compose.dev.yml down

# Stop local dev infrastructure and remove volumes (full reset)
dev-nuke:
	$(COMPOSE) -f docker-compose.dev.yml down -v

# Run everything: infra, migrations, Go API, and Vite dev server
dev-all: dev-up
	@echo "Waiting for postgres..."
	@until $(COMPOSE) -f docker-compose.dev.yml exec -T postgres pg_isready -U emrai > /dev/null 2>&1; do sleep 0.5; done
	@$(MAKE) migrate-up
	@echo "Starting API server and frontend dev server..."
	@trap 'kill 0' EXIT; \
		go run github.com/air-verse/air@latest & \
		cd frontend && npm run dev & \
		wait

# Run Go API + Vite frontend (for use inside devcontainer where postgres is already running)
dev-servers: migrate-up
	@echo "Starting Go API server and frontend..."
	@trap 'kill 0' EXIT; \
		go run github.com/air-verse/air@latest & \
		cd frontend && VITE_PORT=$${NEXT_PORT:-3000} npm run dev -- --host & \
		wait

# Run Go API locally with live reload
dev:
	go run github.com/air-verse/air@latest

# Run Vite dev server
frontend-dev:
	cd frontend && npm run dev

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
	go run -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest \
		-path migrations -database "$${DATABASE_URL}" up

# Roll back last migration
migrate-down:
	go run -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest \
		-path migrations -database "$${DATABASE_URL}" down 1

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
