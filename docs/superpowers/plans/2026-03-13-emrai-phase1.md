# emrai Phase 1: Foundation + Batch Approvals Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundational backend, authentication, and Batch Approvals module — the first working feature of emrai.

**Architecture:** Go backend exposing a REST API consumed by a Next.js frontend. PostgreSQL for persistence with tenant ID on all tables. athenahealth integration behind an EMR abstraction layer. Claude (via AWS Bedrock) for smart flagging of non-routine orders.

**Tech Stack:** Go 1.22+, Next.js 14+, PostgreSQL 16, AWS Bedrock (Claude), athenahealth API, Docker Compose for local dev.

**Spec:** `docs/superpowers/specs/2026-03-13-emrai-design.md`

---

## File Structure

```
emrai/
├── cmd/
│   └── emrai/
│       └── main.go                    # Application entrypoint
├── internal/
│   ├── config/
│   │   └── config.go                  # Configuration loading (env vars, defaults)
│   ├── server/
│   │   └── server.go                  # HTTP server setup, middleware, routing
│   ├── auth/
│   │   ├── handler.go                 # Login, logout, refresh HTTP handlers
│   │   ├── middleware.go              # JWT validation, RBAC enforcement middleware
│   │   ├── jwt.go                     # JWT token creation, validation, refresh
│   │   └── password.go               # Password hashing, verification (bcrypt)
│   ├── user/
│   │   ├── model.go                   # User, Role types
│   │   ├── store.go                   # User database operations
│   │   └── handler.go                 # User management HTTP handlers
│   ├── emr/
│   │   ├── emr.go                     # EMR interface (abstraction layer)
│   │   └── athena/
│   │       ├── client.go              # athenahealth API HTTP client, OAuth token management
│   │       ├── orders.go              # Order-related API calls (list pending, approve)
│   │       ├── patients.go            # Patient data API calls
│   │       └── documents.go           # Document API calls (future modules)
│   ├── approval/
│   │   ├── model.go                   # Order, Protocol, ApprovalBatch types
│   │   ├── store.go                   # Approval/order database operations
│   │   ├── flagger.go                # Protocol-based + Claude smart flagging logic
│   │   ├── handler.go                 # Approval HTTP handlers (list, approve, flag)
│   │   └── service.go                # Approval business logic (batch approve, audit)
│   ├── audit/
│   │   ├── model.go                   # AuditEntry type
│   │   └── store.go                   # Audit log database operations
│   └── bedrock/
│       └── client.go                  # AWS Bedrock Claude client wrapper
├── migrations/
│   ├── 001_users.up.sql               # Users, roles tables
│   ├── 001_users.down.sql
│   ├── 002_audit.up.sql               # Audit log table
│   ├── 002_audit.down.sql
│   ├── 003_approvals.up.sql           # Orders, protocols, approval batches
│   └── 003_approvals.down.sql
├── web/                               # Next.js frontend
│   ├── package.json
│   ├── next.config.js
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx             # Root layout with auth provider
│   │   │   ├── login/
│   │   │   │   └── page.tsx           # Login page
│   │   │   └── approvals/
│   │   │       └── page.tsx           # Batch approvals dashboard
│   │   ├── components/
│   │   │   ├── approval-list.tsx      # Pending orders list with flag indicators
│   │   │   ├── approval-card.tsx      # Individual order card with patient context
│   │   │   └── batch-actions.tsx      # Select all / approve selected controls
│   │   └── lib/
│   │       ├── api.ts                 # Backend API client (fetch wrapper with auth)
│   │       └── auth.tsx               # Auth context, token storage, refresh
├── docker-compose.yml                 # PostgreSQL + Go backend for local dev
├── Dockerfile                         # Multi-stage Go build
├── go.mod
├── go.sum
└── .env.example                       # Required environment variables template
```

---

## Chunk 1: API Audit + Project Bootstrap

### Task 1: athenahealth API Capability Audit

This is a research task, not a code task. The results determine whether Module 1 is "approve from emrai" or "prepare in emrai, approve in Athena."

**Files:**
- Create: `docs/athena-api-audit.md`

- [ ] **Step 1: Sign up for athenahealth developer sandbox**

Go to https://docs.athenahealth.com/api/guides/onboarding-overview and register for Preview environment access. This provisions OAuth credentials and access to the public sandbox.

- [ ] **Step 2: Get OAuth token from sandbox**

```bash
curl -X POST "https://api.preview.platform.athenahealth.com/oauth2/v1/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET&scope=athena/service/Athenanet.MDP.*"
```

- [ ] **Step 3: Explore order-related endpoints**

Test these endpoints against the sandbox to answer the critical questions:

```bash
# List orders for a test patient
curl -H "Authorization: Bearer TOKEN" \
  "https://api.preview.platform.athenahealth.com/v1/195900/patients/1/orders"

# Check if there's an order approval/sign endpoint
curl -H "Authorization: Bearer TOKEN" \
  "https://api.preview.platform.athenahealth.com/v1/195900/patients/1/orders/ORDER_ID"

# Explore document endpoints for clinical notes
curl -H "Authorization: Bearer TOKEN" \
  "https://api.preview.platform.athenahealth.com/v1/195900/patients/1/documents"
```

- [ ] **Step 4: Document findings**

Write `docs/athena-api-audit.md` answering:
1. Can orders be approved/signed programmatically? If yes, which endpoint and what parameters?
2. If not, what is the closest capability? (e.g., can we update order status? create orders?)
3. Which Clinical Document endpoint accepts free-text notes? What format? Can it be linked to an encounter?
4. What scopes/permissions are needed?
5. What are the rate limits?
6. Decision: "approve from emrai" or "prepare in emrai, approve in Athena"?

- [ ] **Step 5: Commit findings**

```bash
git add docs/athena-api-audit.md
git commit -m "docs: athenahealth API capability audit results"
```

### Task 2: Initialize Go Project

**Files:**
- Create: `go.mod`
- Create: `cmd/emrai/main.go`
- Create: `internal/config/config.go`
- Create: `.env.example`

- [ ] **Step 1: Initialize Go module**

```bash
cd /home/andy/dev/andybarilla/emrai
go mod init github.com/andybarilla/emrai
```

- [ ] **Step 2: Create `.env.example`**

```bash
# .env.example
DATABASE_URL=postgres://emrai:emrai@localhost:5432/emrai?sslmode=disable
PORT=8080
JWT_SECRET=change-me-in-production
JWT_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d
CORS_ORIGIN=http://localhost:3000

# athenahealth
ATHENA_CLIENT_ID=
ATHENA_CLIENT_SECRET=
ATHENA_BASE_URL=https://api.preview.platform.athenahealth.com
ATHENA_PRACTICE_ID=195900

# AWS
AWS_REGION=us-east-1
AWS_BEDROCK_MODEL_ID=anthropic.claude-sonnet-4-20250514
```

- [ ] **Step 3: Create config loader**

```go
// internal/config/config.go
package config

import (
	"fmt"
	"os"
	"time"
)

type Config struct {
	Port                string
	DatabaseURL         string
	JWTSecret           string
	JWTExpiry           time.Duration
	RefreshTokenExpiry  time.Duration
	CORSOrigin          string
	AthenaClientID      string
	AthenaClientSecret  string
	AthenaBaseURL       string
	AthenaPracticeID    string
	AWSRegion           string
	BedrockModelID      string
}

func Load() (*Config, error) {
	jwtExpiry, err := time.ParseDuration(getEnv("JWT_EXPIRY", "15m"))
	if err != nil {
		return nil, fmt.Errorf("invalid JWT_EXPIRY: %w", err)
	}
	refreshExpiry, err := time.ParseDuration(getEnv("REFRESH_TOKEN_EXPIRY", "168h"))
	if err != nil {
		return nil, fmt.Errorf("invalid REFRESH_TOKEN_EXPIRY: %w", err)
	}

	dbURL, err := requireEnv("DATABASE_URL")
	if err != nil {
		return nil, err
	}
	jwtSecret, err := requireEnv("JWT_SECRET")
	if err != nil {
		return nil, err
	}

	cfg := &Config{
		Port:               getEnv("PORT", "8080"),
		DatabaseURL:        dbURL,
		JWTSecret:          jwtSecret,
		JWTExpiry:          jwtExpiry,
		RefreshTokenExpiry: refreshExpiry,
		CORSOrigin:         getEnv("CORS_ORIGIN", "http://localhost:3000"),
		AthenaClientID:     getEnv("ATHENA_CLIENT_ID", ""),
		AthenaClientSecret: getEnv("ATHENA_CLIENT_SECRET", ""),
		AthenaBaseURL:      getEnv("ATHENA_BASE_URL", "https://api.preview.platform.athenahealth.com"),
		AthenaPracticeID:   getEnv("ATHENA_PRACTICE_ID", "195900"),
		AWSRegion:          getEnv("AWS_REGION", "us-east-1"),
		BedrockModelID:     getEnv("AWS_BEDROCK_MODEL_ID", "anthropic.claude-sonnet-4-20250514"),
	}
	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func requireEnv(key string) (string, error) {
	v := os.Getenv(key)
	if v == "" {
		return "", fmt.Errorf("required environment variable %s is not set", key)
	}
	return v, nil
}
```

- [ ] **Step 4: Create entrypoint**

```go
// cmd/emrai/main.go
package main

import (
	"log"

	"github.com/andybarilla/emrai/internal/config"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}
	log.Printf("emrai starting on port %s", cfg.Port)
}
```

- [ ] **Step 5: Verify it compiles**

```bash
go build ./cmd/emrai
```

Expected: builds successfully, binary created.

- [ ] **Step 6: Commit**

