package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/sqlite3"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgtype"
	_ "github.com/mattn/go-sqlite3"

	"github.com/andybarilla/janushc-dash/internal/bedrock"
	"github.com/andybarilla/janushc-dash/internal/config"
	"github.com/andybarilla/janushc-dash/internal/database"
	"github.com/andybarilla/janushc-dash/internal/scribe"
	"github.com/andybarilla/janushc-dash/internal/transcriptimport"
)

func TestLabelFromFirstDialog(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		transcript string
		want       string
	}{
		{
			name:       "diarized label",
			transcript: "Speaker 0: Jane Smith\nSpeaker 1: Hello",
			want:       "Jane Smith",
		},
		{
			name:       "empty diarization then next line",
			transcript: "Speaker 0:\nJane Smith",
			want:       "Jane Smith",
		},
		{
			name:       "plain transcript",
			transcript: "Jane Smith\nFollow-up discussion",
			want:       "Jane Smith",
		},
		{
			name:       "blank and quote only returns empty",
			transcript: "\n\t\n\"\"\n‘’\n  ”  ",
			want:       "",
		},
		{
			name:       "punctuation outside quote trim set remains",
			transcript: "---Jane Smith…",
			want:       "---Jane Smith…",
		},
		{
			name:       "whitespace around lines prefix and label",
			transcript: "  \n \t Speaker 12: \t “Jane Smith” \t \nSpeaker 1: ignored",
			want:       "Jane Smith",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := labelFromFirstDialog(tt.transcript)
			if got != tt.want {
				t.Fatalf("labelFromFirstDialog() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestImportOneStoresDerivedLabel(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	db := openImportTestDB(t)
	defer db.Close()
	seedImportTestTenantUser(t, ctx, db)

	transcriptPath := filepath.Join(t.TempDir(), "transcript.txt")
	if err := os.WriteFile(transcriptPath, []byte("Speaker 0: Jane Smith\nSpeaker 1: Hello"), 0600); err != nil {
		t.Fatalf("write transcript: %v", err)
	}

	tenantID := importTestUUID(t, "f4909dfe-f082-41fa-9019-63f150cd1c90")
	userID := importTestUUID(t, "31d45421-5ba9-4c9f-b47d-8b5f992261c3")
	plan := importPlan{
		path:         transcriptPath,
		patientID:    "demo-patient-001",
		encounterID:  "demo-encounter-label",
		departmentID: "1",
	}

	err := importOne(ctx, db, database.New(db), nil, &config.Config{}, tenantID, userID, plan, options{process: false})
	if err != nil {
		t.Fatalf("import transcript: %v", err)
	}

	var got string
	if err := db.QueryRowContext(ctx, `SELECT label FROM scribe_sessions WHERE encounter_id = ?1`, plan.encounterID).Scan(&got); err != nil {
		t.Fatalf("query imported label: %v", err)
	}
	if got != "Jane Smith" {
		t.Fatalf("stored label = %q, want %q", got, "Jane Smith")
	}
}

func TestImportOneStoresInferredPatientName(t *testing.T) {
	ctx := context.Background()
	db, tenantID, userID := openSeededImportTestDB(t, ctx)
	defer db.Close()

	plan := importTestPlan(t, "Speaker 0: Jane Smith\nSpeaker 1: Hello")
	err := importOne(ctx, db, database.New(db), nil, &config.Config{}, tenantID, userID, plan, options{
		process:         false,
		inferenceClient: fakeCompletionClient{text: `{"patient_name":"Jane Smith"}`},
	})
	if err != nil {
		t.Fatalf("import transcript: %v", err)
	}

	assertStoredPatientID(t, ctx, db, plan.encounterID, "Jane Smith")
}

func TestImportOneKeepsPlaceholderForBlankInference(t *testing.T) {
	ctx := context.Background()
	db, tenantID, userID := openSeededImportTestDB(t, ctx)
	defer db.Close()

	plan := importTestPlan(t, "Speaker 0: Jane Smith\nSpeaker 1: Hello")
	err := importOne(ctx, db, database.New(db), nil, &config.Config{}, tenantID, userID, plan, options{
		process:         false,
		inferenceClient: fakeCompletionClient{text: `{"patient_name":""}`},
	})
	if err != nil {
		t.Fatalf("import transcript: %v", err)
	}

	assertStoredPatientID(t, ctx, db, plan.encounterID, plan.patientID)
}

func TestImportOneKeepsPlaceholderForInferenceError(t *testing.T) {
	ctx := context.Background()
	db, tenantID, userID := openSeededImportTestDB(t, ctx)
	defer db.Close()

	plan := importTestPlan(t, "Speaker 0: Jane Smith\nSpeaker 1: Hello")
	err := importOne(ctx, db, database.New(db), nil, &config.Config{}, tenantID, userID, plan, options{
		process:         false,
		inferenceClient: fakeCompletionClient{err: errors.New("bedrock unavailable")},
	})
	if err != nil {
		t.Fatalf("import transcript: %v", err)
	}

	assertStoredPatientID(t, ctx, db, plan.encounterID, plan.patientID)
}

func TestImportOneSkipsInferenceWhenClientNil(t *testing.T) {
	ctx := context.Background()
	db, tenantID, userID := openSeededImportTestDB(t, ctx)
	defer db.Close()

	plan := importTestPlan(t, "Speaker 0: Jane Smith\nSpeaker 1: Hello")
	err := importOne(ctx, db, database.New(db), nil, &config.Config{}, tenantID, userID, plan, options{process: false})
	if err != nil {
		t.Fatalf("import transcript: %v", err)
	}

	assertStoredPatientID(t, ctx, db, plan.encounterID, plan.patientID)
}

func TestImportOneUpdatesCreatedAtFromGoogleRecorderFilename(t *testing.T) {
	ctx := context.Background()
	db, tenantID, userID := openSeededImportTestDB(t, ctx)
	defer db.Close()

	plan := importTestPlanWithName(t, "May 28 at 3-37 PM.txt", "Speaker 0: Jane Smith\nSpeaker 1: Hello")
	err := importOne(ctx, db, database.New(db), nil, &config.Config{}, tenantID, userID, plan, options{
		process: false,
		now:     func() time.Time { return time.Date(2026, time.June, 18, 0, 0, 0, 0, time.UTC) },
	})
	if err != nil {
		t.Fatalf("import transcript: %v", err)
	}

	createdAt := storedCreatedAt(t, ctx, db, plan.encounterID)
	location, err := time.LoadLocation("America/Denver")
	if err != nil {
		t.Fatalf("load location: %v", err)
	}
	want := time.Date(2026, time.May, 28, 15, 37, 0, 0, location)
	if !createdAt.Equal(want) {
		t.Fatalf("created_at = %v, want %v", createdAt, want)
	}
}

func TestImportOneKeepsDefaultCreatedAtForSkippedRecorderTimestamps(t *testing.T) {
	tests := []struct {
		name     string
		filename string
	}{
		{name: "non-matching filename", filename: "regular-note.txt"},
		{name: "matching shape with invalid date", filename: "May 99 at 3-37 PM.txt"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := context.Background()
			db, tenantID, userID := openSeededImportTestDB(t, ctx)
			defer db.Close()

			plan := importTestPlanWithName(t, tt.filename, "Speaker 0: Jane Smith\nSpeaker 1: Hello")
			beforeImport := time.Now().UTC().Add(-2 * time.Second)
			err := importOne(ctx, db, database.New(db), nil, &config.Config{}, tenantID, userID, plan, options{
				process: false,
				now:     func() time.Time { return time.Date(2026, time.June, 18, 0, 0, 0, 0, time.UTC) },
			})
			afterImport := time.Now().UTC().Add(2 * time.Second)
			if err != nil {
				t.Fatalf("import transcript: %v", err)
			}

			createdAt := storedCreatedAt(t, ctx, db, plan.encounterID)
			if createdAt.Before(beforeImport) || createdAt.After(afterImport) {
				t.Fatalf("created_at = %v, want database default between %v and %v", createdAt, beforeImport, afterImport)
			}
		})
	}
}

func TestImportOneFailsWhenRecorderTimezoneUnavailable(t *testing.T) {
	ctx := context.Background()
	db, tenantID, userID := openSeededImportTestDB(t, ctx)
	defer db.Close()

	plan := importTestPlan(t, "Speaker 0: Jane Smith\nSpeaker 1: Hello")
	err := importOne(ctx, db, database.New(db), nil, &config.Config{}, tenantID, userID, plan, options{
		process: false,
		parseRecorderTimestamp: func(filename string, now time.Time) (time.Time, bool, error) {
			return time.Time{}, false, fmt.Errorf("wrapped: %w", transcriptimport.ErrRecorderTimezoneUnavailable)
		},
	})
	if !errors.Is(err, transcriptimport.ErrRecorderTimezoneUnavailable) {
		t.Fatalf("import transcript error = %v, want ErrRecorderTimezoneUnavailable", err)
	}
}

func TestImportOneProcessesSelectedPatientID(t *testing.T) {
	ctx := context.Background()
	db, tenantID, userID := openSeededImportTestDB(t, ctx)
	defer db.Close()

	processor := &fakeProcessor{}
	plan := importTestPlan(t, "Speaker 0: Jane Smith\nSpeaker 1: Hello")
	err := importOne(ctx, db, database.New(db), processor, &config.Config{AthenaPracticeID: "practice-1"}, tenantID, userID, plan, options{
		process:         true,
		inferenceClient: fakeCompletionClient{text: `{"patient_name":"Jane Smith"}`},
		timeout:         time.Minute,
	})
	if err != nil {
		t.Fatalf("import transcript: %v", err)
	}

	storedPatientID := storedPatientID(t, ctx, db, plan.encounterID)
	if processor.patientID != storedPatientID {
		t.Fatalf("processor patient ID = %q, want stored patient ID %q", processor.patientID, storedPatientID)
	}
}

func openImportTestDB(t *testing.T) *sql.DB {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "import-test.db")
	db, err := sql.Open("sqlite3", dbPath+"?_foreign_keys=on")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}

	migrationsPath, err := filepath.Abs("../../migrations")
	if err != nil {
		db.Close()
		t.Fatalf("resolve migrations path: %v", err)
	}
	migrator, err := migrate.New("file://"+filepath.ToSlash(migrationsPath), "sqlite3://"+dbPath)
	if err != nil {
		db.Close()
		t.Fatalf("create migrator: %v", err)
	}
	if err := migrator.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		db.Close()
		t.Fatalf("run migrations: %v", err)
	}
	if sourceErr, databaseErr := migrator.Close(); sourceErr != nil || databaseErr != nil {
		db.Close()
		t.Fatalf("close migrator: source=%v database=%v", sourceErr, databaseErr)
	}

	return db
}

