#!/bin/bash
cd /workspaces/janushc-dash

# Wait for post-create.sh to finish (it creates this marker file)
echo "Waiting for post-create to finish..."
while [ ! -f /tmp/.devcontainer-ready ]; do
  sleep 1
done

# Start dev servers in the background
make dev-servers &

# Keep the container alive
exec sleep infinity
