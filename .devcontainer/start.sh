#!/bin/bash
# Override ports to standard defaults — the host .env may have non-standard
# ports (via env_file) that don't match the compose port mappings.
export PORT=8080

cd /workspaces/emrai

# Wait for post-create.sh to finish (it creates this marker file)
echo "Waiting for post-create to finish..."
while [ ! -f /tmp/.devcontainer-ready ]; do
  sleep 1
done

# Start dev servers in the background
make dev-servers &

# Keep the container alive
exec sleep infinity