func seedImportTestTenantUser(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()

	_, err := db.ExecContext(ctx, `
		INSERT INTO tenants (id, name, athena_practice_id)
		VALUES (?1, ?2, ?3)
	`, "f4909dfe-f082-41fa-9019-63f150cd1c90", "Import Test Tenant", "import-test")
	if err != nil {
		t.Fatalf("seed tenant: %v", err)
	}

	_, err = db.ExecContext(ctx, `
		INSERT INTO users (id, tenant_id, email, password_hash, role, name)
		VALUES (?1, ?2, ?3, ?4, ?5, ?6)
	`, "31d45421-5ba9-4c9f-b47d-8b5f992261c3", "f4909dfe-f082-41fa-9019-63f150cd1c90", "doctor@example.com", "hash", "physician", "Doctor Example")
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
}

func importTestUUID(t *testing.T, value string) pgtype.UUID {
	t.Helper()

	var id pgtype.UUID
	if err := id.Scan(value); err != nil {
		t.Fatalf("parse uuid %q: %v", value, err)
	}
	return id
}

func openSeededImportTestDB(t *testing.T, ctx context.Context) (*sql.DB, pgtype.UUID, pgtype.UUID) {
	t.Helper()

	db := openImportTestDB(t)
	seedImportTestTenantUser(t, ctx, db)
	return db,
		importTestUUID(t, "f4909dfe-f082-41fa-9019-63f150cd1c90"),
		importTestUUID(t, "31d45421-5ba9-4c9f-b47d-8b5f992261c3")
}

