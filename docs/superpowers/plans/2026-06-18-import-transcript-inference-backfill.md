---
status: not-started
phase: 1
updated: 2026-06-18
---

# Import Transcript Inference Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Infer clear patient names and Recorder timestamps for imported transcripts, then provide a dry-run-first backfill for copied SQLite databases.

## Architecture

Transcript import parsing lives in a focused `internal/transcriptimport` package so the import command and backfill command share the same inference and timestamp behavior. SQL updates stay narrow through sqlc queries that update only `patient_id` and `created_at`. The backfill command computes an explicit row-level plan, prints it in dry-run and apply modes, and applies only gated changes.

## Tech Stack

- Go command packages under `cmd/`.
- sqlc-generated database access in `internal/database` from `queries/scribe.sql`.
- Bedrock completion through `internal/bedrock.Client.Complete` and `bedrock.CompletionResult`.
- SQLite-backed `scribe_sessions` rows using `pgtype.UUID` and `pgtype.Timestamptz` database types.
- Go tests run with `go test` and sqlc generation with `go run github.com/sqlc-dev/sqlc/cmd/sqlc@latest generate`.

## Global Constraints

- Inference failures are non-fatal and keep placeholder/current ID.
- Backfill patient update only when `patient_id` matches `<patient-prefix>-\d{3}`.
- Backfill defaults dry-run; `-apply` required for writes.
- Timestamp uses current year and `America/Denver`; during import, Recorder timestamp shape mismatches and ordinary parse failures are non-fatal, are logged/skipped, and keep the database default `created_at`.
- Missing `America/Denver` timezone data is the only timestamp-related import error that fails loudly.
- `processor.Process` gets the same selected patient ID stored on session.
- Existing UI fallback is unchanged.
- Do not update `started_at`, `stopped_at`, `completed_at`, or any nonexistent `updated_at` field.
- Do not store source filenames; existing rows recover timestamp intent from `encounter_id` slugs.
- Do not hand-edit generated database files.

---

## Context & Decisions

| Decision | Rationale | Source |
|----------|-----------|--------|
| Put shared inference and timestamp helpers in `internal/transcriptimport` with `inference.go` and `timestamps.go`. | Import and backfill need identical first-line inference and Recorder timestamp parsing while keeping command packages small. | `ref:vague-red-marsupial` |
| Use a `CompletionClient` interface returning `bedrock.CompletionResult`. | The existing Bedrock client exposes `Complete(ctx, systemPrompt, userPrompt, maxTokens)`, and tests can stub this boundary without calling Bedrock. | `ref:vague-red-marsupial` |
| Add focused sqlc update/list queries to `queries/scribe.sql`. | Existing scribe session queries are generated from this file; narrow updates avoid broad model or schema changes. | `ref:vague-red-marsupial` |
| Modify `cmd/import-transcripts/main.go` and existing tests for import behavior. | The current import flow builds generated patient IDs, labels, encounter slugs, creates sessions, and invokes processing in this command. | `ref:vague-red-marsupial` |
| Create `cmd/backfill-imported-transcripts` as a one-off operational command. | Existing operational scripts and Makefile command patterns support command-package tools invoked with `go run ./cmd/...`. | `ref:vague-red-marsupial` |
| Keep generated code changes limited to `internal/database/scribe.sql.go` via sqlc. | The repository uses sqlc-generated database access and generated files should reflect SQL definitions exactly. | `ref:vague-red-marsupial` |

## Phase 1: Shared Helpers and Database Queries [IN PROGRESS]

### Task 1.1 Shared transcript import helpers ← CURRENT

**Files:**
- Create: `internal/transcriptimport/inference.go`
- Create: `internal/transcriptimport/timestamps.go`
- Test: `internal/transcriptimport/inference_test.go`
- Test: `internal/transcriptimport/timestamps_test.go`

**Interfaces:**

