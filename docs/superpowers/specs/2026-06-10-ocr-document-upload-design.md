# OCR Document Upload — Design

> **Revised 2026-06-10 — supersedes the separate-entity design below.**
> Scope changed after the initial implementation: uploaded documents now go *only*
> through the same post-processing as audio transcriptions (the 4-section split),
> with no text-only path. Because the text-only path was the sole justification for a
> first-class `ocr_documents` entity, documents are now modeled as **a scribe-session
> input source** — exactly like recorded audio:
> - The session is created up front with patient/appointment/department binding (the
>   existing scribe new-session flow), via a new "Upload document" source in the
>   upload modal.
> - The uploaded file is stored in S3 and OCR'd by AWS Textract; the extracted text
>   becomes the session `transcript`, which the existing `scribe.Processor` splits
>   into HPI / Assessment & Plan / Physical Exam / diagnoses-labs. Approval and Athena
>   write-back are unchanged.
> - Schema: a single `scribe_sessions.document_filename` column (no `ocr_documents`
>   table, no `document_id`). It marks a session as document-sourced and lets the
>   review screen serve the original file ("View original document").
> - `internal/ocr` keeps the Textract client + text assembly + validation helpers; the
>   upload/async-OCR/process pipeline lives in the scribe handler (`HandleUploadDocument`
>   → `processDocumentAsync`, mirroring `processSessionAsync`), reusing `recordLLMUsage`.
> - No standalone Documents page/route/nav; document sessions appear in the normal
>   scribe list beside audio ones.
>
> The sections below describe the original (now-replaced) standalone-entity approach
> and are retained for historical context only.

## Summary

Add a web-only feature to upload documents (images, multi-page PDFs), extract their
text via OCR, and optionally route the extracted text through the existing scribe
clinical-note pipeline. After OCR, the user chooses: process the text into a structured
note (HPI / Assessment & Plan / Physical Exam / diagnoses-labs, with physician approval
and Athena write-back), or keep it as saved, viewable, downloadable text.

## Core decision: documents are a first-class entity

OCR documents get their own table and lifecycle rather than being modeled as
`scribe_sessions` with a source discriminator.

The deciding factor is the **text-only path**. A saved, patient-less, un-processed OCR
document has no honest representation as a `scribe_session`: the status enum is
`recording/processing/complete/error`, and `patient_id` is `NOT NULL` with no default
(migration 017 added defaults only for `appointment_id`/`encounter_id`). Parking
text-only documents as empty-patient sessions in a status that does not describe them is
a conceptual mismatch. The user's other constraints corroborate: patient binding happens
*after* OCR, the page is dedicated, and the raw text has standalone value.

This costs nothing in downstream reuse. "Process" creates a `scribe_session` seeded with
the OCR text as `transcript` plus the chosen patient binding, after which the existing
process → approval → section edit → send-to-Athena → feedback path runs unchanged.

**Rejected alternative:** add a `source` column to `scribe_sessions` and store OCR text
in `transcript`. Maximizes table reuse but mismodels the text-only state and adds
document-specific columns (filename, S3 key, OCR status) to a central table.

## OCR engine

AWS Textract, async API (`StartDocumentTextDetection` → poll `GetDocumentTextDetection`).
Synchronous `DetectDocumentText` cannot handle multi-page PDFs, and medical faxes are
routinely multi-page. This mirrors the existing async S3 + job-poll pattern in
`internal/transcribe/batch.go`.

## Data model

New table `ocr_documents`:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | `gen_random_uuid()` |
| `tenant_id` | UUID NOT NULL | FK `tenants(id)` |
| `user_id` | UUID NOT NULL | FK `users(id)` |
| `original_filename` | TEXT NOT NULL | the S3 object key is derived from `tenant_id`, `id`, and this filename's extension (`ocr/{tenant}/{id}{ext}`) rather than stored — mirrors scribe audio path derivation |
| `content_type` | TEXT NOT NULL | e.g. `application/pdf`, `image/png` |
| `status` | TEXT NOT NULL | `uploaded` / `extracting` / `extracted` / `error`, default `uploaded` |
| `error_message` | TEXT | |
| `extracted_text` | TEXT | populated when `status = extracted` |
| `scribe_session_id` | UUID NULL | set when processed; the link to the resulting note |
| `created_at` | TIMESTAMPTZ NOT NULL | default `now()` |
| `extracted_at` | TIMESTAMPTZ | |

