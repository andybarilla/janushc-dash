FROM mcr.microsoft.com/devcontainers/go:1.25

# Install postgresql-client (needed for pg_isready in post-create.sh)
RUN apt-get update && apt-get install -y postgresql-client && rm -rf /var/lib/apt/lists/*

# Install Go-based dev tools
RUN go install github.com/air-verse/air@latest \
    && go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest \
    && go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest
