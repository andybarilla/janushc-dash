package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgtype"
	"github.com/joho/godotenv"
	_ "github.com/mattn/go-sqlite3"

	"github.com/andybarilla/janushc-dash/internal/bedrock"
	"github.com/andybarilla/janushc-dash/internal/database"
	"github.com/andybarilla/janushc-dash/internal/transcriptimport"
)

const defaultBedrockModelID = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"

type options struct {
	databaseURL     string
	tenantName      string
	patientPrefix   string
	encounterPrefix string
	apply           bool
	timeout         time.Duration
}

type backfillPlan struct {
	SessionID       pgtype.UUID
	TenantID        pgtype.UUID
	OldPatientID    string
	NewPatientID    string
	OldCreatedAt    pgtype.Timestamptz
	NewCreatedAt    pgtype.Timestamptz
	UpdatePatientID bool
	UpdateCreatedAt bool
	SkipReason      string
}

var parseGoogleRecorderTimestampSlug = transcriptimport.ParseGoogleRecorderTimestampSlug

func main() {
	_ = godotenv.Load()

	var opts options
	flag.StringVar(&opts.databaseURL, "database", os.Getenv("DATABASE_URL"), "SQLite database path or URL")
	flag.StringVar(&opts.tenantName, "tenant", "Janus Healthcare", "tenant name to backfill")
	flag.StringVar(&opts.patientPrefix, "patient-prefix", "demo-patient", "placeholder patient ID prefix")
	flag.StringVar(&opts.encounterPrefix, "encounter-prefix", "demo-encounter-", "placeholder encounter ID prefix")
	flag.BoolVar(&opts.apply, "apply", false, "write proposed updates")
	flag.DurationVar(&opts.timeout, "timeout", 10*time.Minute, "timeout for candidate listing and inference")
	flag.Parse()

	if opts.databaseURL == "" {
		log.Fatal("database URL is empty; set -database or DATABASE_URL")
	}
	if err := run(context.Background(), opts, os.Stdout); err != nil {
		log.Fatal(err)
	}
}

func run(parent context.Context, opts options, output io.Writer) error {
	db, err := sql.Open("sqlite3", sqliteDSN(opts.databaseURL))
	if err != nil {
		return fmt.Errorf("connect database: %w", err)
	}
	defer db.Close()
	if _, err := db.ExecContext(parent, "PRAGMA foreign_keys = ON"); err != nil {
		return fmt.Errorf("enable foreign keys: %w", err)
	}

	ctx, cancel := context.WithTimeout(parent, opts.timeout)
	defer cancel()

	tenantID, err := resolveTenantID(ctx, db, opts.tenantName)
	if err != nil {
		return err
	}

	candidates, err := database.New(db).ListImportedScribeSessionBackfillCandidates(ctx, database.ListImportedScribeSessionBackfillCandidatesParams{
		TenantID:    tenantID,
		EncounterID: opts.encounterPrefix + "%",
	})
	if err != nil {
		return fmt.Errorf("list backfill candidates: %w", err)
	}

	client, err := bedrock.NewClient(ctx, getenv("AWS_REGION", "us-east-1"), getenv("AWS_BEDROCK_MODEL_ID", defaultBedrockModelID))
	if err != nil {
		return fmt.Errorf("create bedrock client: %w", err)
	}
	queries := database.New(db)
	now := time.Now()
	for _, row := range candidates {
		plan, err := buildBackfillPlan(ctx, client, row, opts, now)
		if err != nil {
			return err
		}
		printBackfillPlan(output, plan)
		if !opts.apply {
			continue
		}
		if err := applyBackfillPlan(ctx, queries, plan); err != nil {
			return err
		}
	}
	return nil
}

