package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/sqlite3"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	_ "github.com/mattn/go-sqlite3"

	"github.com/andybarilla/janushc-dash/internal/approval"
	"github.com/andybarilla/janushc-dash/internal/auth"
	"github.com/andybarilla/janushc-dash/internal/bedrock"
	"github.com/andybarilla/janushc-dash/internal/config"
	"github.com/andybarilla/janushc-dash/internal/database"
	"github.com/andybarilla/janushc-dash/internal/emr/athena"
	"github.com/andybarilla/janushc-dash/internal/ocr"
	"github.com/andybarilla/janushc-dash/internal/scribe"
	"github.com/andybarilla/janushc-dash/internal/server"
	"github.com/andybarilla/janushc-dash/internal/transcribe"
	"github.com/andybarilla/janushc-dash/internal/users"
)

type duplicateNormalizedEmail struct {
	normalizedEmail string
	userCount       int
}

func formatDuplicateNormalizedEmails(duplicates []duplicateNormalizedEmail) string {
	parts := make([]string, 0, len(duplicates))
	for _, duplicate := range duplicates {
		parts = append(parts, fmt.Sprintf("%s (%d users)", duplicate.normalizedEmail, duplicate.userCount))
	}
	return strings.Join(parts, ", ")
}

func sqliteDSN(databaseURL string) string {
	dsn := strings.TrimPrefix(databaseURL, "sqlite3://")
	dsn = strings.TrimPrefix(dsn, "sqlite://")
	if !strings.Contains(dsn, "?") {
		dsn += "?_foreign_keys=on"
	} else if !strings.Contains(dsn, "_foreign_keys=") {
		dsn += "&_foreign_keys=on"
	}
	return dsn
}

func sqliteMigrateURL(databaseURL string) string {
	dsn := strings.TrimPrefix(databaseURL, "sqlite3://")
	dsn = strings.TrimPrefix(dsn, "sqlite://")
	if idx := strings.IndexByte(dsn, '?'); idx >= 0 {
		dsn = dsn[:idx]
	}
	return "sqlite3://" + dsn
}

func ensureSQLiteDir(databaseURL string) error {
	dsn := strings.TrimPrefix(databaseURL, "sqlite3://")
	dsn = strings.TrimPrefix(dsn, "sqlite://")
	if idx := strings.IndexByte(dsn, '?'); idx >= 0 {
		dsn = dsn[:idx]
	}
	if dsn == "" || dsn == ":memory:" || strings.HasPrefix(dsn, "file:") {
		return nil
	}
	return os.MkdirAll(filepath.Dir(dsn), 0o755)
}

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	if err := ensureSQLiteDir(cfg.DatabaseURL); err != nil {
		log.Fatalf("failed to create database directory: %v", err)
	}

	// Run migrations
	migrateURL := sqliteMigrateURL(cfg.DatabaseURL)
	m, err := migrate.New("file://migrations", migrateURL)
	if err != nil {
		log.Fatalf("failed to create migrator: %v", err)
	}
	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		log.Fatalf("failed to run migrations: %v", err)
	}
	log.Println("migrations complete")

	// Connect to database
	db, err := sql.Open("sqlite3", sqliteDSN(cfg.DatabaseURL))
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer db.Close()
	if _, err := db.ExecContext(context.Background(), "PRAGMA foreign_keys = ON"); err != nil {
		log.Fatalf("failed to enable sqlite foreign keys: %v", err)
	}
	if err := db.PingContext(context.Background()); err != nil {
		log.Fatalf("failed to ping database: %v", err)
	}

	// Create dependencies
	queries := database.New(db)
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

	// Create transcribe batch client (S3 + Transcribe Medical batch API). Used
	// by the scribe upload handler for asynchronous transcription of recorded
	// audio. AWS_TRANSCRIBE_BUCKET must point at a writable S3 bucket; without
	// it, uploads will fail with a clear error from the handler.
	transcribeBatchClient, err := transcribe.NewBatchClient(context.Background(), cfg.AWSRegion)
	if err != nil {
		log.Fatalf("failed to create transcribe batch client: %v", err)
	}
	if cfg.AWSTranscribeBucket == "" {
		log.Printf("WARNING: AWS_TRANSCRIBE_BUCKET is not set; scribe audio uploads will fail until it is configured")
	}

	// OCR document upload reuses the transcribe S3 bucket (scribe-documents/ prefix)
	// and routes through the scribe pipeline (OCR text -> 4-section note).
	ocrClient, err := ocr.NewClient(context.Background(), cfg.AWSRegion, cfg.AWSTranscribeBucket)
	if err != nil {
		log.Fatalf("failed to create OCR client: %v", err)
	}
	// Probe Textract permissions in the background so a misconfigured IAM principal
	// is surfaced at boot rather than on the first document upload. Non-fatal.
	if cfg.AWSTranscribeBucket != "" {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if permErr := ocrClient.CheckPermissions(ctx); permErr != nil {
				log.Printf("WARNING: AWS Textract permission check failed; document OCR uploads will fail until the credentials are granted textract:StartDocumentTextDetection and textract:GetDocumentTextDetection: %v", permErr)
			}
		}()
	}

	// Create scribe dependencies
	scribeProcessor := scribe.NewProcessor(bedrockClient, athenaClient)
	scribeHandler := scribe.NewHandler(queries, scribeProcessor, cfg, transcribeBatchClient, athenaClient, ocrClient)

	// Start server
	srv := server.New(cfg, db, queries, authHandler, approvalHandler, usersHandler, scribeHandler)
	log.Fatal(srv.Start())
}
