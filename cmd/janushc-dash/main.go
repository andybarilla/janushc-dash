package main

import (
	"context"
	"log"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andybarilla/janushc-dash/internal/approval"
	"github.com/andybarilla/janushc-dash/internal/auth"
	"github.com/andybarilla/janushc-dash/internal/config"
	"github.com/andybarilla/janushc-dash/internal/database"
	"github.com/andybarilla/janushc-dash/internal/emr/athena"
	"github.com/andybarilla/janushc-dash/internal/server"
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
	googleVerifier := auth.NewGoogleVerifier(cfg.GoogleClientID, cfg.GoogleAllowedDomain)
	authHandler := auth.NewHandler(queries, googleVerifier, cfg.JWTSecret, cfg.JWTExpiry)
	athenaClient := athena.NewClient(cfg.AthenaBaseURL, cfg.AthenaClientID, cfg.AthenaClientSecret)
	approvalHandler := approval.NewHandler(queries, athenaClient, cfg)

	// Start server
	srv := server.New(cfg, pool, queries, authHandler, approvalHandler)
	log.Fatal(srv.Start())
}
