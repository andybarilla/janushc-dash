# Import transcript patient inference and timestamp backfill

## Problem

Imported Google Recorder transcripts currently get generated placeholder
`scribe_sessions.patient_id` values. The dashboard can display
`label || patient_id`, but that only changes list copy; the imported session still
has a placeholder patient ID. For copied production SQLite databases, backlog
imports also need their `created_at` values reconstructed from Recorder-style
filenames so the inbox sorts by the real recording time.

## Goals

- Infer a clear patient name from the first non-empty transcript line during
  transcript import and store it directly in `scribe_sessions.patient_id`.
- Leave the generated placeholder patient ID unchanged when inference is blank,
  uncertain, or fails.
- Set `created_at` during import when the transcript filename contains a Google
  Recorder timestamp such as `May 28 at 3-37 PM.txt`.
- Provide a one-off dry-run-first backfill for copied production SQLite databases
  that updates existing placeholder patient IDs and `created_at` values.

## Non-goals

- Do not generate normalized, stable, or Athena-compatible patient IDs from the
  inferred name.
- Do not change UI fallback behavior; this work changes the stored
  `patient_id` for imports.
- Do not update `started_at`, `stopped_at`, `completed_at`, or any nonexistent
  `updated_at` field.
- Do not store source filenames; existing rows must recover timestamp intent from
  `encounter_id` slugs.
- Do not build a reusable recurring production migration. The backfill is a
  one-off operational command/script for a copied production SQLite database.

## Import design

Keep the import flow centered in `cmd/import-transcripts/main.go`:

1. `buildImportPlan(path, index, opts)` continues to create the generated
   placeholder patient ID and slugged encounter ID from the transcript basename.
2. `importOne` reads the transcript and extracts the first non-empty cleaned line
   using the existing first-dialog behavior that strips `Speaker N:` prefixes.
3. A small focused inference helper sends only that first non-empty line through
   Bedrock via `internal/bedrock.Client.Complete(ctx, systemPrompt, userPrompt,
   maxTokens)`.
4. The helper returns a trimmed patient name only when the model response clearly
   identifies one. Blank, uncertain, malformed, or failed responses return no
   inferred name.
5. `importOne` uses the inferred name as `CreateScribeSessionParams.PatientID`.
   When no name is inferred, it uses the existing generated placeholder from the
   import plan.
6. `processor.Process(ctx, cfg.AthenaPracticeID, patientID, transcript)` should
   receive the same selected patient ID that was stored for the session, so
   imported records and processing context stay aligned.

The inference helper should be small and separate from `Processor.Process`.
`Processor.Process` remains responsible for note generation; the new helper only
answers whether a clear patient name is present in one line of transcript text.

## LLM contract

Use a constrained prompt that asks for JSON with a single string field, for
example `{"patient_name":"Jane Smith"}` or `{"patient_name":""}`. The system
prompt should tell the model to return a name only when the line clearly contains
a patient name, not to guess, and to return an empty string for uncertainty,
greetings, procedural text, or lines without a clear name.

Parsing should trim whitespace from `patient_name`. Empty strings, missing fields,
invalid JSON, and values containing uncertainty markers should be treated as no
inference. The stored value is the model-returned name after trimming, with no
normalization beyond whitespace cleanup.

## Timestamp design

During import, parse Google Recorder transcript basenames shaped like
`May 28 at 3-37 PM.txt` and set `created_at` from the parsed time. Filenames omit
the year, so use the current year at import time. Interpret the parsed timestamp
in `America/Denver`.

`queries/scribe.sql` currently inserts session identity fields but not
`created_at`. Add focused SQL update queries instead of broad model changes:
one query to update `patient_id` for an import/backfill session and one query to
update `created_at`. Only `created_at` is changed for timestamp correction.

If the filename does not match the Recorder timestamp shape or parsing fails,
keep the current database default `created_at` behavior and report the skip in
backfill dry-run output.

## Backfill design