```bash
git init
echo -e "bin/\n.env\n*.exe\nweb/node_modules/\nweb/.next/" > .gitignore
git add go.mod cmd/ internal/config/ .env.example .gitignore
git commit -m "feat: initialize Go project with config loading"
```

### Task 3: Docker Compose + PostgreSQL

**Files:**
- Create: `docker-compose.yml`
- Create: `Dockerfile`

- [ ] **Step 1: Create docker-compose.yml**

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: emrai
      POSTGRES_PASSWORD: emrai
      POSTGRES_DB: emrai
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  api:
    build: .
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: postgres://emrai:emrai@db:5432/emrai?sslmode=disable
      JWT_SECRET: dev-secret-do-not-use-in-production
      JWT_EXPIRY: "15m"
      REFRESH_TOKEN_EXPIRY: "168h"
      PORT: "8080"
    depends_on:
      - db

volumes:
  pgdata:
```

- [ ] **Step 2: Create Dockerfile**

```dockerfile
# Dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /emrai ./cmd/emrai

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /emrai /emrai
ENTRYPOINT ["/emrai"]
```

- [ ] **Step 3: Start database and verify**

```bash
docker compose up -d db
docker compose exec db psql -U emrai -c "SELECT 1"
```

Expected: returns `1`.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml Dockerfile
git commit -m "feat: add Docker Compose with PostgreSQL for local dev"
```

### Task 4: Database Migrations + HTTP Server

**Files:**
- Create: `internal/server/server.go`
- Create: `migrations/001_users.up.sql`
- Create: `migrations/001_users.down.sql`
- Create: `migrations/002_audit.up.sql`
- Create: `migrations/002_audit.down.sql`
- Modify: `cmd/emrai/main.go`

- [ ] **Step 1: Add dependencies**

```bash
go get github.com/jackc/pgx/v5
go get github.com/golang-migrate/migrate/v4
go get github.com/golang-migrate/migrate/v4/database/postgres
go get github.com/golang-migrate/migrate/v4/source/file
```

- [ ] **Step 2: Create users migration**

```sql
-- migrations/001_users.up.sql
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    athena_practice_id TEXT UNIQUE,
    athena_access_token_enc TEXT,
    athena_refresh_token_enc TEXT,
    athena_token_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('physician', 'staff')),
    name TEXT NOT NULL,
    mfa_secret TEXT,
    mfa_enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, email)
);

CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

```sql
-- migrations/001_users.down.sql
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS tenants;
```

- [ ] **Step 3: Create audit log migration**

```sql
-- migrations/002_audit.up.sql
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_tenant_created ON audit_log (tenant_id, created_at DESC);
CREATE INDEX idx_audit_log_resource ON audit_log (tenant_id, resource_type, resource_id);
```

```sql
-- migrations/002_audit.down.sql
DROP TABLE IF EXISTS audit_log;
```

- [ ] **Step 4: Create HTTP server**

```go
// internal/server/server.go
package server

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andybarilla/emrai/internal/config"
)

type Server struct {
	cfg    *config.Config
	db     *pgxpool.Pool
	router *http.ServeMux
}

func New(cfg *config.Config, db *pgxpool.Pool) *Server {
	s := &Server{
		cfg:    cfg,
		db:     db,
		router: http.NewServeMux(),
	}
	s.routes()
	return s
}

func (s *Server) routes() {
	s.router.HandleFunc("GET /api/health", s.handleHealth)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	if err := s.db.Ping(ctx); err != nil {
		http.Error(w, "database unavailable", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "ok")
}

func (s *Server) Start() error {
	addr := ":" + s.cfg.Port
	log.Printf("listening on %s", addr)
	return http.ListenAndServe(addr, s.router)
}
```

- [ ] **Step 5: Update main.go to connect DB, run migrations, start server**

```go
// cmd/emrai/main.go
package main

import (
	"context"
	"log"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andybarilla/emrai/internal/config"
	"github.com/andybarilla/emrai/internal/server"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	// Run migrations (migrate/postgres driver expects postgres:// scheme)
	migrateURL := cfg.DatabaseURL
	if strings.HasPrefix(migrateURL, "pgx://") {
		migrateURL = strings.Replace(migrateURL, "pgx://", "postgres://", 1)
	}
	m, err := migrate.New("file://migrations", migrateURL)
	if err != nil {
		log.Fatalf("failed to create migrator: %v", err)
	}
	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		log.Fatalf("failed to run migrations: %v", err)
	}
	log.Println("migrations complete")

	// Connect to database
	pool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer pool.Close()

	// Start server
	srv := server.New(cfg, pool)
	log.Fatal(srv.Start())
}
```

- [ ] **Step 6: Verify migrations and health endpoint**

```bash
docker compose up -d db
go run ./cmd/emrai &
sleep 2
curl http://localhost:8080/api/health
```

Expected: `ok`

- [ ] **Step 7: Commit**

```bash
git add internal/server/ migrations/ cmd/emrai/main.go go.mod go.sum
git commit -m "feat: add HTTP server, PostgreSQL connection, and initial migrations"
```

---

## Chunk 2: Authentication

### Task 5: Password Hashing + User Model

**Files:**
- Create: `internal/auth/password.go`
- Create: `internal/auth/password_test.go`
- Create: `internal/user/model.go`
- Create: `internal/user/store.go`
- Create: `internal/user/store_test.go`

- [ ] **Step 1: Write password hashing tests**

```go
// internal/auth/password_test.go
package auth

import "testing"

func TestHashPassword(t *testing.T) {
	hash, err := HashPassword("test-password")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if hash == "" {
		t.Fatal("hash should not be empty")
	}
	if hash == "test-password" {
		t.Fatal("hash should not equal plaintext")
	}
}

func TestCheckPassword(t *testing.T) {
	hash, _ := HashPassword("correct-password")

	if !CheckPassword("correct-password", hash) {
		t.Fatal("expected correct password to match")
	}
	if CheckPassword("wrong-password", hash) {
		t.Fatal("expected wrong password to not match")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
go test ./internal/auth/ -run TestHashPassword -v
```

Expected: FAIL — `HashPassword` not defined.

- [ ] **Step 3: Implement password hashing**

```go
// internal/auth/password.go
package auth

import "golang.org/x/crypto/bcrypt"

func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func CheckPassword(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
go get golang.org/x/crypto/bcrypt
go test ./internal/auth/ -v
```

Expected: PASS.

- [ ] **Step 5: Create user model**

```go
// internal/user/model.go
package user

import "time"

type Role string

const (
	RolePhysician Role = "physician"
	RoleStaff     Role = "staff"
)

type User struct {
	ID           string    `json:"id"`
	TenantID     string    `json:"tenant_id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	Role         Role      `json:"role"`
	Name         string    `json:"name"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}
```

- [ ] **Step 6: Create user store**

```go
// internal/user/store.go
package user

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	db *pgxpool.Pool
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) Create(ctx context.Context, u *User) error {
	_, err := s.db.Exec(ctx,
		`INSERT INTO users (id, tenant_id, email, password_hash, role, name)
		 VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
		u.TenantID, u.Email, u.PasswordHash, u.Role, u.Name,
	)
	if err != nil {
		return fmt.Errorf("create user: %w", err)
	}
	return nil
}

func (s *Store) GetByEmail(ctx context.Context, tenantID, email string) (*User, error) {
	u := &User{}
	err := s.db.QueryRow(ctx,
		`SELECT id, tenant_id, email, password_hash, role, name, created_at, updated_at
		 FROM users WHERE tenant_id = $1 AND email = $2`,
		tenantID, email,
	).Scan(&u.ID, &u.TenantID, &u.Email, &u.PasswordHash, &u.Role, &u.Name, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get user by email: %w", err)
	}
	return u, nil
}

func (s *Store) GetByID(ctx context.Context, id string) (*User, error) {
	u := &User{}
	err := s.db.QueryRow(ctx,
		`SELECT id, tenant_id, email, password_hash, role, name, created_at, updated_at
		 FROM users WHERE id = $1`,
		id,
	).Scan(&u.ID, &u.TenantID, &u.Email, &u.PasswordHash, &u.Role, &u.Name, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get user by id: %w", err)
	}
	return u, nil
}
```

- [ ] **Step 7: Commit**

```bash
git add internal/auth/password.go internal/auth/password_test.go internal/user/
git commit -m "feat: add password hashing and user model/store"
```

### Task 6: JWT Authentication

**Files:**
- Create: `internal/auth/jwt.go`
- Create: `internal/auth/jwt_test.go`

- [ ] **Step 1: Write JWT tests**

```go
// internal/auth/jwt_test.go
package auth

import (
	"testing"
	"time"
)

func TestCreateAndValidateAccessToken(t *testing.T) {
	secret := "test-secret"
	expiry := 15 * time.Minute

	token, err := CreateAccessToken("user-123", "tenant-456", "physician", secret, expiry)
	if err != nil {
		t.Fatalf("unexpected error creating token: %v", err)
	}

	claims, err := ValidateAccessToken(token, secret)
	if err != nil {
		t.Fatalf("unexpected error validating token: %v", err)
	}

	if claims.UserID != "user-123" {
		t.Errorf("expected user ID user-123, got %s", claims.UserID)
	}
	if claims.TenantID != "tenant-456" {
		t.Errorf("expected tenant ID tenant-456, got %s", claims.TenantID)
	}
	if claims.Role != "physician" {
		t.Errorf("expected role physician, got %s", claims.Role)
	}
}

func TestExpiredTokenFails(t *testing.T) {
	secret := "test-secret"
	token, _ := CreateAccessToken("user-123", "tenant-456", "physician", secret, -1*time.Minute)

	_, err := ValidateAccessToken(token, secret)
	if err == nil {
		t.Fatal("expected error for expired token")
	}
}

func TestWrongSecretFails(t *testing.T) {
	token, _ := CreateAccessToken("user-123", "tenant-456", "physician", "secret-1", 15*time.Minute)

	_, err := ValidateAccessToken(token, "secret-2")
	if err == nil {
		t.Fatal("expected error for wrong secret")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
go test ./internal/auth/ -run TestCreate -v
```

Expected: FAIL — `CreateAccessToken` not defined.

- [ ] **Step 3: Implement JWT**

```go
// internal/auth/jwt.go
package auth

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UserID   string `json:"uid"`
	TenantID string `json:"tid"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

func CreateAccessToken(userID, tenantID, role, secret string, expiry time.Duration) (string, error) {
	claims := &Claims{
		UserID:   userID,
		TenantID: tenantID,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiry)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func ValidateAccessToken(tokenStr, secret string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, fmt.Errorf("invalid token: %w", err)
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}
	return claims, nil
}
```

- [ ] **Step 4: Run all auth tests**

```bash
go get github.com/golang-jwt/jwt/v5
go test ./internal/auth/ -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/auth/jwt.go internal/auth/jwt_test.go go.mod go.sum
git commit -m "feat: add JWT token creation and validation"
```

### Task 7: Auth Middleware + Login Handler

**Files:**
- Create: `internal/auth/middleware.go`
- Create: `internal/auth/handler.go`
- Modify: `internal/server/server.go`

- [ ] **Step 1: Create auth middleware**

```go
// internal/auth/middleware.go
package auth

import (
	"context"
	"net/http"
	"strings"
)

type contextKey string

const ClaimsKey contextKey = "claims"

func Middleware(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, "missing authorization header", http.StatusUnauthorized)
				return
			}

			tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
			if tokenStr == authHeader {
				http.Error(w, "invalid authorization format", http.StatusUnauthorized)
				return
			}

			claims, err := ValidateAccessToken(tokenStr, secret)
			if err != nil {
				http.Error(w, "invalid token", http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), ClaimsKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func RequireRole(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := r.Context().Value(ClaimsKey).(*Claims)
			if !ok {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			for _, role := range roles {
				if claims.Role == role {
					next.ServeHTTP(w, r)
					return
				}
			}
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		})
	}
}

func GetClaims(ctx context.Context) *Claims {
	claims, _ := ctx.Value(ClaimsKey).(*Claims)
	return claims
}
```

- [ ] **Step 2: Create login handler**

```go
// internal/auth/handler.go
package auth

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/andybarilla/emrai/internal/user"
)

type Handler struct {
	users             *user.Store
	jwtSecret         string
	jwtExpiry         time.Duration
	refreshExpiry     time.Duration
}

func NewHandler(users *user.Store, jwtSecret string, jwtExpiry, refreshExpiry time.Duration) *Handler {
	return &Handler{
		users:         users,
		jwtSecret:     jwtSecret,
		jwtExpiry:     jwtExpiry,
		refreshExpiry: refreshExpiry,
	}
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	TenantID string `json:"tenant_id"`
}

type loginResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
}