```go
var ErrRecorderTimezoneUnavailable = errors.New("recorder timezone unavailable")

type CompletionClient interface {
    Complete(ctx context.Context, systemPrompt, userPrompt string, maxTokens int) (bedrock.CompletionResult, error)
}
func FirstCleanTranscriptLine(transcript string) string
func InferPatientName(ctx context.Context, client CompletionClient, firstLine string) (string, error)
func ParseInferredPatientName(raw string) string
func ParseGoogleRecorderTimestamp(filename string, now time.Time) (time.Time, bool, error)
func ParseGoogleRecorderTimestampSlug(encounterID string, prefix string, now time.Time) (time.Time, bool, error)
```

`timestamps.go` must keep an unexported test seam for timezone loading:

```go
var loadLocation = time.LoadLocation
```

`ParseGoogleRecorderTimestamp` and `ParseGoogleRecorderTimestampSlug` must return `(time.Time{}, false, nil)` for non-matching Recorder shapes and ordinary date/time parse failures. They must return `(time.Time{}, false, fmt.Errorf("%w: America/Denver: %v", ErrRecorderTimezoneUnavailable, err))` only when loading `America/Denver` fails. Callers distinguish the fatal timezone case with `errors.Is(err, transcriptimport.ErrRecorderTimezoneUnavailable)` and must not string-match error text.

- [ ] **1.1.1 Write failing tests for first-line cleanup and inferred-name parsing**

  Add `internal/transcriptimport/inference_test.go` with table tests covering speaker-prefix stripping, JSON parsing, blank outputs, invalid JSON, uncertainty markers, and Bedrock error pass-through. Use stubs shaped like this:

  ```go
  type stubCompletionClient struct {
      result bedrock.CompletionResult
      err    error
  }

  func (s stubCompletionClient) Complete(ctx context.Context, systemPrompt, userPrompt string, maxTokens int) (bedrock.CompletionResult, error) {
      return s.result, s.err
  }

  func TestFirstCleanTranscriptLine(t *testing.T) {
      tests := []struct {
          name       string
          transcript string
          want       string
      }{
          {name: "strips speaker prefix", transcript: "\nSpeaker 1: Jane Smith is here\nSpeaker 2: hello", want: "Jane Smith is here"},
          {name: "keeps clean first line", transcript: "Jane Smith is here\nSpeaker 2: hello", want: "Jane Smith is here"},
          {name: "blank transcript", transcript: " \n\t\n", want: ""},
      }
      for _, tt := range tests {
          t.Run(tt.name, func(t *testing.T) {
              if got := FirstCleanTranscriptLine(tt.transcript); got != tt.want {
                  t.Fatalf("FirstCleanTranscriptLine() = %q, want %q", got, tt.want)
              }
          })
      }
  }

  func TestParseInferredPatientName(t *testing.T) {
      tests := []struct {
          name string
          raw  string
          want string
      }{
          {name: "clear JSON", raw: `{"patient_name":" Jane Smith "}`, want: "Jane Smith"},
          {name: "blank field", raw: `{"patient_name":""}`, want: ""},
          {name: "missing field", raw: `{"other":"Jane"}`, want: ""},
          {name: "invalid JSON", raw: `Jane Smith`, want: ""},
          {name: "uncertain output", raw: `{"patient_name":"unknown patient"}`, want: ""},
      }
      for _, tt := range tests {
          t.Run(tt.name, func(t *testing.T) {
              if got := ParseInferredPatientName(tt.raw); got != tt.want {
                  t.Fatalf("ParseInferredPatientName() = %q, want %q", got, tt.want)
              }
          })
      }
  }

  func TestInferPatientName(t *testing.T) {
      sentinel := errors.New("bedrock failed")

      t.Run("returns parsed name", func(t *testing.T) {
          got, err := InferPatientName(context.Background(), stubCompletionClient{result: bedrock.CompletionResult{Text: `{"patient_name":"Jane Smith"}`}}, "Jane Smith is here")
          if err != nil {
              t.Fatalf("InferPatientName() error = %v", err)
          }
          if got != "Jane Smith" {
              t.Fatalf("InferPatientName() = %q, want Jane Smith", got)
          }
      })

      t.Run("passes through bedrock error", func(t *testing.T) {
          got, err := InferPatientName(context.Background(), stubCompletionClient{err: sentinel}, "Jane Smith is here")
          if !errors.Is(err, sentinel) {
              t.Fatalf("InferPatientName() error = %v, want %v", err, sentinel)
          }
          if got != "" {
              t.Fatalf("InferPatientName() = %q, want blank on error", got)
          }
      })
  }
  ```

