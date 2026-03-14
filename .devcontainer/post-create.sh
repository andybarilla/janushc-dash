#!/bin/bash
set -e

# Setup env files (cp -n won't overwrite existing .env)
make setup

# Patch .env for devcontainer hostnames (service names instead of localhost)
sed -i 's|@localhost:|@postgres:|g' .env

# Normalize postgres port to container-internal default
sed -i 's|@postgres:[0-9]*|@postgres:5432|g' .env

# Re-export patched DATABASE_URL so migrate picks it up
export $(grep -v '^#' .env | grep DATABASE_URL | xargs)

# Wait for postgres to be ready
echo "Waiting for Postgres..."
until pg_isready -h postgres -U "${POSTGRES_USER:-emrai}" -q; do
  sleep 1
done

# Install frontend dependencies
cd frontend && npm install && cd ..

# Run migrations
make migrate-up

# Seed dev data
make seed

# Signal to start.sh that setup is complete
touch /tmp/.devcontainer-ready
