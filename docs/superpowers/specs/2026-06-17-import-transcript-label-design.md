# Import transcript labels from first dialog

## Goal

When backlog recordings are imported through `import-transcripts`, create each
scribe session with a useful label derived from the transcript's first spoken
dialog. The doctor says the patient name at the start of each recording, so the
dashboard should show that name instead of only the placeholder patient ID.

## Context

Backlog recordings flow through `batch-transcribe-recordings` and then
`import-transcripts`. The batch transcriber already produces `.txt` transcripts;
the importer creates scribe sessions with placeholder patient and encounter IDs.
`CreateScribeSessionParams` already supports `Label`, and the existing
placeholder IDs must continue to work for processing and import bookkeeping.

## Approach

Implement the behavior only in `cmd/import-transcripts/main.go`:

- Add a small helper named `labelFromFirstDialog(transcript string) string`.
- Split the transcript into lines and select the first non-empty line.
- Strip a diarization prefix such as `Speaker 0:` from that line.
- Trim surrounding whitespace plus leading and trailing quote punctuation
  (`"`, `'`, `“`, `”`, `‘`, `’`) from the remaining text.
- Pass the result to `database.CreateScribeSessionParams{Label: ...}` in
  `importOne`.

The helper should be pure and deterministic: the same transcript always returns
the same label, and an unusable transcript returns an empty string.

## Data Flow

1. `importOne` reads and trims the transcript file as it does today.
2. Before `CreateScribeSession`, it derives `labelFromFirstDialog(transcript)`.
3. `CreateScribeSession` receives the existing placeholder patient,
   encounter, and department values plus the derived label.
4. Transcript storage, optional AI processing, overwrite behavior, and dry-run
   behavior stay unchanged.

## Edge Cases

- Diarized transcript: `Speaker 0: Jane Smith` stores `Jane Smith`.
- Plain transcript: the first non-empty line becomes the label.
- Leading blank lines are ignored.
- A speaker prefix matching `Speaker <number>:` with surrounding whitespace is
  removed before final trim.
- Surrounding quote punctuation is removed from the selected text.
- If no usable label text remains, `Label` is blank and placeholder IDs still
  identify the imported session.
- Empty transcript files keep the current `empty transcript` failure.

## Testing

Add tests in `cmd/import-transcripts/main_test.go` for:

- diarized transcript label extraction;
- plain transcript label extraction;
- blank or punctuation-only content returning an empty label;
- whitespace handling around lines, speaker prefixes, and final label text.

Run the Go test suite for the importer package after implementation.

## Out of Scope

- Changes to `batch-transcribe-recordings`.
- Changes to recorder apps.
- Database schema or sqlc query changes beyond passing the existing `Label`
  parameter.
- Dashboard or other UI changes.
- New import flags or manual label override behavior.