- [ ] **1.1.2 Write failing tests for Recorder timestamp parsing**

  Add `internal/transcriptimport/timestamps_test.go` with cases for filename `May 28 at 3-37 PM.txt`, slug `demo-encounter-may-28-at-3-37-pm`, non-matching names, ordinary date/time parse failures, missing `America/Denver` timezone data through the `loadLocation` seam, `America/Denver`, and the current year from the supplied `now`:

  ```go
  func TestParseGoogleRecorderTimestamp(t *testing.T) {
      now := time.Date(2026, time.June, 18, 12, 0, 0, 0, time.UTC)
      got, ok, err := ParseGoogleRecorderTimestamp("May 28 at 3-37 PM.txt", now)
      if err != nil {
          t.Fatalf("ParseGoogleRecorderTimestamp() error = %v", err)
      }
      if !ok {
          t.Fatal("ParseGoogleRecorderTimestamp() ok = false, want true")
      }
      loc, err := time.LoadLocation("America/Denver")
      if err != nil {
          t.Fatalf("load America/Denver: %v", err)
      }
      want := time.Date(2026, time.May, 28, 15, 37, 0, 0, loc)
      if !got.Equal(want) {
          t.Fatalf("ParseGoogleRecorderTimestamp() = %v, want %v", got, want)
      }
  }

  func TestParseGoogleRecorderTimestampNonMatch(t *testing.T) {
      got, ok, err := ParseGoogleRecorderTimestamp("regular-note.txt", time.Date(2026, time.June, 18, 0, 0, 0, 0, time.UTC))
      if err != nil {
          t.Fatalf("ParseGoogleRecorderTimestamp() error = %v", err)
      }
      if ok {
          t.Fatal("ParseGoogleRecorderTimestamp() ok = true, want false")
      }
      if !got.IsZero() {
          t.Fatalf("ParseGoogleRecorderTimestamp() = %v, want zero time", got)
      }
  }

  func TestParseGoogleRecorderTimestampParseFailureIsNonFatal(t *testing.T) {
      got, ok, err := ParseGoogleRecorderTimestamp("May 99 at 3-37 PM.txt", time.Date(2026, time.June, 18, 0, 0, 0, 0, time.UTC))
      if err != nil {
          t.Fatalf("ParseGoogleRecorderTimestamp() error = %v", err)
      }
      if ok {
          t.Fatal("ParseGoogleRecorderTimestamp() ok = true, want false")
      }
      if !got.IsZero() {
          t.Fatalf("ParseGoogleRecorderTimestamp() = %v, want zero time", got)
      }
  }

  func TestParseGoogleRecorderTimestampTimezoneUnavailable(t *testing.T) {
      originalLoadLocation := loadLocation
      t.Cleanup(func() { loadLocation = originalLoadLocation })
      sentinel := errors.New("tzdata missing")
      loadLocation = func(name string) (*time.Location, error) {
          if name != "America/Denver" {
              t.Fatalf("loadLocation() name = %q, want America/Denver", name)
          }
          return nil, sentinel
      }

      got, ok, err := ParseGoogleRecorderTimestamp("May 28 at 3-37 PM.txt", time.Date(2026, time.June, 18, 0, 0, 0, 0, time.UTC))
      if !errors.Is(err, ErrRecorderTimezoneUnavailable) {
          t.Fatalf("ParseGoogleRecorderTimestamp() error = %v, want ErrRecorderTimezoneUnavailable", err)
      }
      if ok {
          t.Fatal("ParseGoogleRecorderTimestamp() ok = true, want false")
      }
      if !got.IsZero() {
          t.Fatalf("ParseGoogleRecorderTimestamp() = %v, want zero time", got)
      }
  }

  func TestParseGoogleRecorderTimestampSlug(t *testing.T) {
      now := time.Date(2026, time.June, 18, 12, 0, 0, 0, time.UTC)
      got, ok, err := ParseGoogleRecorderTimestampSlug("demo-encounter-may-28-at-3-37-pm", "demo-encounter-", now)
      if err != nil {
          t.Fatalf("ParseGoogleRecorderTimestampSlug() error = %v", err)
      }
      if !ok {
          t.Fatal("ParseGoogleRecorderTimestampSlug() ok = false, want true")
      }
      loc, err := time.LoadLocation("America/Denver")
      if err != nil {
          t.Fatalf("load America/Denver: %v", err)
      }
      want := time.Date(2026, time.May, 28, 15, 37, 0, 0, loc)
      if !got.Equal(want) {
          t.Fatalf("ParseGoogleRecorderTimestampSlug() = %v, want %v", got, want)
      }
  }

  func TestParseGoogleRecorderTimestampSlugTimezoneUnavailable(t *testing.T) {
      originalLoadLocation := loadLocation
      t.Cleanup(func() { loadLocation = originalLoadLocation })
      sentinel := errors.New("tzdata missing")
      loadLocation = func(name string) (*time.Location, error) {
          if name != "America/Denver" {
              t.Fatalf("loadLocation() name = %q, want America/Denver", name)
          }
          return nil, sentinel
      }

      got, ok, err := ParseGoogleRecorderTimestampSlug("demo-encounter-may-28-at-3-37-pm", "demo-encounter-", time.Date(2026, time.June, 18, 0, 0, 0, 0, time.UTC))
      if !errors.Is(err, ErrRecorderTimezoneUnavailable) {
          t.Fatalf("ParseGoogleRecorderTimestampSlug() error = %v, want ErrRecorderTimezoneUnavailable", err)
      }
      if ok {
          t.Fatal("ParseGoogleRecorderTimestampSlug() ok = true, want false")
      }
      if !got.IsZero() {
          t.Fatalf("ParseGoogleRecorderTimestampSlug() = %v, want zero time", got)
      }
  }
  ```