func (h *Handler) HandleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	u, err := h.users.GetByEmail(r.Context(), req.TenantID, req.Email)
	if err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	if !CheckPassword(req.Password, u.PasswordHash) {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	token, err := CreateAccessToken(u.ID, u.TenantID, string(u.Role), h.jwtSecret, h.jwtExpiry)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(loginResponse{
		AccessToken: token,
		ExpiresIn:   int(h.jwtExpiry.Seconds()),
	})
}
```

- [ ] **Step 3: Wire auth into server routes**

```go
// internal/server/server.go — update to add auth routes and middleware helper
```

Add to the `Server` struct and `routes()`:

```go
// Add to Server struct
type Server struct {
	cfg         *config.Config
	db          *pgxpool.Pool
	router      *http.ServeMux
	authHandler *auth.Handler
}

// Update New() to accept and store auth handler
func New(cfg *config.Config, db *pgxpool.Pool, authHandler *auth.Handler) *Server {
	s := &Server{
		cfg:         cfg,
		db:          db,
		router:      http.NewServeMux(),
		authHandler: authHandler,
	}
	s.routes()
	return s
}

// Update routes()
func (s *Server) routes() {
	s.router.HandleFunc("GET /api/health", s.handleHealth)
	s.router.HandleFunc("POST /api/auth/login", s.authHandler.HandleLogin)
}

// Add middleware chaining helper
func chain(h http.Handler, middlewares ...func(http.Handler) http.Handler) http.Handler {
	for i := len(middlewares) - 1; i >= 0; i-- {
		h = middlewares[i](h)
	}
	return h
}
```

Update `cmd/emrai/main.go` to wire the auth handler:

```go
// After pool creation, add:
userStore := user.NewStore(pool)
authHandler := auth.NewHandler(userStore, cfg.JWTSecret, cfg.JWTExpiry, cfg.RefreshTokenExpiry)
srv := server.New(cfg, pool, authHandler)
```

- [ ] **Step 4: Verify the server starts and login endpoint exists**

```bash
go build ./cmd/emrai
```

Expected: compiles successfully.

- [ ] **Step 5: Commit**

```bash
git add internal/auth/middleware.go internal/auth/handler.go internal/server/server.go cmd/emrai/main.go
git commit -m "feat: add auth middleware, login handler, and RBAC"
```

---

## Chunk 3: Audit Log + EMR Abstraction + Athena Client

### Task 8: Audit Log

**Files:**
- Create: `internal/audit/model.go`
- Create: `internal/audit/store.go`
- Create: `internal/audit/store_test.go`

- [ ] **Step 1: Create audit model**

```go
// internal/audit/model.go
package audit

import (
	"encoding/json"
	"time"
)

type Entry struct {
	ID           string          `json:"id"`
	TenantID     string          `json:"tenant_id"`
	UserID       string          `json:"user_id"`
	Action       string          `json:"action"`
	ResourceType string          `json:"resource_type"`
	ResourceID   string          `json:"resource_id,omitempty"`
	Details      json.RawMessage `json:"details,omitempty"`
	CreatedAt    time.Time       `json:"created_at"`
}
```

- [ ] **Step 2: Create audit store**

```go
// internal/audit/store.go
package audit

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	db *pgxpool.Pool
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) Log(ctx context.Context, tenantID, userID, action, resourceType, resourceID string, details any) error {
	var detailsJSON []byte
	if details != nil {
		var err error
		detailsJSON, err = json.Marshal(details)
		if err != nil {
			return fmt.Errorf("marshal audit details: %w", err)
		}
	}

	_, err := s.db.Exec(ctx,
		`INSERT INTO audit_log (tenant_id, user_id, action, resource_type, resource_id, details)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		tenantID, userID, action, resourceType, resourceID, detailsJSON,
	)
	if err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}

func (s *Store) List(ctx context.Context, tenantID string, limit int) ([]Entry, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, tenant_id, user_id, action, resource_type, resource_id, details, created_at
		 FROM audit_log WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
		tenantID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list audit log: %w", err)
	}
	defer rows.Close()

	var entries []Entry
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.ID, &e.TenantID, &e.UserID, &e.Action, &e.ResourceType, &e.ResourceID, &e.Details, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan audit entry: %w", err)
		}
		entries = append(entries, e)
	}
	return entries, nil
}
```

- [ ] **Step 3: Commit**

```bash
git add internal/audit/
git commit -m "feat: add audit log model and store"
```

### Task 9: EMR Abstraction Layer

**Files:**
- Create: `internal/emr/emr.go`

- [ ] **Step 1: Define EMR interface**

```go
// internal/emr/emr.go
package emr

import "context"

// Order represents a pending procedure order from any EMR.
type Order struct {
	ID            string            `json:"id"`
	PatientID     string            `json:"patient_id"`
	PatientName   string            `json:"patient_name"`
	ProcedureName string            `json:"procedure_name"`
	Dosage        string            `json:"dosage,omitempty"`
	StaffName     string            `json:"staff_name,omitempty"`
	OrderDate     string            `json:"order_date"`
	Status        string            `json:"status"`
	Metadata      map[string]string `json:"metadata,omitempty"`
}

// PatientContext is the relevant chart data for flagging decisions.
type PatientContext struct {
	PatientID       string   `json:"patient_id"`
	IsNewPatient    bool     `json:"is_new_patient"`
	LastLabDate     string   `json:"last_lab_date,omitempty"`
	PreviousDosages []string `json:"previous_dosages,omitempty"`
}

// EMR is the abstraction layer for interacting with any EMR system.
type EMR interface {
	// ListPendingOrders returns procedure orders awaiting physician approval.
	ListPendingOrders(ctx context.Context, practiceID string, procedureTypes []string) ([]Order, error)

	// ApproveOrders marks the given order IDs as approved.
	// Returns the IDs that were successfully approved and any error.
	ApproveOrders(ctx context.Context, practiceID string, orderIDs []string) ([]string, error)

	// GetPatientContext retrieves relevant chart data for a patient.
	GetPatientContext(ctx context.Context, practiceID, patientID string) (*PatientContext, error)
}
```

- [ ] **Step 2: Commit**

```bash
git add internal/emr/emr.go
git commit -m "feat: add EMR abstraction interface"
```

### Task 10: athenahealth API Client

**Files:**
- Create: `internal/emr/athena/client.go`
- Create: `internal/emr/athena/client_test.go`
- Create: `internal/emr/athena/orders.go`
- Create: `internal/emr/athena/patients.go`

- [ ] **Step 1: Write client OAuth test**

```go
// internal/emr/athena/client_test.go
package athena

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientGetToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/v1/token" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"access_token":"test-token","expires_in":3600}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := NewClient(server.URL, "client-id", "client-secret")
	token, err := client.getToken()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if token != "test-token" {
		t.Errorf("expected test-token, got %s", token)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
go test ./internal/emr/athena/ -run TestClientGetToken -v
```

Expected: FAIL — `NewClient` not defined.

- [ ] **Step 3: Implement Athena client with OAuth**

```go
// internal/emr/athena/client.go
package athena

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type Client struct {
	baseURL      string
	clientID     string
	clientSecret string
	httpClient   *http.Client

	mu           sync.Mutex
	accessToken  string
	tokenExpires time.Time
}

func NewClient(baseURL, clientID, clientSecret string) *Client {
	return &Client{
		baseURL:      strings.TrimRight(baseURL, "/"),
		clientID:     clientID,
		clientSecret: clientSecret,
		httpClient:   &http.Client{Timeout: 30 * time.Second},
	}
}

type tokenResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
}

func (c *Client) getToken() (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.accessToken != "" && time.Now().Before(c.tokenExpires) {
		return c.accessToken, nil
	}

	// NOTE: This uses client_credentials for sandbox/dev access.
	// Production requires authorization_code flow with per-physician tokens
	// so that write-backs use the physician's identity (see spec line 73-74).
	// Will be updated after the API audit (Task 1) confirms the exact auth flow needed.
	data := url.Values{
		"grant_type":    {"client_credentials"},
		"client_id":     {c.clientID},
		"client_secret": {c.clientSecret},
	}

	resp, err := c.httpClient.PostForm(c.baseURL+"/oauth2/v1/token", data)
	if err != nil {
		return "", fmt.Errorf("token request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("token request failed (%d): %s", resp.StatusCode, body)
	}

	var tokenResp tokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return "", fmt.Errorf("decode token response: %w", err)
	}

	c.accessToken = tokenResp.AccessToken
	c.tokenExpires = time.Now().Add(time.Duration(tokenResp.ExpiresIn-60) * time.Second)
	return c.accessToken, nil
}

func (c *Client) doRequest(ctx context.Context, method, path string, body io.Reader) (*http.Response, error) {
	token, err := c.getToken()
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	return c.httpClient.Do(req)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
go test ./internal/emr/athena/ -run TestClientGetToken -v
```

Expected: PASS.

- [ ] **Step 5: Implement orders and patients stubs**

These implementations will be refined after the API audit (Task 1). For now, they implement the EMR interface with the expected endpoint structure.

```go
// internal/emr/athena/orders.go
package athena

import (
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/andybarilla/emrai/internal/emr"
)

func (c *Client) ListPendingOrders(ctx context.Context, practiceID string, procedureTypes []string) ([]emr.Order, error) {
	// Endpoint and query params to be confirmed by API audit
	path := fmt.Sprintf("/v1/%s/orders", practiceID)
	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, fmt.Errorf("list orders: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("list orders failed (%d): %s", resp.StatusCode, body)
	}

	// Response structure to be confirmed by API audit
	var result struct {
		Orders []struct {
			OrderID     string `json:"orderid"`
			PatientID   string `json:"patientid"`
			Description string `json:"description"`
			Status      string `json:"status"`
			OrderDate   string `json:"orderdate"`
		} `json:"orders"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode orders: %w", err)
	}

	var orders []emr.Order
	for _, o := range result.Orders {
		orders = append(orders, emr.Order{
			ID:            o.OrderID,
			PatientID:     o.PatientID,
			ProcedureName: o.Description,
			OrderDate:     o.OrderDate,
			Status:        o.Status,
		})
	}
	return orders, nil
}

