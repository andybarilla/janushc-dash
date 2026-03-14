.PHONY: setup dev-servers migrate-up migrate-down sqlc seed

# Copy .env.example to .env if it doesn't exist
setup:
	@cp -n .env.example .env || true

# Run Go backend with hot-reload + Next.js frontend
dev-servers:
	@echo "Starting Go backend (air)..."
	@cd /workspaces/emrai && air &
	@echo "Starting Next.js frontend..."
	@cd web && npm run dev &
	@wait

# Database migrations
migrate-up:
	@migrate -path migrations -database "$$DATABASE_URL" up

migrate-down:
	@migrate -path migrations -database "$$DATABASE_URL" down

# Regenerate SQLC
sqlc:
	@sqlc generate

# Seed dev data
seed:
	@go run scripts/seed.go