func importTestPlan(t *testing.T, transcript string) importPlan {
	t.Helper()

	return importTestPlanWithName(t, "transcript.txt", transcript)
}

func importTestPlanWithName(t *testing.T, filename string, transcript string) importPlan {
	t.Helper()

	transcriptPath := filepath.Join(t.TempDir(), filename)
	if err := os.WriteFile(transcriptPath, []byte(transcript), 0600); err != nil {
		t.Fatalf("write transcript: %v", err)
	}

	return importPlan{
		path:         transcriptPath,
		patientID:    "demo-patient-001",
		encounterID:  "demo-encounter-" + filename,
		departmentID: "1",
	}
}

func assertStoredPatientID(t *testing.T, ctx context.Context, db *sql.DB, encounterID string, want string) {
	t.Helper()

	got := storedPatientID(t, ctx, db, encounterID)
	if got != want {
		t.Fatalf("stored patient_id = %q, want %q", got, want)
	}
}

func storedPatientID(t *testing.T, ctx context.Context, db *sql.DB, encounterID string) string {
	t.Helper()

	var got string
	if err := db.QueryRowContext(ctx, `SELECT patient_id FROM scribe_sessions WHERE encounter_id = ?1`, encounterID).Scan(&got); err != nil {
		t.Fatalf("query patient_id: %v", err)
	}
	return got
}

