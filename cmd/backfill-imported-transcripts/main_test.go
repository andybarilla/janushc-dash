package main

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgtype"
	_ "github.com/mattn/go-sqlite3"

	"github.com/andybarilla/janushc-dash/internal/bedrock"
	"github.com/andybarilla/janushc-dash/internal/database"
	"github.com/andybarilla/janushc-dash/internal/transcriptimport"
)

func TestIsGeneratedPatientID(t *testing.T) {
	t.Parallel()

	tests := []struct {
		patientID string
		prefix    string
		want      bool
	}{
		{patientID: "demo-patient-001", prefix: "demo-patient", want: true},
		{patientID: "demo-patient-1", prefix: "demo-patient", want: false},
		{patientID: "Jane Smith", prefix: "demo-patient", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.patientID, func(t *testing.T) {
			t.Parallel()

			if got := isGeneratedPatientID(tt.patientID, tt.prefix); got != tt.want {
				t.Fatalf("isGeneratedPatientID(%q, %q) = %v, want %v", tt.patientID, tt.prefix, got, tt.want)
			}
		})
	}
}

func TestIsGeneratedPatientIDEscapesPrefix(t *testing.T) {
	t.Parallel()

	if !isGeneratedPatientID("demo.patient-001", "demo.patient") {
		t.Fatal("isGeneratedPatientID() = false, want true for literal dotted prefix")
	}
	if isGeneratedPatientID("demoxpatient-001", "demo.patient") {
		t.Fatal("isGeneratedPatientID() = true, want false when dot would only match as regexp wildcard")
	}
}

func TestBuildBackfillPlan(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.June, 18, 12, 0, 0, 0, time.UTC)
	oldCreatedAt := testTimestamp(time.Date(2026, time.June, 1, 9, 0, 0, 0, time.UTC))
	sessionID := testUUID(t, "11111111-1111-1111-1111-111111111111")
	tenantID := testUUID(t, "22222222-2222-2222-2222-222222222222")

	tests := []struct {
		name              string
		row               database.ListImportedScribeSessionBackfillCandidatesRow
		client            fakeCompletionClient
		wantPatientID     string
		wantPatientUpdate bool
		wantCreatedAtSame bool
		wantSkipReason    bool
	}{
		{
			name:              "clear inference updates generated placeholder and timestamp",
			row:               testBackfillRow(sessionID, tenantID, "demo-patient-001", "demo-encounter-may-28-at-3-37-pm", "Speaker 0: Jane Smith is here", oldCreatedAt),
			client:            fakeCompletionClient{text: `{"patient_name":"Jane Smith"}`},
			wantPatientID:     "Jane Smith",
			wantPatientUpdate: true,
		},
		{
			name:           "uncertain output leaves patient unchanged",
			row:            testBackfillRow(sessionID, tenantID, "demo-patient-001", "demo-encounter-may-28-at-3-37-pm", "Speaker 0: Unknown patient", oldCreatedAt),
			client:         fakeCompletionClient{text: `{"patient_name":"unknown patient"}`},
			wantPatientID:  "demo-patient-001",
			wantSkipReason: true,
		},
		{
			name:           "non-generated patient stays unchanged",
			row:            testBackfillRow(sessionID, tenantID, "Existing Patient", "demo-encounter-may-28-at-3-37-pm", "Speaker 0: Jane Smith is here", oldCreatedAt),
			client:         fakeCompletionClient{text: `{"patient_name":"Jane Smith"}`},
			wantPatientID:  "Existing Patient",
			wantSkipReason: true,
		},
		{
			name:              "invalid timestamp slug leaves created at unchanged",
			row:               testBackfillRow(sessionID, tenantID, "demo-patient-001", "demo-encounter-may-99-at-3-37-pm", "Speaker 0: Jane Smith is here", oldCreatedAt),
			client:            fakeCompletionClient{text: `{"patient_name":"Jane Smith"}`},
			wantPatientID:     "Jane Smith",
			wantPatientUpdate: true,
			wantCreatedAtSame: true,
			wantSkipReason:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			plan, err := buildBackfillPlan(context.Background(), tt.client, tt.row, options{patientPrefix: "demo-patient", encounterPrefix: "demo-encounter-"}, now)
			if err != nil {
				t.Fatalf("buildBackfillPlan() error = %v", err)
			}
			if plan.NewPatientID != tt.wantPatientID {
				t.Fatalf("NewPatientID = %q, want %q", plan.NewPatientID, tt.wantPatientID)
			}
			if plan.UpdatePatientID != tt.wantPatientUpdate {
				t.Fatalf("UpdatePatientID = %v, want %v", plan.UpdatePatientID, tt.wantPatientUpdate)
			}
			if tt.wantCreatedAtSame && !plan.NewCreatedAt.Time.Equal(oldCreatedAt.Time) {
				t.Fatalf("NewCreatedAt = %v, want unchanged %v", plan.NewCreatedAt.Time, oldCreatedAt.Time)
			}
			if tt.wantSkipReason && plan.SkipReason == "" {
				t.Fatal("SkipReason = blank, want non-empty")
			}
		})
	}
}

