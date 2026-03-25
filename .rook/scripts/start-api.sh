#!/bin/bash
cd /workspaces/emrai

echo "Waiting for postgres..."
until psql "$DATABASE_URL" -c '\q' 2>/dev/null; do
    sleep 1
done
echo "Postgres is ready."

make migrate-up
air