- [ ] **1.1.3 Run helper tests to verify they fail**

  Run: `go test ./internal/transcriptimport`

  Expected: FAIL because `internal/transcriptimport` and its exported functions do not exist yet.

- [ ] **1.1.4 Implement minimal shared helpers**

  Create `internal/transcriptimport/inference.go` with the `CompletionClient` interface, speaker-prefix cleanup, constrained JSON prompt call, and `ParseInferredPatientName` that rejects blank, missing, invalid, and uncertain values. Create `internal/transcriptimport/timestamps.go` with Recorder filename and slug parsing that declares `ErrRecorderTimezoneUnavailable`, uses `loadLocation("America/Denver")`, uses `now.Year()`, returns `(time.Time{}, false, nil)` for non-matches and ordinary matching-shape parse failures, and returns `(time.Time{}, false, fmt.Errorf("%w: America/Denver: %v", ErrRecorderTimezoneUnavailable, err))` only when timezone loading fails.

- [ ] **1.1.5 Run helper tests to verify they pass**

  Run: `go test ./internal/transcriptimport`

  Expected: PASS for `internal/transcriptimport`.

- [ ] **1.1.6 Commit shared helpers**

  ```bash
  git add internal/transcriptimport/inference.go internal/transcriptimport/timestamps.go internal/transcriptimport/inference_test.go internal/transcriptimport/timestamps_test.go
  git commit -m "feat: add transcript import helpers"
  ```