func TestBuildBackfillPlanFailsWhenRecorderTimezoneUnavailable(t *testing.T) {
	originalParser := parseGoogleRecorderTimestampSlug
	t.Cleanup(func() { parseGoogleRecorderTimestampSlug = originalParser })
	parseGoogleRecorderTimestampSlug = func(string, string, time.Time) (time.Time, bool, error) {
		return time.Time{}, false, fmt.Errorf("wrapped: %w", transcriptimport.ErrRecorderTimezoneUnavailable)
	}

	sessionID := testUUID(t, "11111111-1111-1111-1111-111111111111")
	tenantID := testUUID(t, "22222222-2222-2222-2222-222222222222")
	row := testBackfillRow(sessionID, tenantID, "demo-patient-001", "demo-encounter-may-28-at-3-37-pm", "Speaker 0: Jane Smith is here", testTimestamp(time.Date(2026, time.June, 1, 9, 0, 0, 0, time.UTC)))

	plan, err := buildBackfillPlan(context.Background(), fakeCompletionClient{text: `{"patient_name":"Jane Smith"}`}, row, options{patientPrefix: "demo-patient", encounterPrefix: "demo-encounter-"}, time.Date(2026, time.June, 18, 12, 0, 0, 0, time.UTC))
	if !errors.Is(err, transcriptimport.ErrRecorderTimezoneUnavailable) {
		t.Fatalf("buildBackfillPlan() error = %v, want ErrRecorderTimezoneUnavailable", err)
	}
	if plan.SkipReason != "" {
		t.Fatalf("SkipReason = %q, want blank because timezone failure is fatal", plan.SkipReason)
	}
}

func TestPrintBackfillPlan(t *testing.T) {
	t.Parallel()

	plan := backfillPlan{
		SessionID:    testUUID(t, "11111111-1111-1111-1111-111111111111"),
		OldPatientID: "demo-patient-001",
		NewPatientID: "Jane Smith",
		OldCreatedAt: testTimestamp(time.Date(2026, time.June, 1, 9, 0, 0, 0, time.UTC)),
		NewCreatedAt: testTimestamp(time.Date(2026, time.May, 28, 21, 37, 0, 0, time.UTC)),
		SkipReason:   "invalid timestamp slug",
	}

	var output bytes.Buffer
	printBackfillPlan(&output, plan)
	got := output.String()

	for _, want := range []string{
		"11111111-1111-1111-1111-111111111111",
		"demo-patient-001",
		"Jane Smith",
		"2026-06-01",
		"2026-05-28",
		"invalid timestamp slug",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("printBackfillPlan() output %q does not contain %q", got, want)
		}
	}
}

func TestApplyBackfillPlanUpdatesOnlyProposedDifferences(t *testing.T) {
	ctx := context.Background()
	db := openBackfillTestDB(t, ctx)
	defer db.Close()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin transaction: %v", err)
	}
	defer tx.Rollback()

	queries := database.New(tx)
	tenantID := testUUID(t, "22222222-2222-2222-2222-222222222222")
	sessionID := testUUID(t, "11111111-1111-1111-1111-111111111111")
	seedBackfillSession(t, ctx, tx, sessionID, tenantID, "demo-patient-001", "2026-06-01 09:00:00")

	dryRunPlan := backfillPlan{SessionID: sessionID, TenantID: tenantID, NewPatientID: "Jane Smith", NewCreatedAt: testTimestamp(time.Date(2026, time.May, 28, 15, 37, 0, 0, time.UTC))}
	if err := applyBackfillPlan(ctx, queries, dryRunPlan); err != nil {
		t.Fatalf("applyBackfillPlan dry-run-equivalent flags: %v", err)
	}
	assertBackfillSession(t, ctx, tx, sessionID, "demo-patient-001", "2026-06-01")

	applyPlan := dryRunPlan
	applyPlan.UpdatePatientID = true
	if err := applyBackfillPlan(ctx, queries, applyPlan); err != nil {
		t.Fatalf("applyBackfillPlan patient: %v", err)
	}
	assertBackfillSession(t, ctx, tx, sessionID, "Jane Smith", "2026-06-01")

	applyPlan.UpdatePatientID = false
	applyPlan.UpdateCreatedAt = true
	if err := applyBackfillPlan(ctx, queries, applyPlan); err != nil {
		t.Fatalf("applyBackfillPlan created_at: %v", err)
	}
	assertBackfillSession(t, ctx, tx, sessionID, "Jane Smith", "2026-05-28")
}

func TestResolveTenantID(t *testing.T) {
	ctx := context.Background()
	db := openBackfillTestDB(t, ctx)
	defer db.Close()
	want := testUUID(t, "22222222-2222-2222-2222-222222222222")

	if _, err := db.ExecContext(ctx, `INSERT INTO tenants (id, name) VALUES (?1, ?2)`, want, "Known Tenant"); err != nil {
		t.Fatalf("seed tenant: %v", err)
	}

	got, err := resolveTenantID(ctx, db, "Known Tenant")
	if err != nil {
		t.Fatalf("resolveTenantID known: %v", err)
	}
	if got != want {
		t.Fatalf("resolveTenantID() = %v, want %v", got, want)
	}

	missing := "Missing Tenant"
	got, err = resolveTenantID(ctx, db, missing)
	if err == nil {
		t.Fatal("resolveTenantID missing error = nil, want error")
	}
	if !strings.Contains(err.Error(), missing) {
		t.Fatalf("resolveTenantID missing error = %v, want tenant name", err)
	}
	if got.Valid {
		t.Fatalf("resolveTenantID missing returned valid UUID %v, want zero", got)
	}
}

func TestApplyBackfillPlanErrorIncludesSessionID(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer db.Close()

	sessionID := testUUID(t, "11111111-1111-1111-1111-111111111111")
	plan := backfillPlan{
		SessionID:       sessionID,
		TenantID:        testUUID(t, "22222222-2222-2222-2222-222222222222"),
		NewPatientID:    "Jane Smith",
		UpdatePatientID: true,
	}

	err = applyBackfillPlan(ctx, database.New(db), plan)
	if err == nil {
		t.Fatal("applyBackfillPlan error = nil, want error")
	}
	if !strings.Contains(err.Error(), sessionID.String()) {
		t.Fatalf("applyBackfillPlan error = %v, want session ID %s", err, sessionID.String())
	}
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

func testBackfillRow(sessionID, tenantID pgtype.UUID, patientID, encounterID, transcript string, createdAt pgtype.Timestamptz) database.ListImportedScribeSessionBackfillCandidatesRow {
	return database.ListImportedScribeSessionBackfillCandidatesRow{
		ID:          sessionID,
		TenantID:    tenantID,
		PatientID:   patientID,
		EncounterID: encounterID,
		Transcript:  pgtype.Text{String: transcript, Valid: true},
		CreatedAt:   createdAt,
	}
}

func testUUID(t *testing.T, value string) pgtype.UUID {
	t.Helper()

	var id pgtype.UUID
	if err := id.Scan(value); err != nil {
		t.Fatalf("scan uuid %q: %v", value, err)
	}
	return id
}

func testTimestamp(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: value, Valid: true}
}

func openBackfillTestDB(t *testing.T, ctx context.Context) *sql.DB {
	t.Helper()

	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		CREATE TABLE tenants (id UUID PRIMARY KEY, name TEXT NOT NULL UNIQUE);
		CREATE TABLE scribe_sessions (
			id UUID PRIMARY KEY,
			tenant_id UUID NOT NULL,
			patient_id TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL
		);
	`)
	if err != nil {
		db.Close()
		t.Fatalf("create schema: %v", err)
	}
	return db
}

func seedBackfillSession(t *testing.T, ctx context.Context, tx *sql.Tx, sessionID, tenantID pgtype.UUID, patientID, createdAt string) {
	t.Helper()

	_, err := tx.ExecContext(ctx, `INSERT INTO scribe_sessions (id, tenant_id, patient_id, created_at) VALUES (?1, ?2, ?3, ?4)`, sessionID, tenantID, patientID, createdAt)
	if err != nil {
		t.Fatalf("seed scribe session: %v", err)
	}
}

func assertBackfillSession(t *testing.T, ctx context.Context, tx *sql.Tx, sessionID pgtype.UUID, wantPatientID, wantCreatedAtDate string) {
	t.Helper()

	var gotPatientID string
	var gotCreatedAt string
	if err := tx.QueryRowContext(ctx, `SELECT patient_id, created_at FROM scribe_sessions WHERE id = ?1`, sessionID).Scan(&gotPatientID, &gotCreatedAt); err != nil {
		t.Fatalf("query scribe session: %v", err)
	}
	if gotPatientID != wantPatientID {
		t.Fatalf("patient_id = %q, want %q", gotPatientID, wantPatientID)
	}
	if !strings.Contains(gotCreatedAt, wantCreatedAtDate) {
		t.Fatalf("created_at = %q, want date containing %q", gotCreatedAt, wantCreatedAtDate)
	}
}