func buildBackfillPlan(ctx context.Context, client transcriptimport.CompletionClient, row database.ListImportedScribeSessionBackfillCandidatesRow, opts options, now time.Time) (backfillPlan, error) {
	plan := backfillPlan{
		SessionID:    row.ID,
		TenantID:     row.TenantID,
		OldPatientID: row.PatientID,
		NewPatientID: row.PatientID,
		OldCreatedAt: row.CreatedAt,
		NewCreatedAt: row.CreatedAt,
	}

	var skipReasons []string
	if !isGeneratedPatientID(row.PatientID, opts.patientPrefix) {
		skipReasons = append(skipReasons, fmt.Sprintf("patient_id %q is not a generated placeholder", row.PatientID))
	} else {
		patientName, err := transcriptimport.InferPatientName(ctx, client, transcriptimport.FirstCleanTranscriptLine(row.Transcript.String))
		if err != nil {
			skipReasons = append(skipReasons, fmt.Sprintf("patient inference failed: %v", err))
		} else if patientName == "" {
			skipReasons = append(skipReasons, "patient inference was blank or uncertain")
		} else if patientName != row.PatientID {
			plan.NewPatientID = patientName
			plan.UpdatePatientID = true
		}
	}

	createdAt, ok, err := parseGoogleRecorderTimestampSlug(row.EncounterID, opts.encounterPrefix, now)
	if err != nil {
		if errors.Is(err, transcriptimport.ErrRecorderTimezoneUnavailable) {
			return plan, fmt.Errorf("infer timestamp for session %s: %w", row.ID.String(), err)
		}
		skipReasons = append(skipReasons, fmt.Sprintf("timestamp inference failed: %v", err))
	} else if !ok {
		skipReasons = append(skipReasons, "timestamp slug is not a valid Google Recorder timestamp")
	} else if !createdAt.Equal(row.CreatedAt.Time) {
		plan.NewCreatedAt = pgtype.Timestamptz{Time: createdAt, Valid: true}
		plan.UpdateCreatedAt = true
	}

	plan.SkipReason = strings.Join(skipReasons, "; ")
	return plan, nil
}

func isGeneratedPatientID(patientID, prefix string) bool {
	pattern := regexp.MustCompile("^" + regexp.QuoteMeta(prefix) + `-\d{3}$`)
	return pattern.MatchString(patientID)
}

func applyBackfillPlan(ctx context.Context, queries *database.Queries, plan backfillPlan) error {
	if plan.UpdatePatientID {
		updatedRows, err := queries.UpdateScribeSessionPatientID(ctx, database.UpdateScribeSessionPatientIDParams{
			ID:        plan.SessionID,
			TenantID:  plan.TenantID,
			PatientID: plan.NewPatientID,
		})
		if err != nil {
			return fmt.Errorf("update patient_id for session %s: %w", plan.SessionID.String(), err)
		}
		if updatedRows == 0 {
			return fmt.Errorf("update patient_id for session %s: session was already sent, rejected, or missing", plan.SessionID.String())
		}
	}
	if plan.UpdateCreatedAt {
		if err := queries.UpdateScribeSessionCreatedAt(ctx, database.UpdateScribeSessionCreatedAtParams{
			ID:        plan.SessionID,
			TenantID:  plan.TenantID,
			CreatedAt: plan.NewCreatedAt,
		}); err != nil {
			return fmt.Errorf("update created_at for session %s: %w", plan.SessionID.String(), err)
		}
	}
	return nil
}

func printBackfillPlan(w io.Writer, plan backfillPlan) {
	fmt.Fprintf(w, "session=%s patient_id=%q -> %q created_at=%s -> %s skip_reason=%q\n",
		plan.SessionID.String(),
		plan.OldPatientID,
		plan.NewPatientID,
		formatTimestamp(plan.OldCreatedAt),
		formatTimestamp(plan.NewCreatedAt),
		plan.SkipReason,
	)
}

func resolveTenantID(ctx context.Context, db *sql.DB, tenantName string) (pgtype.UUID, error) {
	var tenantID pgtype.UUID
	err := db.QueryRowContext(ctx, `SELECT id FROM tenants WHERE name = ?`, tenantName).Scan(&tenantID)
	if errors.Is(err, sql.ErrNoRows) {
		return pgtype.UUID{}, fmt.Errorf("tenant %q not found", tenantName)
	}
	if err != nil {
		return pgtype.UUID{}, fmt.Errorf("resolve tenant %q: %w", tenantName, err)
	}
	return tenantID, nil
}

func formatTimestamp(value pgtype.Timestamptz) string {
	if !value.Valid {
		return "<null>"
	}
	return value.Time.Format(time.RFC3339)
}

func sqliteDSN(databaseURL string) string {
	dsn := strings.TrimPrefix(databaseURL, "sqlite3://")
	dsn = strings.TrimPrefix(dsn, "sqlite://")
	if !strings.Contains(dsn, "?") {
		return dsn + "?_foreign_keys=on"
	}
	if !strings.Contains(dsn, "_foreign_keys=") {
		return dsn + "&_foreign_keys=on"
	}
	return dsn
}

func getenv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