### Task 1.2 SQL queries and generated code

**Files:**
- Modify: `queries/scribe.sql`
- Generated by sqlc: `internal/database/scribe.sql.go`

**Interfaces:**

```sql
-- name: UpdateScribeSessionPatientID :exec
UPDATE scribe_sessions
SET patient_id = ?3
WHERE id = ?1 AND tenant_id = ?2;

-- name: UpdateScribeSessionCreatedAt :exec
UPDATE scribe_sessions
SET created_at = ?3
WHERE id = ?1 AND tenant_id = ?2;

-- name: ListImportedScribeSessionBackfillCandidates :many
SELECT id, tenant_id, patient_id, encounter_id, transcript, created_at
FROM scribe_sessions
WHERE tenant_id = ?1
  AND encounter_id LIKE ?2
ORDER BY created_at ASC;
```

- [ ] **1.2.1 Write the SQL definitions**

  Append the three query definitions above to `queries/scribe.sql`. Keep positional parameters exactly as shown so generated methods accept `id`, `tenant_id`, and the replacement value in predictable order.

- [ ] **1.2.2 Add a compile reference and verify generated methods are missing**

  Before running sqlc, create a temporary compile check at `internal/database/backfill_compile_test.go`:

  ```go
  package database

  var _ = UpdateScribeSessionCreatedAtParams{}
  var _ = UpdateScribeSessionPatientIDParams{}
  var _ = ListImportedScribeSessionBackfillCandidatesParams{}
  ```

  Run: `go test ./internal/database`

  Expected: FAIL before sqlc generation with an undefined generated symbol such as `undefined: UpdateScribeSessionCreatedAtParams`. Keep `internal/database/backfill_compile_test.go` only until Step 1.2.4 passes, then delete it before committing Step 1.2.5 because real command tests compile-reference the generated methods in Phase 2.

- [ ] **1.2.3 Regenerate sqlc code**

  Run: `go run github.com/sqlc-dev/sqlc/cmd/sqlc@latest generate`

  Expected: `internal/database/scribe.sql.go` contains generated `UpdateScribeSessionPatientID`, `UpdateScribeSessionCreatedAt`, and `ListImportedScribeSessionBackfillCandidates` methods and params/row structs.

- [ ] **1.2.4 Run database tests to verify generated code**

  Run: `go test ./internal/database`

  Expected: PASS for `internal/database`.

- [ ] **1.2.5 Commit SQL and generated code**

  ```bash
  git add queries/scribe.sql internal/database/scribe.sql.go
  git commit -m "feat: add scribe session backfill queries"
  ```

## Phase 2: Import Integration, Backfill Command, and Verification [PENDING]

### Task 2.1 Import integration

**Files:**
- Modify: `cmd/import-transcripts/main.go`
- Modify: `cmd/import-transcripts/main_test.go`

**Interfaces:**
- Consumes: `transcriptimport.FirstCleanTranscriptLine`, `transcriptimport.InferPatientName`, `transcriptimport.ParseGoogleRecorderTimestamp`, `transcriptimport.ErrRecorderTimezoneUnavailable`, and `database.UpdateScribeSessionCreatedAt` generated in Phase 1.
- Produces: import-created sessions whose stored `patient_id` and processor patient ID are the same selected value.

Expand the existing import command options struct so tests and CLI construction share explicit inference and timestamp parser seams:

```go
type options struct {
    input, tenantName, userEmail, patientPrefix, departmentID string
    process, overwrite, dryRun bool
    timeout time.Duration
    inferenceClient transcriptimport.CompletionClient
    parseRecorderTimestamp func(filename string, now time.Time) (time.Time, bool, error)
}
```

