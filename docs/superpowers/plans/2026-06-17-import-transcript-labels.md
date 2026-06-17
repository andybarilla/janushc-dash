# Import Transcript Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create imported scribe sessions with a label derived from the first usable transcript dialog line.

**Architecture:** Keep the change local to the `import-transcripts` command. Add one pure helper that parses transcript text into a label, cover it with focused unit tests, then pass the derived label into the existing `database.CreateScribeSessionParams` call in `importOne`.

**Tech Stack:** Go, standard library `regexp` and `strings`, existing sqlc-generated `internal/database` package, `go test` through `mise exec`.

## Global Constraints

- Modify `cmd/import-transcripts/main.go` only for production code.
- Modify `cmd/import-transcripts/main_test.go` only for tests.
- Add helper `labelFromFirstDialog(transcript string) string` in `cmd/import-transcripts/main.go`.
- Split transcript into lines; scan in order; for each line strip speaker prefix matching `Speaker <number>:` with surrounding whitespace; trim whitespace plus leading/trailing quote punctuation only (`"`, `'`, `“`, `”`, `‘`, `’`); return first non-empty cleaned line; return empty string if none.
- Pass derived label into existing `database.CreateScribeSessionParams{Label: label}` in `importOne` before create.
- Leave `batch-transcribe-recordings`, recorder apps, schema/sqlc, UI, and flags unchanged.
- Empty transcript files keep the current `empty transcript` failure.
- Use `mise exec -- go test ./cmd/import-transcripts` for importer package verification.

---

## File Structure

- `cmd/import-transcripts/main.go`: Add the pure `labelFromFirstDialog(transcript string) string` helper, add its speaker-prefix regexp, and pass the helper result into `database.CreateScribeSessionParams.Label` inside `importOne`.
- `cmd/import-transcripts/main_test.go`: Add table-driven unit coverage for label extraction edge cases beside the existing `aiOutputJSON` test.

### Task 1: Add failing label extraction tests

**Files:**
- Modify: `cmd/import-transcripts/main_test.go:10-43`
- Test: `cmd/import-transcripts/main_test.go`

**Interfaces:**
- Consumes: `labelFromFirstDialog(transcript string) string` from `cmd/import-transcripts/main.go` once Task 2 implements it.
- Produces: `TestLabelFromFirstDialog` with the expected behavior contract for Task 2.

- [ ] **Step 1: Insert the failing table-driven test before `TestAIOutputJSONStoresScribeOutputFieldsAtTopLevel`**

Add this function after the import block in `cmd/import-transcripts/main_test.go`:

```go
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
```

- [ ] **Step 2: Run the focused tests to verify they fail for the missing helper**

Run:

```bash
mise exec -- go test ./cmd/import-transcripts -run TestLabelFromFirstDialog -count=1
```

Expected: FAIL with a compile error containing `undefined: labelFromFirstDialog`.

- [ ] **Step 3: Commit the failing tests**

Run:

```bash
git add cmd/import-transcripts/main_test.go
git commit -m "test: cover transcript import labels"
```

Expected: Commit succeeds with only `cmd/import-transcripts/main_test.go` staged.

### Task 2: Implement label extraction helper

**Files:**
- Modify: `cmd/import-transcripts/main.go:138-168`
- Test: `cmd/import-transcripts/main_test.go`

**Interfaces:**
- Consumes: `TestLabelFromFirstDialog` from Task 1.
- Produces: `labelFromFirstDialog(transcript string) string`, a pure helper that returns the first usable cleaned transcript line or `""`.

- [ ] **Step 1: Add the speaker-prefix regexp near the existing package-level regexp**

In `cmd/import-transcripts/main.go`, replace the single package-level variable at line 281:

```go
var nonSlugChars = regexp.MustCompile(`[^a-z0-9]+`)
```

with:

```go
var (
	speakerPrefix = regexp.MustCompile(`^\s*Speaker\s+\d+\s*:`)
	nonSlugChars  = regexp.MustCompile(`[^a-z0-9]+`)
)
```

- [ ] **Step 2: Add the helper after `importOne` and before `aiOutputJSON`**

Insert this code in `cmd/import-transcripts/main.go` after the closing brace of `importOne` at line 210:

```go
func labelFromFirstDialog(transcript string) string {
	for _, line := range strings.Split(transcript, "\n") {
		withoutSpeaker := speakerPrefix.ReplaceAllString(line, "")
		label := strings.Trim(strings.TrimSpace(withoutSpeaker), " \t\n\r\"'“”‘’")
		if label == "" {
			continue
		}

		return label
	}

	return ""
}
```

- [ ] **Step 3: Run the focused helper tests to verify the helper passes**

Run:

```bash
mise exec -- go test ./cmd/import-transcripts -run TestLabelFromFirstDialog -count=1
```

Expected: PASS for `TestLabelFromFirstDialog`.

- [ ] **Step 4: Commit the helper implementation**

Run:

```bash
git add cmd/import-transcripts/main.go
git commit -m "feat: derive labels from transcript dialog"
```

Expected: Commit succeeds with only `cmd/import-transcripts/main.go` staged.

### Task 3: Pass the derived label into session creation

**Files:**
- Modify: `cmd/import-transcripts/main.go:138-168`
- Test: `cmd/import-transcripts/main_test.go`

