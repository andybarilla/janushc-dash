package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/joho/godotenv"
	_ "github.com/mattn/go-sqlite3"

	"github.com/andybarilla/janushc-dash/internal/bedrock"
	"github.com/andybarilla/janushc-dash/internal/config"
	"github.com/andybarilla/janushc-dash/internal/database"
	"github.com/andybarilla/janushc-dash/internal/emr/athena"
	"github.com/andybarilla/janushc-dash/internal/scribe"
)

type options struct {
	input         string
	tenantName    string
	userEmail     string
	patientPrefix string
	departmentID  string
	process       bool
	overwrite     bool
	dryRun        bool
	timeout       time.Duration
}

func main() {
	var opts options
	flag.StringVar(&opts.input, "input", "tmp/transcripts", "transcript .txt file or directory to import")
	flag.StringVar(&opts.tenantName, "tenant", "Janus Healthcare", "tenant name to import sessions under")
	flag.StringVar(&opts.userEmail, "user", "drcrance@janushc.com", "user email to own imported sessions")
	flag.StringVar(&opts.patientPrefix, "patient-prefix", "demo-patient", "placeholder patient ID prefix")
	flag.StringVar(&opts.departmentID, "department-id", "1", "placeholder department ID")
	flag.BoolVar(&opts.process, "process", true, "run Bedrock scribe processing and store ai_output")
	flag.BoolVar(&opts.overwrite, "overwrite", false, "replace existing sessions with matching encounter IDs")
	flag.BoolVar(&opts.dryRun, "dry-run", false, "print planned imports without writing to the database")
	flag.DurationVar(&opts.timeout, "timeout", 10*time.Minute, "timeout per transcript for AI processing")
	flag.Parse()

	_ = godotenv.Load()

	files, err := transcriptFiles(opts.input)
	if err != nil {
		log.Fatalf("find transcripts: %v", err)
	}
	if len(files) == 0 {
		log.Fatalf("no .txt transcripts found in %s", opts.input)
	}

	plans := make([]importPlan, 0, len(files))
	for i, file := range files {
		plans = append(plans, buildImportPlan(file, i+1, opts))
	}

	if opts.dryRun {
		for _, plan := range plans {
			fmt.Printf("%s -> patient=%s encounter=%s department=%s\n", plan.path, plan.patientID, plan.encounterID, plan.departmentID)
		}
		return
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	db, err := sql.Open("sqlite3", sqliteDSN(cfg.DatabaseURL))
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}
	defer db.Close()
	if _, err := db.ExecContext(context.Background(), "PRAGMA foreign_keys = ON"); err != nil {
		log.Fatalf("enable foreign keys: %v", err)
	}

	ctx := context.Background()
	tenantID, userID, err := resolveTenantUser(ctx, db, opts.tenantName, opts.userEmail)
	if err != nil {
		log.Fatalf("resolve tenant/user: %v", err)
	}

	queries := database.New(db)
	var processor *scribe.Processor
	if opts.process {
		bedrockClient, err := bedrock.NewClient(ctx, cfg.AWSRegion, cfg.BedrockModelID)
		if err != nil {
			log.Fatalf("create bedrock client: %v", err)
		}
		athenaClient := athena.NewClient(cfg.AthenaBaseURL, cfg.AthenaClientID, cfg.AthenaClientSecret)
		processor = scribe.NewProcessor(bedrockClient, athenaClient)
	}

	var failed int
	for i, plan := range plans {
		if err := importOne(ctx, db, queries, processor, cfg, tenantID, userID, plan, opts); err != nil {
			log.Printf("[%d/%d] failed %s: %v", i+1, len(plans), plan.path, err)
			failed++
			continue
		}
		log.Printf("[%d/%d] imported %s", i+1, len(plans), plan.path)
	}
	if failed > 0 {
		log.Fatalf("completed with %d failure(s)", failed)
	}
}

type importPlan struct {
	path         string
	patientID    string
	encounterID  string
	departmentID string
}

func buildImportPlan(path string, index int, opts options) importPlan {
	name := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	slug := slugify(name)
	return importPlan{
		path:         path,
		patientID:    fmt.Sprintf("%s-%03d", opts.patientPrefix, index),
		encounterID:  "demo-encounter-" + slug,
		departmentID: opts.departmentID,
	}
}