Add a one-off operational command/script following the existing script style used
by `scripts/migrate-supabase-to-sqlite.go` and Makefile command patterns such as
`import-transcripts ARGS=...`.

The backfill reads import-created `scribe_sessions` rows from a copied
production SQLite database and computes proposed changes. Candidate sessions
must have an import-generated encounter slug such as
`demo-encounter-may-28-at-3-37-pm`; patient ID updates apply only when the
current `patient_id` still matches a generated placeholder for the run. The
command accepts a patient-prefix flag whose default matches the import command
default, `demo-patient`; generated placeholders are values matching
`<prefix>-\d{3}`.

- Patient ID: run the same first-line inference helper used by import. If a clear
  name is inferred and the current value is still a generated placeholder,
  update `scribe_sessions.patient_id` to that name. If the helper returns blank
  or errors, leave the existing placeholder unchanged. If the current value no
  longer looks like a generated placeholder, leave it unchanged and print a skip
  reason.
- Timestamp: reconstruct the original filename timestamp from import-generated
  encounter slugs such as `demo-encounter-may-28-at-3-37-pm`. Parse the slug as
  `May 28 at 3-37 PM`, use the current year, interpret it in `America/Denver`,
  and update only `created_at`.

The default mode is dry-run. Dry-run prints one row per inspected session with:

- session ID;
- old and proposed patient ID;
- old and proposed `created_at`;
- skip reason when no field would change.

Apply mode requires an explicit flag. Apply mode performs only the proposed
updates that differ from current values and should still print the same row-level
summary so the operator can audit what changed.

## Error handling

- Transcript read failures keep the existing import failure behavior.
- Patient inference failures are non-fatal. Import and backfill keep the generated
  or existing placeholder patient ID.
- Timestamp parse failures are non-fatal. Import keeps the default `created_at`;
  backfill leaves `created_at` unchanged and prints a skip reason.
- Missing `America/Denver` timezone data should fail the timestamp operation with
  a clear error rather than silently using local time.
- Backfill apply mode should stop on database write errors and print the session
  that failed.

## Data flow

### New import

1. Build the import plan from the transcript path.
2. Read and trim the transcript.
3. Extract the first non-empty cleaned transcript line.
4. Ask Bedrock whether that line clearly contains a patient name.
5. Choose `patient_id`: inferred name when present, otherwise the generated
   placeholder.
6. Create the scribe session with that `patient_id`.
7. If the filename parses as a Recorder timestamp, set `created_at` to the parsed
   Mountain Time instant.
8. Run scribe processing with the stored patient ID and transcript.

### Backfill

1. Select import-generated candidate sessions from the copied SQLite database.
2. Load the stored transcript text for each session through the existing storage
   path used by import-created sessions.
3. Infer a patient name from the first non-empty cleaned transcript line.
4. Reconstruct a timestamp from the import-generated `encounter_id` slug.
5. Print the dry-run summary.
6. In apply mode, update `patient_id` only for generated placeholders and update
   `created_at` only when the proposed value differs from the current value.

## Tests

Add focused tests in `cmd/import-transcripts/main_test.go` and nearby script or
command tests:

- existing `TestLabelFromFirstDialog` cases continue to pass;
- patient inference uses the inferred name as stored `patient_id` when the LLM
  returns a clear name;
- blank, uncertain, invalid, or failed inference leaves the generated placeholder
  patient ID unchanged;
- `TestImportOneStoresDerivedLabel` continues to prove label behavior is
  preserved while `patient_id` changes only through inference;
- Recorder filename parsing converts `May 28 at 3-37 PM.txt` using the current
  year and `America/Denver`;
- non-matching filenames leave `created_at` on the database default path;
- backfill reconstructs `created_at` from
  `demo-encounter-may-28-at-3-37-pm`;
- backfill dry-run prints session ID, old/new patient ID, old/new `created_at`,
  and a skip reason when unchanged;
- backfill apply mode is gated by an explicit flag and updates only differing
  `patient_id` and `created_at` values.