**Interfaces:**
- Consumes: `labelFromFirstDialog(transcript string) string` from Task 2.
- Produces: `importOne` assigns `Label: label` in `database.CreateScribeSessionParams` while preserving existing patient, encounter, department, transcript storage, overwrite, dry-run, and AI processing behavior.

- [ ] **Step 1: Extend test imports for an `importOne` storage test**

Replace the import block in `cmd/import-transcripts/main_test.go` with:

```go
import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/sqlite3"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgtype"
	_ "github.com/mattn/go-sqlite3"

	"github.com/andybarilla/janushc-dash/internal/config"
	"github.com/andybarilla/janushc-dash/internal/database"
	"github.com/andybarilla/janushc-dash/internal/scribe"
)
```

- [ ] **Step 2: Add the failing `importOne` label storage test and helpers**

Add this code after `TestLabelFromFirstDialog` and before `TestAIOutputJSONStoresScribeOutputFieldsAtTopLevel` in `cmd/import-transcripts/main_test.go`:

```go
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
```

- [ ] **Step 3: Run the focused storage test to verify it fails before wiring**

Run:

```bash
mise exec -- go test ./cmd/import-transcripts -run TestImportOneStoresDerivedLabel -count=1
```

Expected: FAIL with `stored label = "", want "Jane Smith"`.

- [ ] **Step 4: Derive the label after the empty transcript guard**

In `cmd/import-transcripts/main.go`, update `importOne` after line 146 from:

```go
	if transcript == "" {
		return errors.New("empty transcript")
	}

	existingID, err := existingSessionID(parent, db, tenantID, plan.encounterID)
```

to:

```go
	if transcript == "" {
		return errors.New("empty transcript")
	}
	label := labelFromFirstDialog(transcript)

	existingID, err := existingSessionID(parent, db, tenantID, plan.encounterID)
```

- [ ] **Step 5: Pass `Label: label` into `CreateScribeSessionParams`**

In `cmd/import-transcripts/main.go`, update the struct literal at lines 162-168 from:

```go
	session, err := queries.CreateScribeSession(parent, database.CreateScribeSessionParams{
		TenantID:     tenantID,
		UserID:       userID,
		PatientID:    plan.patientID,
		EncounterID:  plan.encounterID,
		DepartmentID: plan.departmentID,
	})
```

to:

```go
	session, err := queries.CreateScribeSession(parent, database.CreateScribeSessionParams{
		TenantID:     tenantID,
		UserID:       userID,
		PatientID:    plan.patientID,
		EncounterID:  plan.encounterID,
		DepartmentID: plan.departmentID,
		Label:        label,
	})
```

- [ ] **Step 6: Run the focused storage test to verify it passes**

Run:

```bash
mise exec -- go test ./cmd/import-transcripts -run TestImportOneStoresDerivedLabel -count=1
```

Expected: PASS for `TestImportOneStoresDerivedLabel`.

- [ ] **Step 7: Run the importer package tests**

Run:

```bash
mise exec -- go test ./cmd/import-transcripts
```

Expected: PASS for all tests in `./cmd/import-transcripts`.

- [ ] **Step 8: Commit the import wiring**

Run:

```bash
git add cmd/import-transcripts/main.go cmd/import-transcripts/main_test.go
git commit -m "feat: label imported scribe sessions"
```

Expected: Commit succeeds with only `cmd/import-transcripts/main.go` and `cmd/import-transcripts/main_test.go` staged.

### Task 4: Final verification and review

**Files:**
- Verify: `cmd/import-transcripts/main.go`
- Verify: `cmd/import-transcripts/main_test.go`

**Interfaces:**
- Consumes: Completed Tasks 1-3.
- Produces: Verified implementation ready for human review.

- [ ] **Step 1: Run gofmt on touched Go files**

Run:

```bash
mise exec -- gofmt -w cmd/import-transcripts/main.go cmd/import-transcripts/main_test.go
```

Expected: Command exits 0 and formats only the two touched Go files.

- [ ] **Step 2: Run final importer package verification**

Run:

```bash
mise exec -- go test ./cmd/import-transcripts
```

Expected: PASS for all tests in `./cmd/import-transcripts`.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git diff -- cmd/import-transcripts/main.go cmd/import-transcripts/main_test.go
```

Expected: Diff shows only `labelFromFirstDialog`, the speaker-prefix regexp, `Label: label` wiring in `importOne`, and the label extraction tests.

- [ ] **Step 4: Commit final formatting if needed**

Run:

```bash
git status --short
git add cmd/import-transcripts/main.go cmd/import-transcripts/main_test.go
git commit -m "chore: format transcript label import"
```

Expected: If `git status --short` shows no Go file changes after Step 1, skip this commit. If formatting changed files, commit succeeds with only the two touched Go files staged.

## Self-Review

- Spec coverage: Covered helper creation, line splitting, ordered scan, speaker-prefix stripping, quote-only trim set, first non-empty return, empty fallback, `CreateScribeSessionParams.Label` wiring, unchanged out-of-scope systems, empty transcript behavior, and all requested tests.
- Forbidden placeholder scan: No forbidden placeholder language, vague edge handling, or references to undefined post-plan interfaces remain.
- Type consistency: `labelFromFirstDialog(transcript string) string`, `speakerPrefix`, `database.CreateScribeSessionParams.Label`, and all command lines match the existing Go package style and generated sqlc fields.