func storedCreatedAt(t *testing.T, ctx context.Context, db *sql.DB, encounterID string) time.Time {
	t.Helper()

	var raw string
	if err := db.QueryRowContext(ctx, `SELECT created_at FROM scribe_sessions WHERE encounter_id = ?1`, encounterID).Scan(&raw); err != nil {
		t.Fatalf("query created_at: %v", err)
	}

	for _, layout := range []string{time.RFC3339Nano, "2006-01-02 15:04:05-07:00", "2006-01-02 15:04:05Z07:00", "2006-01-02 15:04:05"} {
		got, err := time.Parse(layout, raw)
		if err == nil {
			return got
		}
	}
	t.Fatalf("parse created_at %q", raw)
	return time.Time{}
}

type fakeCompletionClient struct {
	text string
	err  error
}

func (f fakeCompletionClient) Complete(context.Context, string, string, int) (bedrock.CompletionResult, error) {
	if f.err != nil {
		return bedrock.CompletionResult{}, f.err
	}
	return bedrock.CompletionResult{Text: f.text}, nil
}

type fakeProcessor struct {
	patientID string
}

func (f *fakeProcessor) Process(ctx context.Context, practiceID, patientID, transcript string) (scribe.ProcessResult, error) {
	f.patientID = patientID
	return scribe.ProcessResult{Output: scribe.ScribeOutput{HPI: "ok"}}, nil
}

func TestAIOutputJSONStoresScribeOutputFieldsAtTopLevel(t *testing.T) {
	processResult := scribe.ProcessResult{
		Output: scribe.ScribeOutput{
			HPI:            "Patient feels well.",
			AssessmentPlan: "Continue current medications.",
			PhysicalExam:   "Cardiac: regular rate and rhythm.",
			DiagnosesLabs: []scribe.DiagnosisLab{
				{Diagnosis: "I10 Hypertension", Lab: "CMP"},
			},
		},
		Usage: scribe.LLMUsage{ModelID: "test-model", InputTokens: 10, OutputTokens: 20, TotalTokens: 30},
	}

	storedAIOutput, err := aiOutputJSON(processResult)
	if err != nil {
		t.Fatalf("marshal AI output: %v", err)
	}

	var stored map[string]json.RawMessage
	if err := json.Unmarshal(storedAIOutput, &stored); err != nil {
		t.Fatalf("unmarshal stored AI output: %v", err)
	}

	for _, field := range []string{"hpi", "assessment_plan", "physical_exam", "diagnoses_labs"} {
		if _, ok := stored[field]; !ok {
			t.Fatalf("expected %q at top level, got keys %v", field, stored)
		}
	}
	for _, nestedField := range []string{"Output", "Usage"} {
		if _, ok := stored[nestedField]; ok {
			t.Fatalf("did not expect %q at top level, got keys %v", nestedField, stored)
		}
	}
}
