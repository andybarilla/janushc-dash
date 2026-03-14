#!/bin/bash
set -e

# Setup env files (cp -n won't overwrite existing .env)
make setup

# Patch .env for devcontainer hostnames (service names instead of localhost)
sed -i 's|@localhost:|@postgres:|g' .env

# Normalize ports to container-internal defaults (regardless of host-mapped ports in .env)
sed -i 's|@postgres:[0-9]*|@postgres:5432|g' .env
sed -i 's|^PORT=.*|PORT=8080|' .env

# Wait for postgres to be ready
echo "Waiting for Postgres..."
until pg_isready -h postgres -U "${POSTGRES_USER:-emrai}" -q; do
  sleep 1
done

# Install frontend dependencies
cd web && npm install && cd ..

# Run migrations
make migrate-up

# Signal to start.sh that setup is complete
touch /tmp/.devcontainer-ready