`main` constructs the real Bedrock client and sets `opts.inferenceClient` for normal CLI runs. `main` also sets `opts.parseRecorderTimestamp = transcriptimport.ParseGoogleRecorderTimestamp`; tests can replace this seam with a function that returns `fmt.Errorf("%w: America/Denver: %v", transcriptimport.ErrRecorderTimezoneUnavailable, sentinel)` to exercise fatal timezone handling without mutating helper package state. Tests set `opts.inferenceClient` to a fake `transcriptimport.CompletionClient`. `importOne` continues to accept the expanded `options` struct, uses `opts.inferenceClient` for inference, skips inference when `opts.inferenceClient == nil`, keeping the generated placeholder patient ID, and defaults `opts.parseRecorderTimestamp` to `transcriptimport.ParseGoogleRecorderTimestamp` when the seam is nil.

- [ ] **2.1.1 Write failing tests for inferred patient IDs and non-fatal inference**

  In `cmd/import-transcripts/main_test.go`, add import-command tests that set `opts.inferenceClient` to a fake `transcriptimport.CompletionClient` and assert a clear LLM response stores the inferred name in `CreateScribeSessionParams.PatientID`, blank inference keeps the generated placeholder, and Bedrock errors keep the generated placeholder without failing the import. Add a nil-client case where `opts.inferenceClient == nil`, `importOne` does not attempt inference, and the generated placeholder remains selected.

- [ ] **2.1.2 Write failing tests for import timestamp behavior**

  In `cmd/import-transcripts/main_test.go`, add tests that import a file named `May 28 at 3-37 PM.txt` with `now` fixed to 2026 and assert `created_at` is updated to `2026-05-28 15:37:00 America/Denver`. Add invalid and non-matching filename cases that assert ordinary Recorder parse failures and shape mismatches are logged/skipped, do not fail import, do not call `UpdateScribeSessionCreatedAt`, and leave the database default `created_at` unchanged. Add a missing-timezone case by setting `opts.parseRecorderTimestamp` to return `time.Time{}, false, fmt.Errorf("%w: America/Denver: %v", transcriptimport.ErrRecorderTimezoneUnavailable, sentinel)`. Assert import returns a clear fatal error when `errors.Is(err, transcriptimport.ErrRecorderTimezoneUnavailable)` is true, and do not assert by matching the error string.

- [ ] **2.1.3 Write failing regression test for processor patient ID alignment and existing label behavior**

  Extend the processor stub in `cmd/import-transcripts/main_test.go` so it records the patient ID passed to `processor.Process(ctx, cfg.AthenaPracticeID, selectedPatientID, transcript)`. Assert it equals the session's stored selected patient ID. Keep the existing label assertions from `TestImportOneStoresDerivedLabel` so `label || patient_id` fallback behavior remains preserved.

- [ ] **2.1.4 Run import tests to verify they fail**

  Run: `go test ./cmd/import-transcripts`

  Expected: FAIL because import does not yet call `transcriptimport` helpers, does not update `created_at`, and still passes the generated placeholder to the processor.

- [ ] **2.1.5 Implement minimal import integration**

  Modify `cmd/import-transcripts/main.go` so the existing options struct matches the interface block above, `main` constructs a Bedrock client, assigns it to `opts.inferenceClient`, sets `opts.parseRecorderTimestamp = transcriptimport.ParseGoogleRecorderTimestamp`, and tests can pass fake seams through the same fields. `importOne` reads the transcript, calls `transcriptimport.FirstCleanTranscriptLine`, calls `transcriptimport.InferPatientName` only when `opts.inferenceClient != nil`, selects the inferred name when non-blank, and keeps the generated placeholder when `opts.inferenceClient == nil`, inference is blank, or inference returns an error. Use the selected patient ID for both `CreateScribeSessionParams.PatientID` and `processor.Process(ctx, cfg.AthenaPracticeID, selectedPatientID, transcript)`. After creation, call `opts.parseRecorderTimestamp` or default to `transcriptimport.ParseGoogleRecorderTimestamp` when nil; if `errors.Is(err, transcriptimport.ErrRecorderTimezoneUnavailable)` is true, return a clear fatal error. If `err == nil && ok == false`, log/skip and keep the database default `created_at`. If `err == nil && ok == true`, call `UpdateScribeSessionCreatedAt`. Do not string-match timestamp errors.

