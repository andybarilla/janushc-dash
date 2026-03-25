#!/bin/bash
cd /workspaces/emrai

# Wait for postgres to accept connections
echo "Waiting for postgres..."
until psql "$DATABASE_URL" -c '\q' 2>/dev/null; do
    sleep 1
done
echo "Postgres is ready."

# Start dev servers
make dev-servers
