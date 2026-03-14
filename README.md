# emrai

Physician workflow automation platform for independent practices. Integrates with athenahealth (athenaOne) EMR to automate repetitive clinical and administrative tasks.

## Modules

| Module | Status | Description |
|--------|--------|-------------|
| Batch Approvals | In Progress | End-of-day batch sign-off on injection and pellet implant procedures |
| Scribe | Planned | Visit transcription and clinical note generation |
| Fax/Doc Processor | Planned | Incoming fax classification, data extraction, and chart routing |
| Paper Backlog | Planned | Bulk scanning and filing of historical paper documents |

## Tech Stack

- **Backend:** Go (chi router, SQLC, pgx/v5)
- **Frontend:** Next.js (React, Tailwind CSS)
- **Database:** PostgreSQL 16
- **AI:** AWS Bedrock (Claude) for smart flagging and summarization
- **EMR:** athenahealth API (behind abstraction layer)

## Getting Started

### Devcontainer (recommended)

The easiest way to develop — no port conflicts, everything pre-configured.

1. Copy the example env and set your ports:
   ```bash
   cp .env.example .env
   # Edit .env — set PORT and NEXT_PORT to avoid conflicts with other projects
   ```

2. Open in VS Code and select "Reopen in Container", or:
   ```bash
   devcontainer up --workspace-folder .
   ```

3. The devcontainer automatically:
   - Starts PostgreSQL
   - Runs database migrations
   - Installs frontend dependencies
   - Starts the Go backend (with hot-reload via air) and Next.js dev server

4. Seed dev data:
   ```bash
   make seed
   ```

5. Open http://localhost:{PORT}/api/health and http://localhost:{NEXT_PORT}/login

### Local Dev (without devcontainer)

1. Copy env and start Postgres:
   ```bash
   cp .env.example .env
   docker compose -f docker-compose.dev.yml up -d
   ```

2. Run migrations and start the backend:
   ```bash
   make migrate-up
   go run ./cmd/emrai
   ```

3. In another terminal, start the frontend:
   ```bash
   cd web && npm install && npm run dev
   ```

4. Seed dev data:
   ```bash
   make seed
   ```

### Test Credentials

After running `make seed`:
- **Email:** doctor@example.com
- **Password:** password123
- **Tenant ID:** printed by the seed script — set as `NEXT_PUBLIC_TENANT_ID` in `web/.env.local`

## Development

```bash
make dev-servers    # Start Go (air) + Next.js
make migrate-up     # Run database migrations
make migrate-down   # Rollback migrations
make sqlc           # Regenerate SQLC query code
make seed           # Seed dev data
```

## Project Structure

```
cmd/emrai/              # Application entrypoint
internal/
  approval/             # Batch approvals: flagging logic, HTTP handlers
  auth/                 # JWT, password hashing, middleware, context helpers
  bedrock/              # AWS Bedrock (Claude) client
  config/               # Environment config (godotenv)
  database/             # SQLC-generated query layer
  emr/                  # EMR interface abstraction
    athena/             # athenahealth API client
  server/               # Chi router setup, middleware, routes
migrations/             # PostgreSQL migrations (golang-migrate)
queries/                # SQLC query definitions
scripts/                # Seed script
web/                    # Next.js frontend
  src/app/              # Pages (login, approvals)
  src/components/       # UI components
  src/lib/              # API client, auth context
```
