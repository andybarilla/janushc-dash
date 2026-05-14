package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andybarilla/janushc-dash/internal/approval"
	"github.com/andybarilla/janushc-dash/internal/auth"
	"github.com/andybarilla/janushc-dash/internal/bedrock"
	"github.com/andybarilla/janushc-dash/internal/config"
	"github.com/andybarilla/janushc-dash/internal/database"
	"github.com/andybarilla/janushc-dash/internal/emr/athena"
	"github.com/andybarilla/janushc-dash/internal/scribe"
	"github.com/andybarilla/janushc-dash/internal/server"
	"github.com/andybarilla/janushc-dash/internal/transcribe"
	"github.com/andybarilla/janushc-dash/internal/users"
)

type duplicateNormalizedEmail struct {
	normalizedEmail string
	userCount       int
}

func preflightDuplicateNormalizedEmails(databaseURL string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("connect to database: %w", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping database: %w", err)
	}

	var usersTableExists bool
	if err := pool.QueryRow(ctx, "SELECT to_regclass('public.users') IS NOT NULL").Scan(&usersTableExists); err != nil {
		return fmt.Errorf("check users table existence: %w", err)
	}
	if !usersTableExists {
		return nil
	}

	rows, err := pool.Query(ctx, `
		SELECT lower(email) AS normalized_email, COUNT(*)::int AS user_count
		FROM public.users
		GROUP BY lower(email)
		HAVING COUNT(*) > 1
		ORDER BY lower(email)
	`)
	if err != nil {
		return fmt.Errorf("check duplicate normalized emails: %w", err)
	}
	defer rows.Close()

	duplicates := []duplicateNormalizedEmail{}
	for rows.Next() {
		var duplicate duplicateNormalizedEmail
		if err := rows.Scan(&duplicate.normalizedEmail, &duplicate.userCount); err != nil {
			return fmt.Errorf("scan duplicate normalized email: %w", err)
		}
		duplicates = append(duplicates, duplicate)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read duplicate normalized emails: %w", err)
	}

	if len(duplicates) > 0 {
		return fmt.Errorf("duplicate normalized user emails found: %s; resolve duplicates before applying migration 014", formatDuplicateNormalizedEmails(duplicates))
	}

	return nil
}

func formatDuplicateNormalizedEmails(duplicates []duplicateNormalizedEmail) string {
	parts := make([]string, 0, len(duplicates))
	for _, duplicate := range duplicates {
		parts = append(parts, fmt.Sprintf("%s (%d users)", duplicate.normalizedEmail, duplicate.userCount))
	}
	return strings.Join(parts, ", ")
}

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
	if err := preflightDuplicateNormalizedEmails(cfg.DatabaseURL); err != nil {
		log.Fatalf("failed migration preflight: %v", err)
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
	usersHandler := users.NewHandler(queries, cfg.GoogleAllowedDomain)

	// Create bedrock client
	bedrockClient, err := bedrock.NewClient(context.Background(), cfg.AWSRegion, cfg.BedrockModelID)
	if err != nil {
		log.Fatalf("failed to create bedrock client: %v", err)
	}

	// Create transcribe client
	transcribeClient, err := transcribe.NewClient(context.Background(), cfg.AWSRegion)
	if err != nil {
		log.Fatalf("failed to create transcribe client: %v", err)
	}

	// Create scribe dependencies
	scribeProcessor := scribe.NewProcessor(bedrockClient, athenaClient)
	scribeHandler := scribe.NewHandler(queries, scribeProcessor, cfg, transcribeClient)

	// Start server
	srv := server.New(cfg, pool, queries, authHandler, approvalHandler, usersHandler, scribeHandler)
	log.Fatal(srv.Start())
}
