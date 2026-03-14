# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

emrai is a physician workflow automation platform for independent practices. This monorepo contains a Go API backend, a Vite + React SPA frontend, and Docker Compose infrastructure.

## Architecture Overview

**Development Context**

- Tech stack: Go 1.25+ (chi, SQLC, pgx/v5), React 19 (Vite, TypeScript, TanStack Query, Tailwind CSS), PostgreSQL 16
- Auth: JWT-based (custom login endpoint, token stored in localStorage)
- AI: AWS Bedrock (Claude) for smart flagging and summarization
- EMR: athenahealth API (behind abstraction layer)

## Key Commands

- `make dev-servers` — run Go backend (air) + Vite frontend
- `make migrate-up` / `make migrate-down` — run/rollback database migrations
- `make sqlc` — regenerate database code from SQL queries
- `make seed` — seed dev data
- `cd frontend && npm run build` — full frontend build (TypeScript + Vite)

## Pre-Commit Verification

- **Backend changes**: run `go test ./...`
- **Frontend changes**: run `cd frontend && npm run build` — this runs `tsc -b` followed by `vite build`, matching what the production Dockerfile executes.

## Project Structure

```
cmd/emrai/          — Go entrypoint
internal/           — Go packages (approval, auth, bedrock, config, database, emr, server)
migrations/         — PostgreSQL migrations (golang-migrate)
queries/            — sqlc SQL query files
frontend/           — Vite + React + TypeScript SPA
  src/lib/          — API client, auth context, query hooks
  src/components/   — UI components
  src/pages/        — Page components (login, approvals)
scripts/            — Seed script
```