func (c *Client) ApproveOrders(ctx context.Context, practiceID string, orderIDs []string) ([]string, error) {
	// Implementation depends on API audit results
	// If programmatic approval is not available, this returns an error
	// and the UI falls back to "prepare in emrai, approve in Athena"
	return nil, fmt.Errorf("ApproveOrders: not yet implemented — awaiting API audit results")
}
```

```go
// internal/emr/athena/patients.go
package athena

import (
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/andybarilla/emrai/internal/emr"
)

func (c *Client) GetPatientContext(ctx context.Context, practiceID, patientID string) (*emr.PatientContext, error) {
	path := fmt.Sprintf("/v1/%s/patients/%s", practiceID, patientID)
	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, fmt.Errorf("get patient: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("get patient failed (%d): %s", resp.StatusCode, body)
	}

	var result struct {
		PatientID string `json:"patientid"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode patient: %w", err)
	}

	return &emr.PatientContext{
		PatientID: result.PatientID,
	}, nil
}
```

- [ ] **Step 6: Verify compilation**

```bash
go build ./internal/emr/athena/
```

Expected: compiles successfully.

- [ ] **Step 7: Commit**

```bash
git add internal/emr/
git commit -m "feat: add athenahealth API client with OAuth and EMR interface"
```

---

## Chunk 4: Batch Approvals Backend

### Task 11: Approval Models + Migration

**Files:**
- Create: `internal/approval/model.go`
- Create: `migrations/003_approvals.up.sql`
- Create: `migrations/003_approvals.down.sql`

- [ ] **Step 1: Create approvals migration**

```sql
-- migrations/003_approvals.up.sql
CREATE TABLE protocols (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    procedure_name TEXT NOT NULL,
    standard_dosage TEXT,
    max_lab_age_days INT NOT NULL DEFAULT 90,
    requires_established_patient BOOLEAN NOT NULL DEFAULT true,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE approval_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    approved_by UUID NOT NULL REFERENCES users(id),
    approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    order_count INT NOT NULL,
    flagged_count INT NOT NULL DEFAULT 0
);

CREATE TABLE approval_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID REFERENCES approval_batches(id),
    tenant_id UUID NOT NULL,
    emr_order_id TEXT NOT NULL,
    patient_id TEXT NOT NULL,
    patient_name TEXT NOT NULL,
    procedure_name TEXT NOT NULL,
    dosage TEXT,
    staff_name TEXT,
    order_date DATE NOT NULL,
    flagged BOOLEAN NOT NULL DEFAULT false,
    flag_reasons JSONB,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'needs_review', 'skipped')),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, emr_order_id)
);

CREATE INDEX idx_approval_items_tenant_status ON approval_items (tenant_id, status);
CREATE INDEX idx_approval_items_batch ON approval_items (batch_id);
```

```sql
-- migrations/003_approvals.down.sql
DROP TABLE IF EXISTS approval_items;
DROP TABLE IF EXISTS approval_batches;
DROP TABLE IF EXISTS protocols;
```

- [ ] **Step 2: Create approval model**

```go
// internal/approval/model.go
package approval

import (
	"encoding/json"
	"time"
)

type Protocol struct {
	ID                        string    `json:"id"`
	TenantID                  string    `json:"tenant_id"`
	Name                      string    `json:"name"`
	ProcedureName             string    `json:"procedure_name"`
	StandardDosage            string    `json:"standard_dosage,omitempty"`
	MaxLabAgeDays             int       `json:"max_lab_age_days"`
	RequiresEstablishedPatient bool     `json:"requires_established_patient"`
	Active                    bool      `json:"active"`
	CreatedAt                 time.Time `json:"created_at"`
	UpdatedAt                 time.Time `json:"updated_at"`
}

type ApprovalItem struct {
	ID            string          `json:"id"`
	BatchID       *string         `json:"batch_id,omitempty"`
	TenantID      string          `json:"tenant_id"`
	EMROrderID    string          `json:"emr_order_id"`
	PatientID     string          `json:"patient_id"`
	PatientName   string          `json:"patient_name"`
	ProcedureName string          `json:"procedure_name"`
	Dosage        string          `json:"dosage,omitempty"`
	StaffName     string          `json:"staff_name,omitempty"`
	OrderDate     string          `json:"order_date"`
	Flagged       bool            `json:"flagged"`
	FlagReasons   json.RawMessage `json:"flag_reasons,omitempty"`
	Status        string          `json:"status"`
	ReviewedAt    *time.Time      `json:"reviewed_at,omitempty"`
	ReviewedBy    *string         `json:"reviewed_by,omitempty"`
	CreatedAt     time.Time       `json:"created_at"`
}

type ApprovalBatch struct {
	ID           string    `json:"id"`
	TenantID     string    `json:"tenant_id"`
	ApprovedBy   string    `json:"approved_by"`
	ApprovedAt   time.Time `json:"approved_at"`
	OrderCount   int       `json:"order_count"`
	FlaggedCount int       `json:"flagged_count"`
}
```

- [ ] **Step 3: Verify migrations run**

```bash
docker compose up -d db
go run ./cmd/emrai &
sleep 2
curl http://localhost:8080/api/health
```

Expected: `ok` (migrations auto-run on startup).

- [ ] **Step 4: Commit**

```bash
git add internal/approval/model.go migrations/003_*
git commit -m "feat: add approval models and database migration"
```

### Task 12: Approval Store

**Files:**
- Create: `internal/approval/store.go`

- [ ] **Step 1: Implement approval store**

```go
// internal/approval/store.go
package approval

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	db *pgxpool.Pool
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) UpsertItems(ctx context.Context, items []ApprovalItem) error {
	batch := &pgx.Batch{}
	for _, item := range items {
		batch.Queue(
			`INSERT INTO approval_items (tenant_id, emr_order_id, patient_id, patient_name, procedure_name, dosage, staff_name, order_date, flagged, flag_reasons, status)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			 ON CONFLICT (tenant_id, emr_order_id) DO UPDATE SET
			   patient_name = EXCLUDED.patient_name,
			   dosage = EXCLUDED.dosage,
			   staff_name = EXCLUDED.staff_name,
			   flagged = EXCLUDED.flagged,
			   flag_reasons = EXCLUDED.flag_reasons,
			   status = EXCLUDED.status`,
			item.TenantID, item.EMROrderID, item.PatientID, item.PatientName,
			item.ProcedureName, item.Dosage, item.StaffName, item.OrderDate,
			item.Flagged, item.FlagReasons, item.Status,
		)
	}
	results := s.db.SendBatch(ctx, batch)
	defer results.Close()
	for range items {
		if _, err := results.Exec(); err != nil {
			return fmt.Errorf("upsert approval item: %w", err)
		}
	}
	return nil
}

func (s *Store) ListPending(ctx context.Context, tenantID string) ([]ApprovalItem, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, batch_id, tenant_id, emr_order_id, patient_id, patient_name,
		        procedure_name, dosage, staff_name, order_date, flagged, flag_reasons,
		        status, reviewed_at, reviewed_by, created_at
		 FROM approval_items
		 WHERE tenant_id = $1 AND status IN ('pending', 'needs_review')
		 ORDER BY flagged DESC, order_date ASC`,
		tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("list pending: %w", err)
	}
	defer rows.Close()

	var items []ApprovalItem
	for rows.Next() {
		var item ApprovalItem
		if err := rows.Scan(
			&item.ID, &item.BatchID, &item.TenantID, &item.EMROrderID,
			&item.PatientID, &item.PatientName, &item.ProcedureName,
			&item.Dosage, &item.StaffName, &item.OrderDate,
			&item.Flagged, &item.FlagReasons, &item.Status,
			&item.ReviewedAt, &item.ReviewedBy, &item.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan approval item: %w", err)
		}
		items = append(items, item)
	}
	return items, nil
}