func importOne(parent context.Context, db *sql.DB, queries *database.Queries, processor *scribe.Processor, cfg *config.Config, tenantID, userID pgtype.UUID, plan importPlan, opts options) error {
	transcriptBytes, err := os.ReadFile(plan.path)
	if err != nil {
		return fmt.Errorf("read transcript: %w", err)
	}
	transcript := strings.TrimSpace(string(transcriptBytes))
	if transcript == "" {
		return errors.New("empty transcript")
	}

	existingID, err := existingSessionID(parent, db, tenantID, plan.encounterID)
	if err != nil {
		return err
	}
	if existingID.Valid {
		if !opts.overwrite {
			log.Printf("skipping %s; session already exists for encounter %s", plan.path, plan.encounterID)
			return nil
		}
		if _, err := db.ExecContext(parent, `DELETE FROM scribe_sessions WHERE tenant_id = ?1 AND encounter_id = ?2`, tenantID, plan.encounterID); err != nil {
			return fmt.Errorf("delete existing session: %w", err)
		}
	}

	session, err := queries.CreateScribeSession(parent, database.CreateScribeSessionParams{
		TenantID:     tenantID,
		UserID:       userID,
		PatientID:    plan.patientID,
		EncounterID:  plan.encounterID,
		DepartmentID: plan.departmentID,
	})
	if err != nil {
		return fmt.Errorf("create session: %w", err)
	}
	if err := queries.UpdateScribeSessionProcessing(parent, database.UpdateScribeSessionProcessingParams{
		ID:         session.ID,
		TenantID:   tenantID,
		Transcript: pgtype.Text{String: transcript, Valid: true},
	}); err != nil {
		return fmt.Errorf("store transcript: %w", err)
	}
	if !opts.process {
		_, err := db.ExecContext(parent, `UPDATE scribe_sessions SET status = 'complete', completed_at = CURRENT_TIMESTAMP WHERE id = ?1 AND tenant_id = ?2`, session.ID, tenantID)
		if err != nil {
			return fmt.Errorf("mark transcript imported: %w", err)
		}
		return nil
	}

	ctx, cancel := context.WithTimeout(parent, opts.timeout)
	defer cancel()
	output, err := processor.Process(ctx, cfg.AthenaPracticeID, plan.patientID, transcript)
	if err != nil {
		_ = queries.UpdateScribeSessionError(parent, database.UpdateScribeSessionErrorParams{
			ID:           session.ID,
			TenantID:     tenantID,
			ErrorMessage: pgtype.Text{String: err.Error(), Valid: true},
		})
		return fmt.Errorf("process transcript: %w", err)
	}
	outputJSON, err := aiOutputJSON(output)
	if err != nil {
		return fmt.Errorf("marshal AI output: %w", err)
	}
	if err := queries.UpdateScribeSessionComplete(parent, database.UpdateScribeSessionCompleteParams{
		ID:       session.ID,
		TenantID: tenantID,
		AiOutput: outputJSON,
	}); err != nil {
		return fmt.Errorf("store AI output: %w", err)
	}
	return nil
}

func aiOutputJSON(result scribe.ProcessResult) ([]byte, error) {
	return json.Marshal(result.Output)
}

func resolveTenantUser(ctx context.Context, db *sql.DB, tenantName, userEmail string) (pgtype.UUID, pgtype.UUID, error) {
	var tenantID, userID pgtype.UUID
	err := db.QueryRowContext(ctx, `
		SELECT t.id, u.id
		FROM tenants t
		JOIN users u ON u.tenant_id = t.id
		WHERE t.name = ?1 AND u.email = ?2
	`, tenantName, userEmail).Scan(&tenantID, &userID)
	if err != nil {
		return tenantID, userID, err
	}
	return tenantID, userID, nil
}

func existingSessionID(ctx context.Context, db *sql.DB, tenantID pgtype.UUID, encounterID string) (pgtype.UUID, error) {
	var id pgtype.UUID
	err := db.QueryRowContext(ctx, `SELECT id FROM scribe_sessions WHERE tenant_id = ?1 AND encounter_id = ?2 LIMIT 1`, tenantID, encounterID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return pgtype.UUID{}, nil
	}
	if err != nil {
		return pgtype.UUID{}, fmt.Errorf("check existing session: %w", err)
	}
	return id, nil
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

func transcriptFiles(input string) ([]string, error) {
	info, err := os.Stat(input)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		if strings.ToLower(filepath.Ext(input)) != ".txt" {
			return nil, fmt.Errorf("unsupported transcript file %q", input)
		}
		return []string{input}, nil
	}
	var files []string
	if err := filepath.WalkDir(input, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || strings.ToLower(filepath.Ext(path)) != ".txt" {
			return nil
		}
		files = append(files, path)
		return nil
	}); err != nil {
		return nil, err
	}
	sort.Strings(files)
	return files, nil
}

var nonSlugChars = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = nonSlugChars.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		return "transcript"
	}
	return s
}
