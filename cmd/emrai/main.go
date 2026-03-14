package main

import (
	"context"
	"log"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andybarilla/emrai/internal/approval"
	"github.com/andybarilla/emrai/internal/auth"
	"github.com/andybarilla/emrai/internal/config"
	"github.com/andybarilla/emrai/internal/database"
	"github.com/andybarilla/emrai/internal/server"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	// Run migrations
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

	// Create dependencies
	queries := database.New(pool)
	authHandler := auth.NewHandler(queries, cfg.JWTSecret, cfg.JWTExpiry)
	approvalHandler := approval.NewHandler(queries)

	// Start server
	srv := server.New(cfg, pool, queries, authHandler, approvalHandler)
	log.Fatal(srv.Start())
}