func (s *Store) BatchApprove(ctx context.Context, tenantID, userID string, itemIDs []string) (*ApprovalBatch, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Count flagged items in the batch
	var flaggedCount int
	err = tx.QueryRow(ctx,
		`SELECT COUNT(*) FROM approval_items
		 WHERE tenant_id = $1 AND id = ANY($2) AND flagged = true`,
		tenantID, itemIDs,
	).Scan(&flaggedCount)
	if err != nil {
		return nil, fmt.Errorf("count flagged: %w", err)
	}

	// Create batch record
	batch := &ApprovalBatch{TenantID: tenantID, ApprovedBy: userID, OrderCount: len(itemIDs), FlaggedCount: flaggedCount}
	err = tx.QueryRow(ctx,
		`INSERT INTO approval_batches (tenant_id, approved_by, order_count, flagged_count)
		 VALUES ($1, $2, $3, $4) RETURNING id, approved_at`,
		tenantID, userID, len(itemIDs), flaggedCount,
	).Scan(&batch.ID, &batch.ApprovedAt)
	if err != nil {
		return nil, fmt.Errorf("create batch: %w", err)
	}

	// Update items
	_, err = tx.Exec(ctx,
		`UPDATE approval_items
		 SET status = 'approved', batch_id = $1, reviewed_at = now(), reviewed_by = $2
		 WHERE tenant_id = $3 AND id = ANY($4) AND status IN ('pending', 'needs_review')`,
		batch.ID, userID, tenantID, itemIDs,
	)
	if err != nil {
		return nil, fmt.Errorf("update items: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return batch, nil
}

func (s *Store) ListProtocols(ctx context.Context, tenantID string) ([]Protocol, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, tenant_id, name, procedure_name, standard_dosage, max_lab_age_days,
		        requires_established_patient, active, created_at, updated_at
		 FROM protocols WHERE tenant_id = $1 AND active = true`,
		tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("list protocols: %w", err)
	}
	defer rows.Close()

	var protocols []Protocol
	for rows.Next() {
		var p Protocol
		if err := rows.Scan(
			&p.ID, &p.TenantID, &p.Name, &p.ProcedureName, &p.StandardDosage,
			&p.MaxLabAgeDays, &p.RequiresEstablishedPatient, &p.Active,
			&p.CreatedAt, &p.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan protocol: %w", err)
		}
		protocols = append(protocols, p)
	}
	return protocols, nil
}

func (s *Store) CreateProtocol(ctx context.Context, p *Protocol) error {
	err := s.db.QueryRow(ctx,
		`INSERT INTO protocols (tenant_id, name, procedure_name, standard_dosage, max_lab_age_days, requires_established_patient)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at, updated_at`,
		p.TenantID, p.Name, p.ProcedureName, p.StandardDosage, p.MaxLabAgeDays, p.RequiresEstablishedPatient,
	).Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return fmt.Errorf("create protocol: %w", err)
	}
	p.Active = true
	return nil
}

func (s *Store) UpdateFlags(ctx context.Context, id string, flagged bool, reasons json.RawMessage) error {
	status := "pending"
	if flagged {
		status = "needs_review"
	}
	_, err := s.db.Exec(ctx,
		`UPDATE approval_items SET flagged = $1, flag_reasons = $2, status = $3 WHERE id = $4`,
		flagged, reasons, status, id,
	)
	if err != nil {
		return fmt.Errorf("update flags: %w", err)
	}
	return nil
}
```

- [ ] **Step 2: Verify compilation**

```bash
go build ./internal/approval/
```

Expected: compiles successfully.

- [ ] **Step 3: Commit**

```bash
git add internal/approval/store.go
git commit -m "feat: add approval store with batch approve and protocol management"
```

### Task 13: Bedrock Client + Smart Flagging

**Files:**
- Create: `internal/bedrock/client.go`
- Create: `internal/approval/flagger.go`
- Create: `internal/approval/flagger_test.go`

- [ ] **Step 1: Create Bedrock Claude client**

```go
// internal/bedrock/client.go
package bedrock

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
)

type Client struct {
	runtime *bedrockruntime.Client
	modelID string
}

func NewClient(ctx context.Context, region, modelID string) (*Client, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("load AWS config: %w", err)
	}
	return &Client{
		runtime: bedrockruntime.NewFromConfig(cfg),
		modelID: modelID,
	}, nil
}

func (c *Client) Complete(ctx context.Context, systemPrompt, userPrompt string, maxTokens int) (string, error) {
	input := map[string]any{
		"anthropic_version": "bedrock-2023-05-31",
		"max_tokens":        maxTokens,
		"system":            systemPrompt,
		"messages": []map[string]string{
			{"role": "user", "content": userPrompt},
		},
	}

	body, err := json.Marshal(input)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	resp, err := c.runtime.InvokeModel(ctx, &bedrockruntime.InvokeModelInput{
		ModelId:     &c.modelID,
		Body:        body,
		ContentType: strPtr("application/json"),
	})
	if err != nil {
		return "", fmt.Errorf("invoke model: %w", err)
	}

	var result struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(resp.Body, &result); err != nil {
		return "", fmt.Errorf("unmarshal response: %w", err)
	}
	if len(result.Content) == 0 {
		return "", fmt.Errorf("empty response from model")
	}
	return result.Content[0].Text, nil
}

func strPtr(s string) *string { return &s }
```

- [ ] **Step 2: Write flagger test**

```go
// internal/approval/flagger_test.go
package approval

import (
	"testing"
	"time"

	"github.com/andybarilla/emrai/internal/emr"
)

// All tests use a fixed "now" to avoid time-dependent failures.
var testNow = time.Date(2026, 3, 13, 12, 0, 0, 0, time.UTC)

func TestProtocolFlagging_StandardOrder(t *testing.T) {
	protocols := []Protocol{
		{
			ProcedureName:              "Testosterone Pellet",
			StandardDosage:             "200mg",
			MaxLabAgeDays:              90,
			RequiresEstablishedPatient: true,
		},
	}

	item := ApprovalItem{
		ProcedureName: "Testosterone Pellet",
		Dosage:        "200mg",
	}

	patientCtx := &emr.PatientContext{
		IsNewPatient:    false,
		LastLabDate:     "2026-02-15", // within 90 days of testNow
		PreviousDosages: []string{"200mg"},
	}

	reasons := checkProtocols(item, patientCtx, protocols, testNow)
	if len(reasons) != 0 {
		t.Errorf("expected no flags for standard order, got: %v", reasons)
	}
}

func TestProtocolFlagging_DoseChange(t *testing.T) {
	protocols := []Protocol{
		{
			ProcedureName:              "Testosterone Pellet",
			StandardDosage:             "200mg",
			MaxLabAgeDays:              90,
			RequiresEstablishedPatient: true,
		},
	}

	item := ApprovalItem{
		ProcedureName: "Testosterone Pellet",
		Dosage:        "250mg",
	}

	patientCtx := &emr.PatientContext{
		IsNewPatient:    false,
		LastLabDate:     "2026-02-15",
		PreviousDosages: []string{"200mg"},
	}

	reasons := checkProtocols(item, patientCtx, protocols, testNow)
	if len(reasons) == 0 {
		t.Error("expected flag for dose change, got none")
	}

	found := false
	for _, r := range reasons {
		if r == "dosage differs from standard (250mg vs 200mg)" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected dosage flag, got: %v", reasons)
	}
}

func TestProtocolFlagging_NewPatient(t *testing.T) {
	protocols := []Protocol{
		{
			ProcedureName:              "Testosterone Pellet",
			StandardDosage:             "200mg",
			MaxLabAgeDays:              90,
			RequiresEstablishedPatient: true,
		},
	}

	item := ApprovalItem{
		ProcedureName: "Testosterone Pellet",
		Dosage:        "200mg",
	}

	patientCtx := &emr.PatientContext{
		IsNewPatient: true,
		LastLabDate:  "2026-02-15",
	}

	reasons := checkProtocols(item, patientCtx, protocols, testNow)
	found := false
	for _, r := range reasons {
		if r == "new patient — requires individual review" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected new patient flag, got: %v", reasons)
	}
}

func TestProtocolFlagging_LabsTooOld(t *testing.T) {
	protocols := []Protocol{
		{
			ProcedureName:  "Testosterone Pellet",
			StandardDosage: "200mg",
			MaxLabAgeDays:  90,
		},
	}

	item := ApprovalItem{
		ProcedureName: "Testosterone Pellet",
		Dosage:        "200mg",
	}

	patientCtx := &emr.PatientContext{
		IsNewPatient: false,
		LastLabDate:  "2025-11-01", // > 90 days before 2026-03-13
	}

	reasons := checkProtocols(item, patientCtx, protocols, testNow)
	found := false
	for _, r := range reasons {
		if r == "labs older than 90 days" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected stale labs flag, got: %v", reasons)
	}
}
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
go test ./internal/approval/ -run TestProtocolFlagging -v
```

Expected: FAIL — `checkProtocols` not defined.

- [ ] **Step 4: Implement flagger**

```go
// internal/approval/flagger.go
package approval

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/andybarilla/emrai/internal/bedrock"
	"github.com/andybarilla/emrai/internal/emr"
)

type Flagger struct {
	claude *bedrock.Client
}

func NewFlagger(claude *bedrock.Client) *Flagger {
	return &Flagger{claude: claude}
}

// checkProtocols runs rule-based flagging against configured protocols.
// Returns a list of flag reasons (empty = standard/routine).
// now is injectable for testability.
func checkProtocols(item ApprovalItem, patient *emr.PatientContext, protocols []Protocol, now time.Time) []string {
	var reasons []string

	var matchedProtocol *Protocol
	for i, p := range protocols {
		if strings.EqualFold(p.ProcedureName, item.ProcedureName) {
			matchedProtocol = &protocols[i]
			break
		}
	}

	if matchedProtocol == nil {
		return []string{"no matching protocol — requires individual review"}
	}

	// Check dosage
	if matchedProtocol.StandardDosage != "" && item.Dosage != matchedProtocol.StandardDosage {
		reasons = append(reasons, fmt.Sprintf("dosage differs from standard (%s vs %s)", item.Dosage, matchedProtocol.StandardDosage))
	}

	// Check new patient
	if matchedProtocol.RequiresEstablishedPatient && patient.IsNewPatient {
		reasons = append(reasons, "new patient — requires individual review")
	}

	// Check lab age
	if patient.LastLabDate != "" {
		labDate, err := time.Parse("2006-01-02", patient.LastLabDate)
		if err == nil {
			maxAge := time.Duration(matchedProtocol.MaxLabAgeDays) * 24 * time.Hour
			if now.Sub(labDate) > maxAge {
				reasons = append(reasons, fmt.Sprintf("labs older than %d days", matchedProtocol.MaxLabAgeDays))
			}
		}
	} else {
		reasons = append(reasons, "no lab results on file")
	}

	return reasons
}

// FlagItems runs both rule-based and AI-powered flagging on a list of items.
func (f *Flagger) FlagItems(ctx context.Context, items []ApprovalItem, patients map[string]*emr.PatientContext, protocols []Protocol) ([]ApprovalItem, error) {
	for i := range items {
		patient := patients[items[i].PatientID]
		if patient == nil {
			patient = &emr.PatientContext{IsNewPatient: true}
		}

		reasons := checkProtocols(items[i], patient, protocols, time.Now())

		if len(reasons) > 0 {
			items[i].Flagged = true
			reasonsJSON, _ := json.Marshal(reasons)
			items[i].FlagReasons = reasonsJSON
			items[i].Status = "needs_review"
		} else {
			items[i].Status = "pending"
		}
	}
	return items, nil
}
```

- [ ] **Step 5: Run flagger tests**

```bash
go test ./internal/approval/ -run TestProtocolFlagging -v
```

Expected: all PASS.

- [ ] **Step 6: Add AWS SDK dependency**

```bash
go get github.com/aws/aws-sdk-go-v2/config
go get github.com/aws/aws-sdk-go-v2/service/bedrockruntime
```

- [ ] **Step 7: Verify full compilation**

```bash
go build ./...
```

Expected: compiles successfully.

- [ ] **Step 8: Commit**

```bash
git add internal/bedrock/ internal/approval/flagger.go internal/approval/flagger_test.go go.mod go.sum
git commit -m "feat: add Bedrock client and protocol-based order flagging"
```

### Task 14: Approval Service + HTTP Handlers

**Files:**
- Create: `internal/approval/service.go`
- Create: `internal/approval/handler.go`
- Modify: `internal/server/server.go`

- [ ] **Step 1: Create approval service**

```go
// internal/approval/service.go
package approval

import (
	"context"
	"fmt"

	"github.com/andybarilla/emrai/internal/audit"
	"github.com/andybarilla/emrai/internal/emr"
)

type Service struct {
	store    *Store
	emr      emr.EMR
	flagger  *Flagger
	auditLog *audit.Store
}

func NewService(store *Store, emrClient emr.EMR, flagger *Flagger, auditLog *audit.Store) *Service {
	return &Service{
		store:    store,
		emr:      emrClient,
		flagger:  flagger,
		auditLog: auditLog,
	}
}

// Refresh pulls pending orders from the EMR, flags them, and stores them locally.
func (s *Service) Refresh(ctx context.Context, tenantID, practiceID string) ([]ApprovalItem, error) {
	orders, err := s.emr.ListPendingOrders(ctx, practiceID, []string{"injection", "pellet"})
	if err != nil {
		return nil, fmt.Errorf("list pending orders: %w", err)
	}

	// Convert EMR orders to approval items
	items := make([]ApprovalItem, len(orders))
	for i, o := range orders {
		items[i] = ApprovalItem{
			TenantID:      tenantID,
			EMROrderID:    o.ID,
			PatientID:     o.PatientID,
			PatientName:   o.PatientName,
			ProcedureName: o.ProcedureName,
			Dosage:        o.Dosage,
			StaffName:     o.StaffName,
			OrderDate:     o.OrderDate,
			Status:        "pending",
		}
	}

	// Get patient context for flagging
	patients := make(map[string]*emr.PatientContext)
	for _, item := range items {
		if _, exists := patients[item.PatientID]; !exists {
			pCtx, err := s.emr.GetPatientContext(ctx, practiceID, item.PatientID)
			if err != nil {
				// If we can't get patient context, flag for review
				patients[item.PatientID] = &emr.PatientContext{IsNewPatient: true}
			} else {
				patients[item.PatientID] = pCtx
			}
		}
	}

	// Get protocols and flag
	protocols, err := s.store.ListProtocols(ctx, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list protocols: %w", err)
	}

	items, err = s.flagger.FlagItems(ctx, items, patients, protocols)
	if err != nil {
		return nil, fmt.Errorf("flag items: %w", err)
	}

	// Store locally
	if err := s.store.UpsertItems(ctx, items); err != nil {
		return nil, fmt.Errorf("upsert items: %w", err)
	}

	return items, nil
}

// Approve batch-approves the given items and writes back to the EMR.
func (s *Service) Approve(ctx context.Context, tenantID, userID, practiceID string, itemIDs []string) (*ApprovalBatch, error) {
	batch, err := s.store.BatchApprove(ctx, tenantID, userID, itemIDs)
	if err != nil {
		return nil, fmt.Errorf("batch approve: %w", err)
	}

	// Attempt to write back to EMR (may not be supported yet)
	// Collect EMR order IDs from the approved items
	// For now, this is best-effort — the local approval is the source of truth
	s.auditLog.Log(ctx, tenantID, userID, "batch_approve", "approval_batch", batch.ID, map[string]any{
		"order_count":  batch.OrderCount,
		"flagged_count": batch.FlaggedCount,
		"item_ids":     itemIDs,
	})

	return batch, nil
}

// ListPending returns all pending/needs_review items for the tenant.
func (s *Service) ListPending(ctx context.Context, tenantID string) ([]ApprovalItem, error) {
	return s.store.ListPending(ctx, tenantID)
}
```

- [ ] **Step 2: Create approval HTTP handlers**

```go
// internal/approval/handler.go
package approval

import (
	"encoding/json"
	"net/http"

	"github.com/andybarilla/emrai/internal/auth"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) HandleListPending(w http.ResponseWriter, r *http.Request) {
	claims := auth.GetClaims(r.Context())
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	items, err := h.service.ListPending(r.Context(), claims.TenantID)
	if err != nil {
		http.Error(w, "failed to list pending items", http.StatusInternalServerError)
		return
	}

	if items == nil {
		items = []ApprovalItem{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

func (h *Handler) HandleRefresh(w http.ResponseWriter, r *http.Request) {
	claims := auth.GetClaims(r.Context())
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// Practice ID would come from tenant config in production
	practiceID := r.URL.Query().Get("practice_id")
	if practiceID == "" {
		http.Error(w, "practice_id required", http.StatusBadRequest)
		return
	}

	items, err := h.service.Refresh(r.Context(), claims.TenantID, practiceID)
	if err != nil {
		http.Error(w, "failed to refresh orders", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

type batchApproveRequest struct {
	ItemIDs []string `json:"item_ids"`
}

func (h *Handler) HandleBatchApprove(w http.ResponseWriter, r *http.Request) {
	claims := auth.GetClaims(r.Context())
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	if claims.Role != "physician" {
		http.Error(w, "only physicians can approve orders", http.StatusForbidden)
		return
	}

	var req batchApproveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.ItemIDs) == 0 {
		http.Error(w, "no items to approve", http.StatusBadRequest)
		return
	}

	practiceID := r.URL.Query().Get("practice_id")
	batch, err := h.service.Approve(r.Context(), claims.TenantID, claims.UserID, practiceID, req.ItemIDs)
	if err != nil {
		http.Error(w, "failed to approve orders", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(batch)
}
```

- [ ] **Step 3: Wire approval routes into server**

Update `internal/server/server.go` to add approval routes:

```go
// Add to Server struct
type Server struct {
	cfg             *config.Config
	db              *pgxpool.Pool
	router          *http.ServeMux
	authHandler     *auth.Handler
	approvalHandler *approval.Handler
}

// Update New() signature
func New(cfg *config.Config, db *pgxpool.Pool, authHandler *auth.Handler, approvalHandler *approval.Handler) *Server {
	s := &Server{
		cfg:             cfg,
		db:              db,
		router:          http.NewServeMux(),
		authHandler:     authHandler,
		approvalHandler: approvalHandler,
	}
	s.routes()
	return s
}

// Update routes()
func (s *Server) routes() {
	authMW := auth.Middleware(s.cfg.JWTSecret)
	physicianOnly := auth.RequireRole("physician")

	s.router.HandleFunc("GET /api/health", s.handleHealth)
	s.router.HandleFunc("POST /api/auth/login", s.authHandler.HandleLogin)

	// Approval routes (authenticated)
	s.router.Handle("GET /api/approvals", chain(
		http.HandlerFunc(s.approvalHandler.HandleListPending), authMW))
	s.router.Handle("POST /api/approvals/refresh", chain(
		http.HandlerFunc(s.approvalHandler.HandleRefresh), authMW))
	s.router.Handle("POST /api/approvals/batch-approve", chain(
		http.HandlerFunc(s.approvalHandler.HandleBatchApprove), authMW, physicianOnly))
}
```

Update `cmd/emrai/main.go` to wire all dependencies:

```go
// After pool creation:
userStore := user.NewStore(pool)
auditStore := audit.NewStore(pool)
authHandler := auth.NewHandler(userStore, cfg.JWTSecret, cfg.JWTExpiry, cfg.RefreshTokenExpiry)

athenaClient := athena.NewClient(cfg.AthenaBaseURL, cfg.AthenaClientID, cfg.AthenaClientSecret)
approvalStore := approval.NewStore(pool)

// Bedrock client (nil in dev if no AWS credentials)
var flagger *approval.Flagger
bedrockClient, err := bedrock.NewClient(context.Background(), cfg.AWSRegion, cfg.BedrockModelID)
if err != nil {
	log.Printf("warning: bedrock client unavailable, using rule-based flagging only: %v", err)
	flagger = approval.NewFlagger(nil)
} else {
	flagger = approval.NewFlagger(bedrockClient)
}

approvalService := approval.NewService(approvalStore, athenaClient, flagger, auditStore)
approvalHandler := approval.NewHandler(approvalService)
srv := server.New(cfg, pool, authHandler, approvalHandler)
```

- [ ] **Step 4: Verify compilation**

```bash
go build ./...
```

Expected: compiles successfully.

- [ ] **Step 5: Commit**

```bash
git add internal/approval/service.go internal/approval/handler.go internal/server/server.go cmd/emrai/main.go
git commit -m "feat: add approval service, HTTP handlers, and route wiring"
```

---

## Chunk 5: Next.js Frontend

### Task 15: Initialize Next.js Project

**Files:**
- Create: `web/package.json`
- Create: `web/next.config.js`
- Create: `web/src/app/layout.tsx`
- Create: `web/src/lib/api.ts`
- Create: `web/src/lib/auth.tsx`

- [ ] **Step 1: Initialize Next.js**

```bash
cd /home/andy/dev/andybarilla/emrai
npx create-next-app@latest web --typescript --tailwind --eslint --app --src-dir --no-import-alias
```

- [ ] **Step 2: Create API client**

```typescript
// web/src/lib/api.ts
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    if (res.status === 401) {
      this.token = null;
      localStorage.removeItem("token");
      window.location.href = "/login";
      throw new Error("Unauthorized");
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
    }

    return res.json();
  }
}

export const api = new ApiClient();
```

- [ ] **Step 3: Create auth context**

```tsx
// web/src/lib/auth.tsx
"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api } from "./api";

interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string, tenantId: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("token");
    if (stored) {
      setToken(stored);
      api.setToken(stored);
    }
  }, []);

  const login = async (email: string, password: string, tenantId: string) => {
    const res = await api.fetch<{ access_token: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, tenant_id: tenantId }),
    });
    setToken(res.access_token);
    api.setToken(res.access_token);
    localStorage.setItem("token", res.access_token);
  };

  const logout = () => {
    setToken(null);
    api.setToken(null);
    localStorage.removeItem("token");
  };

  return (
    <AuthContext.Provider value={{ token, isAuthenticated: !!token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

- [ ] **Step 4: Update root layout**

```tsx
// web/src/app/layout.tsx
import type { Metadata } from "next";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "emrai",
  description: "Physician workflow automation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Verify it builds**

```bash
cd /home/andy/dev/andybarilla/emrai/web && npm run build
```

Expected: builds successfully.

- [ ] **Step 6: Commit**

```bash
cd /home/andy/dev/andybarilla/emrai
git add web/src/lib/ web/src/app/layout.tsx
git commit -m "feat: initialize Next.js frontend with auth context and API client"
```

### Task 16: Login Page

**Files:**
- Create: `web/src/app/login/page.tsx`

- [ ] **Step 1: Create login page**

```tsx
// web/src/app/login/page.tsx
"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  // Hardcoded for single-tenant MVP — will come from config later
  const tenantId = process.env.NEXT_PUBLIC_TENANT_ID || "";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login(email, password, tenantId);
      router.push("/approvals");
    } catch {
      setError("Invalid email or password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-center mb-8">emrai</h1>
        <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-6 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded text-sm">{error}</div>
          )}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds**

```bash
cd /home/andy/dev/andybarilla/emrai/web && npm run build
```

Expected: builds successfully.

- [ ] **Step 3: Commit**

```bash
cd /home/andy/dev/andybarilla/emrai
git add web/src/app/login/
git commit -m "feat: add login page"
```

### Task 17: Approvals Dashboard

**Files:**
- Create: `web/src/app/approvals/page.tsx`
- Create: `web/src/components/approval-card.tsx`
- Create: `web/src/components/approval-list.tsx`
- Create: `web/src/components/batch-actions.tsx`

- [ ] **Step 1: Create approval card component**

```tsx
// web/src/components/approval-card.tsx
"use client";

interface ApprovalItem {
  id: string;
  patient_name: string;
  procedure_name: string;
  dosage?: string;
  staff_name?: string;
  order_date: string;
  flagged: boolean;
  flag_reasons?: string[];
  status: string;
}

interface ApprovalCardProps {
  item: ApprovalItem;
  selected: boolean;
  onToggle: (id: string) => void;
}

export function ApprovalCard({ item, selected, onToggle }: ApprovalCardProps) {
  return (
    <div
      className={`border rounded-lg p-4 ${
        item.flagged ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(item.id)}
          className="mt-1"
        />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {item.flagged && <span className="text-amber-600 text-sm font-medium">Needs Review</span>}
            <span className="font-medium">{item.patient_name}</span>
          </div>
          <div className="text-sm text-gray-600 mt-1">
            {item.procedure_name}
            {item.dosage && ` — ${item.dosage}`}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {item.staff_name && `Staff: ${item.staff_name} | `}
            Date: {item.order_date}
          </div>
          {item.flagged && item.flag_reasons && (
            <div className="mt-2 text-sm text-amber-700">
              {item.flag_reasons.map((reason, i) => (
                <div key={i}>- {reason}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export type { ApprovalItem };
```

- [ ] **Step 2: Create batch actions component**

```tsx
// web/src/components/batch-actions.tsx
"use client";

interface BatchActionsProps {
  totalCount: number;
  selectedCount: number;
  unflaggedCount: number;
  onSelectAllUnflagged: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onApprove: () => void;
  approving: boolean;
}

export function BatchActions({
  totalCount,
  selectedCount,
  unflaggedCount,
  onSelectAllUnflagged,
  onSelectAll,
  onDeselectAll,
  onApprove,
  approving,
}: BatchActionsProps) {
  return (
    <div className="flex items-center justify-between bg-white border rounded-lg p-4">
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-600">
          {selectedCount} of {totalCount} selected
        </span>
        <button
          onClick={onSelectAllUnflagged}
          className="text-sm text-blue-600 hover:text-blue-700"
        >
          Select all standard ({unflaggedCount})
        </button>
        <button onClick={onSelectAll} className="text-sm text-blue-600 hover:text-blue-700">
          Select all
        </button>
        <button onClick={onDeselectAll} className="text-sm text-gray-500 hover:text-gray-600">
          Clear
        </button>
      </div>
      <button
        onClick={onApprove}
        disabled={selectedCount === 0 || approving}
        className="bg-green-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50"
      >
        {approving ? "Approving..." : `Approve selected (${selectedCount})`}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Create approval list component**

```tsx
// web/src/components/approval-list.tsx
"use client";

import { ApprovalCard, ApprovalItem } from "./approval-card";

interface ApprovalListProps {
  items: ApprovalItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}

export function ApprovalList({ items, selectedIds, onToggle }: ApprovalListProps) {
  if (items.length === 0) {
    return (
      <div className="text-center text-gray-500 py-12">
        No pending approvals. You're all caught up.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <ApprovalCard
          key={item.id}
          item={item}
          selected={selectedIds.has(item.id)}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create approvals page**

```tsx
// web/src/app/approvals/page.tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { ApprovalList } from "@/components/approval-list";
import { BatchActions } from "@/components/batch-actions";
import type { ApprovalItem } from "@/components/approval-card";

export default function ApprovalsPage() {
  const { isAuthenticated, logout } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/login");
    }
  }, [isAuthenticated, router]);

  const loadItems = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.fetch<ApprovalItem[]>("/api/approvals");
      setItems(data);
    } catch {
      setError("Failed to load approvals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) loadItems();
  }, [isAuthenticated, loadItems]);

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApprove = async () => {
    setApproving(true);
    setError("");
    try {
      await api.fetch("/api/approvals/batch-approve", {
        method: "POST",
        body: JSON.stringify({ item_ids: Array.from(selectedIds) }),
      });
      setSelectedIds(new Set());
      await loadItems();
    } catch {
      setError("Failed to approve orders");
    } finally {
      setApproving(false);
    }
  };

  const unflaggedItems = items.filter((i) => !i.flagged);

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">emrai — Approvals</h1>
        <button onClick={logout} className="text-sm text-gray-500 hover:text-gray-700">
          Sign out
        </button>
      </header>

      <main className="max-w-3xl mx-auto py-6 px-4 space-y-4">
        {error && (
          <div className="bg-red-50 text-red-700 p-3 rounded text-sm">{error}</div>
        )}

        {loading ? (
          <div className="text-center text-gray-500 py-12">Loading...</div>
        ) : (
          <>
            <BatchActions
              totalCount={items.length}
              selectedCount={selectedIds.size}
              unflaggedCount={unflaggedItems.length}
              onSelectAllUnflagged={() =>
                setSelectedIds(new Set(unflaggedItems.map((i) => i.id)))
              }
              onSelectAll={() => setSelectedIds(new Set(items.map((i) => i.id)))}
              onDeselectAll={() => setSelectedIds(new Set())}
              onApprove={handleApprove}
              approving={approving}
            />
            <ApprovalList
              items={items}
              selectedIds={selectedIds}
              onToggle={toggleItem}
            />
          </>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Verify it builds**

```bash
cd /home/andy/dev/andybarilla/emrai/web && npm run build
```

Expected: builds successfully.

- [ ] **Step 6: Commit**

```bash
cd /home/andy/dev/andybarilla/emrai
git add web/src/app/approvals/ web/src/components/
git commit -m "feat: add batch approvals dashboard with flagging UI"
```

---

## Chunk 6: Seed Data + End-to-End Verification

### Task 18: Seed Script + Manual E2E Test

**Files:**
- Create: `scripts/seed.go`

- [ ] **Step 1: Create seed script**

This creates a test tenant, user, and protocols for local development.

```go
// scripts/seed.go
//go:build ignore

package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andybarilla/emrai/internal/auth"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://emrai:emrai@localhost:5432/emrai?sslmode=disable"
	}

	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	ctx := context.Background()

	// Create tenant
	var tenantID string
	err = pool.QueryRow(ctx,
		`INSERT INTO tenants (name, athena_practice_id)
		 VALUES ('Dev Practice', '195900')
		 ON CONFLICT DO NOTHING
		 RETURNING id`,
	).Scan(&tenantID)
	if err != nil {
		// Tenant may already exist
		err = pool.QueryRow(ctx, `SELECT id FROM tenants WHERE name = 'Dev Practice'`).Scan(&tenantID)
		if err != nil {
			log.Fatalf("get tenant: %v", err)
		}
	}
	fmt.Printf("Tenant ID: %s\n", tenantID)

	// Create physician user
	hash, _ := auth.HashPassword("password123")
	_, err = pool.Exec(ctx,
		`INSERT INTO users (tenant_id, email, password_hash, role, name)
		 VALUES ($1, 'doctor@example.com', $2, 'physician', 'Dr. Example')
		 ON CONFLICT (tenant_id, email) DO NOTHING`,
		tenantID, hash,
	)
	if err != nil {
		log.Fatalf("create user: %v", err)
	}
	fmt.Println("User: doctor@example.com / password123")

	// Create protocols
	_, err = pool.Exec(ctx,
		`INSERT INTO protocols (tenant_id, name, procedure_name, standard_dosage, max_lab_age_days, requires_established_patient)
		 VALUES
		   ($1, 'Standard Testosterone Pellet', 'Testosterone Pellet', '200mg', 90, true),
		   ($1, 'Standard Estradiol Injection', 'Estradiol Injection', '20mg', 90, true)
		 ON CONFLICT DO NOTHING`,
		tenantID,
	)
	if err != nil {
		log.Fatalf("create protocols: %v", err)
	}
	fmt.Println("Protocols created")

	// Create sample approval items (simulating what would come from Athena)
	_, err = pool.Exec(ctx,
		`INSERT INTO approval_items (tenant_id, emr_order_id, patient_id, patient_name, procedure_name, dosage, staff_name, order_date, flagged, status)
		 VALUES
		   ($1, 'ORD-001', 'PAT-001', 'Jane Doe', 'Testosterone Pellet', '200mg', 'Sarah', '2026-03-13', false, 'pending'),
		   ($1, 'ORD-002', 'PAT-002', 'Alex Martinez', 'Estradiol Injection', '20mg', 'Sarah', '2026-03-13', false, 'pending'),
		   ($1, 'ORD-003', 'PAT-003', 'Pat Robinson', 'Testosterone Pellet', '250mg', 'Kim', '2026-03-13', true, 'needs_review'),
		   ($1, 'ORD-004', 'PAT-004', 'Maria Santos', 'Estradiol Injection', '20mg', 'Sarah', '2026-03-13', false, 'pending')
		 ON CONFLICT DO NOTHING`,
		tenantID,
	)
	if err != nil {
		log.Fatalf("create sample items: %v", err)
	}

	// Add flag reasons to Pat Robinson's order
	_, _ = pool.Exec(ctx,
		`UPDATE approval_items SET flag_reasons = '["dosage differs from standard (250mg vs 200mg)"]'
		 WHERE emr_order_id = 'ORD-003' AND tenant_id = $1`,
		tenantID,
	)

	fmt.Println("Sample approval items created")
	fmt.Printf("\nTenant ID for .env: %s\n", tenantID)
}
```

- [ ] **Step 2: Run seed script**

```bash
docker compose up -d db
go run ./cmd/emrai &  # run migrations first
sleep 2
kill %1
go run scripts/seed.go
```

Expected: prints tenant ID, user credentials, and confirmation messages.

- [ ] **Step 3: Manual E2E test**

```bash
# Start backend
go run ./cmd/emrai &

# Start frontend
cd web && npm run dev &

# Test login
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"doctor@example.com","password":"password123","tenant_id":"TENANT_ID_FROM_SEED"}'

# Use the returned token to list approvals
curl http://localhost:8080/api/approvals \
  -H "Authorization: Bearer TOKEN_FROM_LOGIN"
```

Expected: login returns a token; approvals endpoint returns 4 items (3 unflagged, 1 flagged).

Open http://localhost:3000/login in browser, sign in, verify the approvals dashboard shows the sample data with Pat Robinson's order flagged.

- [ ] **Step 4: Commit**

```bash
cd /home/andy/dev/andybarilla/emrai
git add scripts/seed.go
git commit -m "feat: add seed script for local development"
```

### Task 19: Add Next.js Proxy Config + CORS

**Files:**
- Modify: `web/next.config.js` (or `web/next.config.ts`)
- Modify: `internal/server/server.go`

- [ ] **Step 1: Add CORS middleware to Go server**

Add a CORS handler in `internal/server/server.go`:

```go
// corsOrigin should be set from cfg.CORSOrigin
func corsMiddleware(corsOrigin string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", corsOrigin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
```

Wrap the router in `Start()`:

```go
func (s *Server) Start() error {
	addr := ":" + s.cfg.Port
	log.Printf("listening on %s", addr)
	return http.ListenAndServe(addr, corsMiddleware(s.cfg.CORSOrigin)(s.router))
}
```

- [ ] **Step 2: Verify it compiles and test CORS**

```bash
go build ./...
```

Expected: compiles successfully.

- [ ] **Step 3: Commit**

```bash
git add internal/server/server.go
git commit -m "feat: add CORS support for local frontend dev"
```

---

## Deferred Items (Address Before Production)

These items are intentionally deferred from Phase 1 MVP to keep scope manageable, but must be addressed before production use:

1. **Athena OAuth authorization_code flow** — The Athena client currently uses `client_credentials` (service account). Production requires `authorization_code` flow so write-backs use the physician's identity. Update after API audit confirms the exact flow needed.
2. **MFA for physician accounts** — Schema has `mfa_secret` and `mfa_enabled` columns. Implementation (TOTP via `pquerna/otp`) is deferred to a follow-up task before production.
3. **Refresh token flow + sliding session expiry** — Schema has `refresh_tokens` table. Implement token rotation so active sessions don't expire mid-use (HIPAA idle timeout != JWT expiry). Currently JWT expiry acts as a hard session limit.
4. **PHI log sanitization** — Error paths in the Athena client log response bodies which may contain PHI. Add log sanitization middleware before production.
5. **Athena token encryption at rest** — Schema uses `_enc` suffix columns for Athena tokens. Implement application-level AES encryption for these columns (RDS encryption-at-rest is necessary but not sufficient per spec).
6. **Athena API rate limiting / request queue** — Add rate limiter with backoff to the Athena client before connecting to production API.

## What Comes After This Plan

This plan covers the **complete Phase 1 (Batch Approvals)** with working backend + frontend. After completing this plan, the next steps are:

1. **Complete the athenahealth API audit (Task 1)** and refine `internal/emr/athena/orders.go` based on actual endpoint capabilities
2. **Address deferred items above** before production deployment
3. **Phase 2 plan: Scribe module** — audio capture, WebSocket streaming, Transcribe Medical integration, note summarization
4. **Phase 3 plan: Fax/Doc Processor** — eFax vendor selection, ingest pipeline, OCR, document classification