- [ ] **2.1.6 Run import tests to verify they pass**

  Run: `go test ./cmd/import-transcripts`

  Expected: PASS for `cmd/import-transcripts`.

- [ ] **2.1.7 Commit import integration**

  ```bash
  git add cmd/import-transcripts/main.go cmd/import-transcripts/main_test.go
  git commit -m "feat: infer imported transcript patient data"
  ```

### Task 2.2 Backfill command

**Files:**
- Create: `cmd/backfill-imported-transcripts/main.go`
- Create: `cmd/backfill-imported-transcripts/main_test.go`

**Interfaces:**

```go
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
func buildBackfillPlan(ctx context.Context, client transcriptimport.CompletionClient, row database.ListImportedScribeSessionBackfillCandidatesRow, opts options, now time.Time) backfillPlan
func isGeneratedPatientID(patientID, prefix string) bool
func applyBackfillPlan(ctx context.Context, queries *database.Queries, plan backfillPlan) error
func printBackfillPlan(w io.Writer, plan backfillPlan)
func resolveTenantID(ctx context.Context, db *sql.DB, tenantName string) (pgtype.UUID, error)
```

- [ ] **2.2.1 Write failing tests for placeholder detection and plan construction**

  Create `cmd/backfill-imported-transcripts/main_test.go` with tests asserting `isGeneratedPatientID("demo-patient-001", "demo-patient") == true`, `isGeneratedPatientID("demo-patient-1", "demo-patient") == false`, and `isGeneratedPatientID("Jane Smith", "demo-patient") == false`. Include a regex-sensitive prefix case that proves `patientPrefix` is escaped before constructing the regexp:

  ```go
  func TestIsGeneratedPatientIDEscapesPrefix(t *testing.T) {
      if !isGeneratedPatientID("demo.patient-001", "demo.patient") {
          t.Fatal("isGeneratedPatientID() = false, want true for literal dotted prefix")
      }
      if isGeneratedPatientID("demoxpatient-001", "demo.patient") {
          t.Fatal("isGeneratedPatientID() = true, want false when dot would only match as regexp wildcard")
      }
  }
  ```

  Add `buildBackfillPlan` tests where a clear inference updates generated placeholders, uncertain LLM output leaves `NewPatientID == OldPatientID`, and invalid timestamp slugs leave `NewCreatedAt == OldCreatedAt` with a non-empty `SkipReason`.

- [ ] **2.2.2 Write failing tests for dry-run output and apply gating**

  In `cmd/backfill-imported-transcripts/main_test.go`, add tests for `printBackfillPlan` that assert output includes the session ID, old/new patient IDs, old/new `created_at`, and skip reason. Add apply-mode tests with a transaction-backed SQLite test database showing dry-run does not call update queries and `-apply` calls only the updates where `UpdatePatientID` or `UpdateCreatedAt` are true.

- [ ] **2.2.3 Write failing tests for tenant resolution and database write error context**

  Add tests for `resolveTenantID(ctx, db, tenantName)` using a test database with a `tenants` row. Assert a known tenant name returns the row's `id` as `pgtype.UUID`. Assert a missing tenant returns an error that includes the missing tenant name, fails before candidate listing, and does not silently use a zero UUID. Add a test where `applyBackfillPlan` receives a plan with `UpdatePatientID == true` and a query path that returns an error. Assert the returned error includes the failing session ID so apply mode stops with session context.

- [ ] **2.2.4 Run backfill command tests to verify they fail**

  Run: `go test ./cmd/backfill-imported-transcripts`

  Expected: FAIL because `cmd/backfill-imported-transcripts` and its functions do not exist yet.

