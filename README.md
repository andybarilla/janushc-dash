# janushc-dash

Physician workflow automation platform for independent practices. Integrates with athenahealth (athenaOne) EMR to automate repetitive clinical and administrative tasks.

## Modules

| Module | Status | Description |
|--------|--------|-------------|
| Batch Approvals | In Progress | End-of-day batch sign-off on injection and pellet implant procedures |
| Scribe | Planned | Visit transcription and clinical note generation |
| Fax/Doc Processor | Planned | Incoming fax classification, data extraction, and chart routing |
| Paper Backlog | Planned | Bulk scanning and filing of historical paper documents |

## Tech Stack

- **Backend:** Go (chi router, SQLC, database/sql)
- **Frontend:** Vite + React (TypeScript, TanStack Query, Tailwind CSS)
- **Database:** SQLite locally; Turso/libSQL is the intended remote SQLite option if needed
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
   - Prepares local SQLite storage
   - Runs database migrations
   - Installs frontend dependencies
   - Starts the Go backend (with hot-reload via air) and Vite dev server

4. Seed dev data:
   ```bash
   make seed
   ```

5. Open http://localhost:{PORT}/api/health and http://localhost:{NEXT_PORT}/login

### Local Dev (without devcontainer)

1. Copy env and prepare local storage:
   ```bash
   cp .env.example .env
   make dev-up
   ```

2. Run migrations and start the backend:
   ```bash
   make migrate-up
   go run ./cmd/janushc-dash
   ```

3. In another terminal, start the frontend:
   ```bash
   cd frontend && npm install && npm run dev
   ```

4. Seed dev data:
   ```bash
   make seed
   ```

### Test Credentials

After running `make seed`:
- **Email:** doctor@example.com
- **Password:** password123
- **Tenant ID:** printed by the seed script — set as `VITE_TENANT_ID` in `frontend/.env.local`

## Development

```bash
make dev-servers    # Start Go (air) + Vite
make migrate-up     # Run database migrations
make migrate-down   # Rollback migrations
make sqlc           # Regenerate SQLC query code
make seed           # Seed dev data
```

### SQLite

By default the backend uses `tmp/janushc-dash.db`. Set `DATABASE_URL` to another SQLite path or `sqlite://...` URL when needed.

```bash
make migrate-up
make seed
```

For a remote SQLite database, Turso/libSQL is the natural next target. This repo currently uses the local SQLite driver; adding Turso should be a driver/config change once the deployment target is chosen.

To import generated transcript text files into the Scribe session table and run Bedrock processing:

```bash
make import-transcripts
```

### Batch transcription

Batch transcription uses AWS Transcribe Medical with a temporary private S3 bucket.
Set `AWS_TRANSCRIBE_BUCKET`, then run:

```bash
make transcribe-batch
# or:
go run ./cmd/batch-transcribe-recordings -input recordings -out tmp/transcripts
```

The command uploads each recording, starts a medical conversation transcription job with speaker labels, writes `.txt` transcripts, deletes uploaded source audio by default, and relies on the bucket lifecycle rule to expire transcript JSON artifacts.

For deployed ingestion from the shared Google Drive `Sample Recordings` folder, see [`docs/recording-ingest.md`](docs/recording-ingest.md) or run:

```bash
make sync-sample-recordings
```

## Project Structure

```
cmd/janushc-dash/       # Application entrypoint
internal/
  approval/             # Batch approvals: flagging logic, HTTP handlers
  auth/                 # JWT, password hashing, middleware, context helpers
  bedrock/              # AWS Bedrock (Claude) client
  config/               # Environment config (godotenv)
  database/             # SQLC-generated query layer
  emr/                  # EMR interface abstraction
    athena/             # athenahealth API client
  server/               # Chi router setup, middleware, routes
migrations/             # SQLite migrations (golang-migrate)
queries/                # SQLC query definitions
scripts/                # Seed script
frontend/               # Vite + React frontend
  src/pages/            # Pages (login, approvals)
  src/components/       # UI components
  src/lib/              # API client, auth context, query hooks
```