Indexes: `(tenant_id, created_at DESC)`, `(tenant_id, status)`.

One addition to `scribe_sessions`: `document_id UUID NULL`. The scribe session list
filters to audio-originated sessions (`document_id IS NULL`) by default so processed
documents do not clutter the scribe list; the Documents page is the entry point for those
notes.

## Backend

New package `internal/ocr` (Textract client wrapper + text assembly) and an OCR handler,
wired in `cmd/janushc-dash/main.go` and `internal/server/server.go` under protected
routes.

### Endpoints

- `POST /api/ocr/documents` (multipart) — validate + save file to S3, create row
  `status=uploaded`, start async Textract job, return the document immediately. Wrapped
  with a generous timeout middleware like the scribe upload route.
- `GET /api/ocr/documents` — list for tenant.
- `GET /api/ocr/documents/{id}` — fetch one (frontend polls while `extracting`).
- `GET /api/ocr/documents/{id}/file` — stream the original from S3 (mirrors
  `HandleAudio`).
- `DELETE /api/ocr/documents/{id}` — delete row + S3 object.
- `POST /api/ocr/documents/{id}/process` — body: `patient_id`, `appointment_id`,
  `department_id`. Creates a `scribe_session` (transcript = `extracted_text`,
  `document_id` set), runs `processor.Process`, sets `scribe_session_id` on the document,
  returns `{ scribe_session_id }`.

### Async extraction worker

After upload returns, a background goroutine polls `GetDocumentTextDetection` until the
job completes, assembles text from `LINE` blocks in page order, stores `extracted_text`,
and sets `status=extracted` (or `error` with `error_message`). Communicated to the
frontend via the `ocr_documents` row, polled by the client — same approach as
`processSessionAsync`.

### Config

Reuse the existing `AWS_TRANSCRIBE_BUCKET` with an `ocr/` key prefix to avoid new infra.
If a separate bucket is later preferred, add `AWS_OCR_BUCKET`. Textract uses the existing
`AWS_REGION` and default credential chain.

## Frontend (dedicated Documents page)

- New nav entry "Documents" and route `/documents` (repurpose the currently disabled
  `Records` / FileText nav slot in `app-shell.tsx`).
- New API hooks in `frontend/src/lib` mirroring `scribe-queries.ts`.
- **Upload**: drag/drop or file picker; accepts images and PDF.
- **List**: documents with status; polling while `extracting`.
- **Detail**: extracted text with copy + download, a "view original" pane (image/PDF from
  the `/file` endpoint), and the post-OCR choice:
  - **Process** — opens a patient / appointment / department picker reusing scribe's
    department + appointment selectors, then calls the process endpoint.
  - **Keep as text** — no further action; the document remains saved and viewable.

### Navigation seam

After `Process` succeeds, navigate to `/scribe/:sessionId`. The existing scribe
session-detail view owns the note / section-approval / send UI. (The alternative —
embedding that component inside the Documents area — is more work for no real gain.)

## Error handling

- Upload: reject unsupported content types and oversized files with `400`, before any S3
  write.
- Textract failure / timeout: set document `status=error` with `error_message`; surfaced
  in the detail view.
- Process: if `processor.Process` fails, the spawned scribe session records the error via
  the existing `UpdateScribeSessionError` path; the document keeps its `scribe_session_id`
  link so the user can see the failed note.
- S3/Textract not configured: process/upload returns a clear `500` like the scribe batch
  path does when the bucket is unset.

## Testing

- **Go**: text assembly from mocked Textract blocks (page order, LINE concatenation);
  document handler tests for upload validation, status transitions, and process →
  scribe-session creation with correct binding and `document_id`. Existing processor tests
  cover the downstream.
- **Frontend**: `npm run build` (tsc + vite). Component test covering the upload / list /
  detail states, mirroring the existing scribe page tests.