- [ ] **2.2.5 Implement minimal backfill command**

  Create `cmd/backfill-imported-transcripts/main.go` with flags `-database` defaulting to `DATABASE_URL`, `-tenant` defaulting to `Janus Healthcare`, `-patient-prefix` defaulting to `demo-patient`, `-encounter-prefix` defaulting to `demo-encounter-`, `-apply` defaulting to `false`, and `-timeout`. Add `resolveTenantID(ctx context.Context, db *sql.DB, tenantName string) (pgtype.UUID, error)` using direct SQL against `tenants` by name, matching the existing import command's `resolveTenantUser` fail-fast pattern where applicable:

  ```go
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
  ```

  In `main`, open the database, call `tenantID, err := resolveTenantID(ctx, db, opts.tenantName)`, return the error before listing candidates when resolution fails, then pass the resolved `tenantID` to `ListImportedScribeSessionBackfillCandidates(ctx, database.ListImportedScribeSessionBackfillCandidatesParams{TenantID: tenantID, EncounterID: opts.encounterPrefix + "%"})`. Build plans with shared transcriptimport helpers, always print each row, and call `applyBackfillPlan` only when `opts.apply` is true. Implement `isGeneratedPatientID` with `regexp.QuoteMeta(opts.patientPrefix)` before constructing the `^<prefix>-\d{3}$` regexp so prefixes like `demo.patient` are matched literally. Keep LLM failures non-fatal in plan construction by leaving patient ID unchanged and recording a skip reason.

- [ ] **2.2.6 Run backfill command tests to verify they pass**

  Run: `go test ./cmd/backfill-imported-transcripts`

  Expected: PASS for `cmd/backfill-imported-transcripts`.

- [ ] **2.2.7 Commit backfill command**

  ```bash
  git add cmd/backfill-imported-transcripts/main.go cmd/backfill-imported-transcripts/main_test.go
  git commit -m "feat: add imported transcript backfill command"
  ```

### Task 2.3 Makefile and final verification

**Files:**
- Modify: `Makefile`

**Interfaces:**

```make
backfill-imported-transcripts:
	go run ./cmd/backfill-imported-transcripts $(ARGS)
```

- [ ] **2.3.1 Write the failing command-target check**

  Run: `make backfill-imported-transcripts ARGS="-h"`

  Expected: FAIL because the `backfill-imported-transcripts` target does not exist yet.

- [ ] **2.3.2 Add the Makefile target**

  Modify `Makefile` to include exactly:

  ```make
  backfill-imported-transcripts:
	go run ./cmd/backfill-imported-transcripts $(ARGS)
  ```

- [ ] **2.3.3 Run the command-target check to verify it passes**

  Run: `make backfill-imported-transcripts ARGS="-h"`

  Expected: PASS with the backfill command help text and flags `-database`, `-tenant`, `-patient-prefix`, `-encounter-prefix`, `-apply`, and `-timeout` visible.

- [ ] **2.3.4 Run full Go verification**

  Run: `go test ./...`

  Expected: PASS for all Go packages.

- [ ] **2.3.5 Run project test target when available**

  Run: `make test`

  Expected: PASS if the target exists. If `make` reports no `test` target, record that the target is unavailable and keep `go test ./...` as the completed verification.

- [ ] **2.3.6 Self-review before final implementation commit**

  Review the approved spec and this plan's implemented diff with three checks: every goal and non-goal maps to a code path or test, no implementation comments or docs contain unfinished marker text, and function signatures match the exact interfaces listed in Tasks 1.1 and 2.2.

- [ ] **2.3.7 Commit Makefile and verification cleanup**

  ```bash
  git add Makefile
  git commit -m "chore: add imported transcript backfill target"
  ```

## SDD ledger

- 2026-06-18 Task 2.1 review fix: added invalid matching-shape Recorder filename coverage for `May 99 at 3-37 PM.txt`; verified `go test -count=1 ./cmd/import-transcripts` passes.
