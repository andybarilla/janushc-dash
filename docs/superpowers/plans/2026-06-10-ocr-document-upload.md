# OCR Document Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let web users upload documents (images, multi-page PDFs), extract text via AWS Textract, then optionally route that text through the existing scribe clinical-note pipeline.

**Architecture:** OCR documents are a first-class entity (`ocr_documents` table) with their own lifecycle (`uploaded → extracting → extracted → error`). The original file lives in S3 (reusing the transcribe bucket with an `ocr/` prefix). When a user chooses to "process" an extracted document, the backend creates a `scribe_session` seeded with the OCR text as its `transcript` plus the chosen patient binding; the existing scribe process → approval → send-to-Athena path then runs unchanged. Untouched documents remain saved, viewable, and downloadable.

**Tech Stack:** Go 1.25 (chi, sqlc, pgx/v5), AWS Textract async API (`StartDocumentTextDetection` / `GetDocumentTextDetection`), AWS S3, React 19 (Vite, TypeScript, TanStack Query), PostgreSQL 16.

**Reference files (read before starting):**
- `internal/transcribe/batch.go` — S3 + async-job + poll patterns to mirror
- `internal/scribe/handler.go` — handler conventions (auth, pgtype.UUID, multipart, async worker, file streaming via `HandleAudio`)
- `internal/scribe/processor.go` — `Processor.Process` (the downstream we reuse)
- `queries/scribe.sql` — sqlc query style
- `frontend/src/lib/scribe-queries.ts`, `frontend/src/lib/queries.ts` — TanStack Query hook patterns
- `frontend/src/components/layout/app-shell.tsx` — nav entries

---

## File Structure

**Backend (create):**
- `migrations/019_ocr_documents.up.sql` / `.down.sql` — `ocr_documents` table + `scribe_sessions.document_id` column
- `queries/ocr.sql` — sqlc queries for documents + the document→session insert
- `internal/ocr/assemble.go` — pure Textract-block → text assembly
- `internal/ocr/assemble_test.go` — unit test for assembly
- `internal/ocr/textract.go` — AWS client wrapper (S3 + Textract: put/get/delete object, start/poll detection)
- `internal/ocr/handler.go` — HTTP handlers + request validation
- `internal/ocr/handler_test.go` — unit tests for validation + key derivation

**Backend (modify):**
- `queries/scribe.sql` — `ListScribeSessions` filters out document-spawned sessions
- `internal/server/server.go` — add `ocrHandler` field + routes
- `cmd/janushc-dash/main.go` — construct OCR client + handler, pass to `server.New`

**Frontend (create):**
- `frontend/src/lib/ocr-queries.ts` — types + TanStack Query hooks
- `frontend/src/pages/documents.tsx` — list + detail page
- `frontend/src/pages/documents.test.tsx` — component test

**Frontend (modify):**
- `frontend/src/App.tsx` — register `/documents/*` route
- `frontend/src/components/layout/app-shell.tsx` — add "Documents" nav entry

---

## Task 1: Database migration

**Files:**
- Create: `migrations/019_ocr_documents.up.sql`
- Create: `migrations/019_ocr_documents.down.sql`

- [ ] **Step 1: Write the up migration**

`migrations/019_ocr_documents.up.sql`:

```sql
-- migrations/019_ocr_documents.up.sql
CREATE TABLE ocr_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id UUID NOT NULL REFERENCES users(id),
    original_filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('uploaded', 'extracting', 'extracted', 'error')) DEFAULT 'uploaded',
    error_message TEXT,
    extracted_text TEXT,
    scribe_session_id UUID REFERENCES scribe_sessions(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    extracted_at TIMESTAMPTZ
);

CREATE INDEX idx_ocr_documents_tenant_created ON ocr_documents (tenant_id, created_at DESC);
CREATE INDEX idx_ocr_documents_tenant_status ON ocr_documents (tenant_id, status);

ALTER TABLE scribe_sessions ADD COLUMN document_id UUID REFERENCES ocr_documents(id);
```

- [ ] **Step 2: Write the down migration**

`migrations/019_ocr_documents.down.sql`:

```sql
-- migrations/019_ocr_documents.down.sql
ALTER TABLE scribe_sessions DROP COLUMN IF EXISTS document_id;
DROP TABLE IF EXISTS ocr_documents;
```

- [ ] **Step 3: Run the migration**

Run: `make migrate-up`
Expected: migration `019` applies with no error; output ends without a `Dirty database` message.

- [ ] **Step 4: Verify the schema**

Run: `psql "$DATABASE_URL" -c "\d ocr_documents" && psql "$DATABASE_URL" -c "\d scribe_sessions" | grep document_id`
Expected: `ocr_documents` table prints with the columns above; `document_id` appears on `scribe_sessions`.

- [ ] **Step 5: Commit**

```bash
git add migrations/019_ocr_documents.up.sql migrations/019_ocr_documents.down.sql
git commit -m "feat(ocr): add ocr_documents table and scribe_sessions.document_id"
```

---

## Task 2: sqlc queries

**Files:**
- Create: `queries/ocr.sql`
- Modify: `queries/scribe.sql` (ListScribeSessions)

- [ ] **Step 1: Write the OCR queries**

`queries/ocr.sql`:

```sql
-- name: CreateOCRDocument :one
INSERT INTO ocr_documents (tenant_id, user_id, original_filename, content_type, status)
VALUES ($1, $2, $3, $4, 'uploaded')
RETURNING id, tenant_id, user_id, original_filename, content_type, status,
          error_message, extracted_text, scribe_session_id, created_at, extracted_at;

-- name: GetOCRDocument :one
SELECT id, tenant_id, user_id, original_filename, content_type, status,
       error_message, extracted_text, scribe_session_id, created_at, extracted_at
FROM ocr_documents
WHERE id = $1 AND tenant_id = $2;

-- name: ListOCRDocuments :many
SELECT id, tenant_id, user_id, original_filename, content_type, status,
       error_message, extracted_text, scribe_session_id, created_at, extracted_at
FROM ocr_documents
WHERE tenant_id = $1
ORDER BY created_at DESC
LIMIT 50;

-- name: UpdateOCRDocumentExtracting :exec
UPDATE ocr_documents
SET status = 'extracting'
WHERE id = $1 AND tenant_id = $2;

-- name: UpdateOCRDocumentExtracted :exec
UPDATE ocr_documents
SET status = 'extracted', extracted_text = $3, extracted_at = now()
WHERE id = $1 AND tenant_id = $2;

-- name: UpdateOCRDocumentError :exec
UPDATE ocr_documents
SET status = 'error', error_message = $3
WHERE id = $1 AND tenant_id = $2;

-- name: SetOCRDocumentScribeSession :exec
UPDATE ocr_documents
SET scribe_session_id = $3
WHERE id = $1 AND tenant_id = $2;

-- name: DeleteOCRDocument :execrows
DELETE FROM ocr_documents
WHERE id = $1 AND tenant_id = $2;

-- name: CreateDocumentScribeSession :one
INSERT INTO scribe_sessions (tenant_id, user_id, patient_id, encounter_id, appointment_id, department_id, transcript, status, document_id)
VALUES ($1, $2, $3, '', $4, $5, $6, 'processing', $7)
RETURNING id, tenant_id, user_id, patient_id, encounter_id, appointment_id, department_id, label, status,
          transcript, ai_output, error_message, started_at, stopped_at, completed_at, created_at;
```

- [ ] **Step 2: Filter document-spawned sessions out of the scribe list**

In `queries/scribe.sql`, find the `ListScribeSessions` query and change its `WHERE` clause from:

```sql
WHERE s.tenant_id = $1
```

to:

```sql
WHERE s.tenant_id = $1 AND s.document_id IS NULL
```

(Leave the rest of the query unchanged.)

- [ ] **Step 3: Regenerate sqlc code**

Run: `make sqlc`
Expected: completes with no error; `internal/database/` now contains `CreateOCRDocument`, `GetOCRDocument`, `ListOCRDocuments`, `UpdateOCRDocumentExtracting`, `UpdateOCRDocumentExtracted`, `UpdateOCRDocumentError`, `SetOCRDocumentScribeSession`, `DeleteOCRDocument`, `CreateDocumentScribeSession`.

- [ ] **Step 4: Verify it compiles**

Run: `go build ./...`
Expected: builds with no error.

- [ ] **Step 5: Commit**

```bash
git add queries/ocr.sql queries/scribe.sql internal/database/
git commit -m "feat(ocr): add sqlc queries for ocr documents"
```

---

## Task 3: Textract block → text assembly (pure function, TDD)

**Files:**
- Create: `internal/ocr/assemble.go`
- Test: `internal/ocr/assemble_test.go`

- [ ] **Step 1: Write the failing test**

`internal/ocr/assemble_test.go`:

```go
package ocr

import (
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/textract/types"
)

func line(text string, page int32) types.Block {
	return types.Block{BlockType: types.BlockTypeLine, Text: aws.String(text), Page: aws.Int32(page)}
}

func TestAssembleText_OrdersByPageAndJoinsLines(t *testing.T) {
	blocks := []types.Block{
		line("page two line", 2),
		line("Hello", 1),
		{BlockType: types.BlockTypeWord, Text: aws.String("ignored"), Page: aws.Int32(1)},
		line("World", 1),
	}

	got := AssembleText(blocks)
	want := "Hello\nWorld\n\npage two line"
	if got != want {
		t.Errorf("AssembleText = %q, want %q", got, want)
	}
}

func TestAssembleText_Empty(t *testing.T) {
	if got := AssembleText(nil); got != "" {
		t.Errorf("AssembleText(nil) = %q, want empty", got)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/ocr/ -run TestAssembleText -v`
Expected: FAIL — `undefined: AssembleText`.

- [ ] **Step 3: Write the implementation**

`internal/ocr/assemble.go`:

```go
package ocr

import (
	"sort"
	"strings"

	"github.com/aws/aws-sdk-go-v2/service/textract/types"
)

// AssembleText turns Textract LINE blocks into plain text. Lines are kept in the
// order Textract returns them within a page; pages are emitted in ascending page
// order and separated by a blank line. Non-LINE blocks are ignored.
func AssembleText(blocks []types.Block) string {
	linesByPage := make(map[int32][]string)
	var pages []int32
	for _, b := range blocks {
		if b.BlockType != types.BlockTypeLine || b.Text == nil {
			continue
		}
		var page int32 = 1
		if b.Page != nil {
			page = *b.Page
		}
		if _, seen := linesByPage[page]; !seen {
			pages = append(pages, page)
		}
		linesByPage[page] = append(linesByPage[page], *b.Text)
	}

	sort.Slice(pages, func(i, j int) bool { return pages[i] < pages[j] })

	pageTexts := make([]string, 0, len(pages))
	for _, p := range pages {
		pageTexts = append(pageTexts, strings.Join(linesByPage[p], "\n"))
	}
	return strings.Join(pageTexts, "\n\n")
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `go test ./internal/ocr/ -run TestAssembleText -v`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add internal/ocr/assemble.go internal/ocr/assemble_test.go
git commit -m "feat(ocr): textract block text assembly"
```

---

## Task 4: Textract/S3 client wrapper

**Files:**
- Create: `internal/ocr/textract.go`

- [ ] **Step 1: Write the client**

`internal/ocr/textract.go`:

```go
package ocr

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/aws-sdk-go-v2/service/textract"
	"github.com/aws/aws-sdk-go-v2/service/textract/types"
)

// Client wraps AWS Textract (async document text detection) plus the S3 bucket
// used to stage uploaded documents for Textract and for original-file retrieval.
type Client struct {
	s3       *s3.Client
	textract *textract.Client
	bucket   string
}

// NewClient creates the S3 + Textract clients. bucket may be empty; handlers must
// check Configured() before use.
func NewClient(ctx context.Context, region, bucket string) (*Client, error) {
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("load AWS config: %w", err)
	}
	return &Client{
		s3:       s3.NewFromConfig(cfg),
		textract: textract.NewFromConfig(cfg),
		bucket:   bucket,
	}, nil
}

// Configured reports whether an S3 bucket is set.
func (c *Client) Configured() bool { return c.bucket != "" }

// PutObject stores bytes in S3 under key with SSE-S3 encryption.
func (c *Client) PutObject(ctx context.Context, key string, body []byte, contentType string) error {
	input := &s3.PutObjectInput{
		Bucket:               aws.String(c.bucket),
		Key:                  aws.String(key),
		Body:                 bytes.NewReader(body),
		ServerSideEncryption: s3types.ServerSideEncryptionAes256,
	}
	if contentType != "" {
		input.ContentType = aws.String(contentType)
	}
	if _, err := c.s3.PutObject(ctx, input); err != nil {
		return fmt.Errorf("put s3://%s/%s: %w", c.bucket, key, err)
	}
	return nil
}

// GetObject streams an object from S3. The caller must close the returned reader.
func (c *Client) GetObject(ctx context.Context, key string) (io.ReadCloser, string, error) {
	out, err := c.s3.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(c.bucket), Key: aws.String(key)})
	if err != nil {
		return nil, "", fmt.Errorf("get s3://%s/%s: %w", c.bucket, key, err)
	}
	contentType := ""
	if out.ContentType != nil {
		contentType = *out.ContentType
	}
	return out.Body, contentType, nil
}

// DeleteObject removes an object from S3.
func (c *Client) DeleteObject(ctx context.Context, key string) error {
	if _, err := c.s3.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(c.bucket), Key: aws.String(key)}); err != nil {
		return fmt.Errorf("delete s3://%s/%s: %w", c.bucket, key, err)
	}
	return nil
}

// StartTextDetection begins an async Textract job for the S3 object at key and
// returns the job id.
func (c *Client) StartTextDetection(ctx context.Context, key string) (string, error) {
	out, err := c.textract.StartDocumentTextDetection(ctx, &textract.StartDocumentTextDetectionInput{
		DocumentLocation: &types.DocumentLocation{
			S3Object: &types.S3Object{Bucket: aws.String(c.bucket), Name: aws.String(key)},
		},
	})
	if err != nil {
		return "", fmt.Errorf("start text detection for %s: %w", key, err)
	}
	if out.JobId == nil {
		return "", errors.New("textract returned no job id")
	}
	return *out.JobId, nil
}

// WaitTextDetection polls until the Textract job finishes, then returns the
// assembled text. It paginates all result pages on success.
func (c *Client) WaitTextDetection(ctx context.Context, jobID string, pollInterval time.Duration) (string, error) {
	if pollInterval <= 0 {
		pollInterval = 5 * time.Second
	}
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		status, statusMessage, err := c.jobStatus(ctx, jobID)
		if err != nil {
			return "", err
		}
		switch status {
		case types.JobStatusSucceeded:
			return c.collectText(ctx, jobID)
		case types.JobStatusFailed:
			if statusMessage != "" {
				return "", fmt.Errorf("textract job failed: %s", statusMessage)
			}
			return "", errors.New("textract job failed")
		}

		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-ticker.C:
		}
	}
}

func (c *Client) jobStatus(ctx context.Context, jobID string) (types.JobStatus, string, error) {
	out, err := c.textract.GetDocumentTextDetection(ctx, &textract.GetDocumentTextDetectionInput{
		JobId: aws.String(jobID),
	})
	if err != nil {
		return "", "", fmt.Errorf("get text detection %s: %w", jobID, err)
	}
	statusMessage := ""
	if out.StatusMessage != nil {
		statusMessage = *out.StatusMessage
	}
	return out.JobStatus, statusMessage, nil
}

func (c *Client) collectText(ctx context.Context, jobID string) (string, error) {
	var blocks []types.Block
	var nextToken *string
	for {
		out, err := c.textract.GetDocumentTextDetection(ctx, &textract.GetDocumentTextDetectionInput{
			JobId:     aws.String(jobID),
			NextToken: nextToken,
		})
		if err != nil {
			return "", fmt.Errorf("get text detection page %s: %w", jobID, err)
		}
		blocks = append(blocks, out.Blocks...)
		if out.NextToken == nil || *out.NextToken == "" {
			break
		}
		nextToken = out.NextToken
	}
	return AssembleText(blocks), nil
}
```

- [ ] **Step 2: Add the Textract SDK dependency and verify compilation**

Run: `go get github.com/aws/aws-sdk-go-v2/service/textract && go build ./...`
Expected: module resolves; build succeeds with no error.

- [ ] **Step 3: Commit**

```bash
git add internal/ocr/textract.go go.mod go.sum
git commit -m "feat(ocr): textract + s3 client wrapper"
```

---

## Task 5: Upload validation + S3 key helpers (pure, TDD)

**Files:**
- Create: `internal/ocr/handler.go` (validation helpers only in this task)
- Test: `internal/ocr/handler_test.go`

- [ ] **Step 1: Write the failing test**

`internal/ocr/handler_test.go`:

```go
package ocr

import "testing"

func TestValidateDocumentExt(t *testing.T) {
	valid := []string{".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".PDF", ".JPG"}
	for _, ext := range valid {
		if err := validateDocumentExt(ext); err != nil {
			t.Errorf("validateDocumentExt(%q) = %v, want nil", ext, err)
		}
	}
	invalid := []string{".docx", ".txt", ".gif", ""}
	for _, ext := range invalid {
		if err := validateDocumentExt(ext); err == nil {
			t.Errorf("validateDocumentExt(%q) = nil, want error", ext)
		}
	}
}

func TestDocumentS3Key(t *testing.T) {
	got := documentS3Key("tenant-1", "doc-9", "Scan Report.PDF")
	want := "ocr/tenant-1/doc-9.pdf"
	if got != want {
		t.Errorf("documentS3Key = %q, want %q", got, want)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/ocr/ -run 'TestValidateDocumentExt|TestDocumentS3Key' -v`
Expected: FAIL — `undefined: validateDocumentExt`, `undefined: documentS3Key`.

- [ ] **Step 3: Write the handler scaffold + helpers**

`internal/ocr/handler.go`:

```go
package ocr

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/andybarilla/janushc-dash/internal/config"
	"github.com/andybarilla/janushc-dash/internal/database"
	"github.com/andybarilla/janushc-dash/internal/scribe"
)

const maxUploadSize = 50 << 20 // 50 MB

// Handler serves the OCR document endpoints.
type Handler struct {
	queries   *database.Queries
	processor *scribe.Processor
	client    *Client
	cfg       *config.Config
}

// NewHandler builds the OCR handler.
func NewHandler(queries *database.Queries, processor *scribe.Processor, client *Client, cfg *config.Config) *Handler {
	return &Handler{queries: queries, processor: processor, client: client, cfg: cfg}
}

var allowedExts = map[string]bool{
	".pdf": true, ".png": true, ".jpg": true, ".jpeg": true, ".tif": true, ".tiff": true,
}

func validateDocumentExt(ext string) error {
	if !allowedExts[strings.ToLower(ext)] {
		return fmt.Errorf("unsupported file type %q (allowed: pdf, png, jpg, jpeg, tif, tiff)", ext)
	}
	return nil
}

// documentS3Key derives the S3 object key for a document deterministically from
// its tenant, id, and original filename extension — mirroring how scribe derives
// audio paths instead of storing them.
func documentS3Key(tenantID, docID, filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	return fmt.Sprintf("ocr/%s/%s%s", tenantID, docID, ext)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `go test ./internal/ocr/ -run 'TestValidateDocumentExt|TestDocumentS3Key' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/ocr/handler.go internal/ocr/handler_test.go
git commit -m "feat(ocr): document upload validation and s3 key helpers"
```

---

## Task 6: Upload handler + async extraction worker

**Files:**
- Modify: `internal/ocr/handler.go`

- [ ] **Step 1: Add imports and the response type**

In `internal/ocr/handler.go`, replace the import block with:

```go
import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andybarilla/janushc-dash/internal/auth"
	"github.com/andybarilla/janushc-dash/internal/config"
	"github.com/andybarilla/janushc-dash/internal/database"
	"github.com/andybarilla/janushc-dash/internal/scribe"
)
```

Then add this response type and helper below the `documentS3Key` function:

```go
type documentResponse struct {
	ID              string `json:"id"`
	OriginalName    string `json:"original_filename"`
	ContentType     string `json:"content_type"`
	Status          string `json:"status"`
	ErrorMessage    string `json:"error_message,omitempty"`
	ExtractedText   string `json:"extracted_text,omitempty"`
	ScribeSessionID string `json:"scribe_session_id,omitempty"`
	CreatedAt       string `json:"created_at"`
}

func uuidToString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x", u.Bytes[0:4], u.Bytes[4:6], u.Bytes[6:8], u.Bytes[8:10], u.Bytes[10:16])
}

func toDocumentResponse(d database.OcrDocument) documentResponse {
	resp := documentResponse{
		ID:           uuidToString(d.ID),
		OriginalName: d.OriginalFilename,
		ContentType:  d.ContentType,
		Status:       d.Status,
		CreatedAt:    d.CreatedAt.Time.UTC().Format("2006-01-02T15:04:05Z"),
	}
	if d.ErrorMessage.Valid {
		resp.ErrorMessage = d.ErrorMessage.String
	}
	if d.ExtractedText.Valid {
		resp.ExtractedText = d.ExtractedText.String
	}
	if d.ScribeSessionID.Valid {
		resp.ScribeSessionID = uuidToString(d.ScribeSessionID)
	}
	return resp
}
```

> Note: confirm the generated struct/field names with `grep -n "type OcrDocument" internal/database/models.go`. sqlc pluralizes/camel-cases — if it emits `OCRDocument` or different field names, match them here and in later tasks.

- [ ] **Step 2: Add the upload handler and worker**

Append to `internal/ocr/handler.go`:

```go
// HandleUpload accepts a multipart "document" file, stores it in S3, creates the
// document row, and kicks off async Textract extraction.
func (h *Handler) HandleUpload(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if !h.client.Configured() {
		http.Error(w, "OCR storage not configured (set AWS_TRANSCRIBE_BUCKET)", http.StatusInternalServerError)
		return
	}

	tenantUUID := pgtype.UUID{}
	if err := tenantUUID.Scan(claims.TenantID); err != nil {
		http.Error(w, "invalid tenant context", http.StatusBadRequest)
		return
	}
	userUUID := pgtype.UUID{}
	if err := userUUID.Scan(claims.UserID); err != nil {
		http.Error(w, "invalid user context", http.StatusBadRequest)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	file, header, err := r.FormFile("document")
	if err != nil {
		http.Error(w, "missing or invalid document file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if err := validateDocumentExt(ext); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	contentType := header.Header.Get("Content-Type")

	data, err := io.ReadAll(file)
	if err != nil {
		http.Error(w, "failed to read upload", http.StatusBadRequest)
		return
	}

	doc, err := h.queries.CreateOCRDocument(r.Context(), database.CreateOCRDocumentParams{
		TenantID:         tenantUUID,
		UserID:           userUUID,
		OriginalFilename: header.Filename,
		ContentType:      contentType,
	})
	if err != nil {
		http.Error(w, "failed to create document", http.StatusInternalServerError)
		return
	}
	docID := uuidToString(doc.ID)
	key := documentS3Key(claims.TenantID, docID, header.Filename)

	if err := h.client.PutObject(r.Context(), key, data, contentType); err != nil {
		log.Printf("ocr upload s3 error for document %s: %v", docID, err)
		_ = h.queries.UpdateOCRDocumentError(r.Context(), database.UpdateOCRDocumentErrorParams{
			ID:           doc.ID,
			TenantID:     tenantUUID,
			ErrorMessage: pgtype.Text{String: "failed to store document", Valid: true},
		})
		http.Error(w, "failed to store document", http.StatusInternalServerError)
		return
	}

	if err := h.queries.UpdateOCRDocumentExtracting(r.Context(), database.UpdateOCRDocumentExtractingParams{
		ID:       doc.ID,
		TenantID: tenantUUID,
	}); err != nil {
		http.Error(w, "failed to update document", http.StatusInternalServerError)
		return
	}
	doc.Status = "extracting"

	go h.extractAsync(claims.TenantID, docID, key)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(toDocumentResponse(doc))
}

// extractAsync runs Textract in the background and records the result on the
// document row. Status is communicated to the frontend via the row, which the
// client polls — mirroring scribe's processSessionAsync.
func (h *Handler) extractAsync(tenantID, docID, key string) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	docUUID := pgtype.UUID{}
	if err := docUUID.Scan(docID); err != nil {
		log.Printf("ocr async invalid document id %s: %v", docID, err)
		return
	}
	tenantUUID := pgtype.UUID{}
	if err := tenantUUID.Scan(tenantID); err != nil {
		log.Printf("ocr async invalid tenant %s: %v", tenantID, err)
		return
	}
	setError := func(msg string) {
		_ = h.queries.UpdateOCRDocumentError(ctx, database.UpdateOCRDocumentErrorParams{
			ID:           docUUID,
			TenantID:     tenantUUID,
			ErrorMessage: pgtype.Text{String: msg, Valid: true},
		})
	}

	jobID, err := h.client.StartTextDetection(ctx, key)
	if err != nil {
		log.Printf("ocr start detection error for document %s: %v", docID, err)
		setError("failed to start OCR")
		return
	}
	text, err := h.client.WaitTextDetection(ctx, jobID, 5*time.Second)
	if err != nil {
		log.Printf("ocr detection error for document %s: %v", docID, err)
		setError("OCR failed")
		return
	}

	if err := h.queries.UpdateOCRDocumentExtracted(ctx, database.UpdateOCRDocumentExtractedParams{
		ID:            docUUID,
		TenantID:      tenantUUID,
		ExtractedText: pgtype.Text{String: text, Valid: true},
	}); err != nil {
		log.Printf("ocr save text error for document %s: %v", docID, err)
	}
}
```

- [ ] **Step 3: Verify it compiles**

Run: `go build ./... && go test ./internal/ocr/ -v`
Expected: builds; the Task 3 and Task 5 tests still PASS.

- [ ] **Step 4: Commit**

```bash
git add internal/ocr/handler.go
git commit -m "feat(ocr): upload handler and async textract worker"
```

---

## Task 7: List, Get, File, Delete handlers

**Files:**
- Modify: `internal/ocr/handler.go`

- [ ] **Step 1: Add the handlers**

Append to `internal/ocr/handler.go`:

```go
// HandleList returns the tenant's documents, newest first.
func (h *Handler) HandleList(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	tenantUUID := pgtype.UUID{}
	if err := tenantUUID.Scan(claims.TenantID); err != nil {
		http.Error(w, "invalid tenant context", http.StatusBadRequest)
		return
	}

	docs, err := h.queries.ListOCRDocuments(r.Context(), tenantUUID)
	if err != nil {
		http.Error(w, "failed to list documents", http.StatusInternalServerError)
		return
	}
	result := make([]documentResponse, 0, len(docs))
	for _, d := range docs {
		result = append(result, toDocumentResponse(d))
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}

func (h *Handler) loadDocument(r *http.Request) (database.OcrDocument, pgtype.UUID, pgtype.UUID, error) {
	claims := auth.ClaimsFromContext(r.Context())
	docUUID := pgtype.UUID{}
	tenantUUID := pgtype.UUID{}
	if claims == nil {
		return database.OcrDocument{}, docUUID, tenantUUID, fmt.Errorf("unauthorized")
	}
	if err := docUUID.Scan(chi.URLParam(r, "id")); err != nil {
		return database.OcrDocument{}, docUUID, tenantUUID, fmt.Errorf("invalid document id")
	}
	if err := tenantUUID.Scan(claims.TenantID); err != nil {
		return database.OcrDocument{}, docUUID, tenantUUID, fmt.Errorf("invalid tenant context")
	}
	doc, err := h.queries.GetOCRDocument(r.Context(), database.GetOCRDocumentParams{ID: docUUID, TenantID: tenantUUID})
	if err != nil {
		return database.OcrDocument{}, docUUID, tenantUUID, fmt.Errorf("not found")
	}
	return doc, docUUID, tenantUUID, nil
}

// HandleGet returns one document (the frontend polls this while extracting).
func (h *Handler) HandleGet(w http.ResponseWriter, r *http.Request) {
	doc, _, _, err := h.loadDocument(r)
	if err != nil {
		http.Error(w, err.Error(), statusForLoadError(err))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(toDocumentResponse(doc))
}

// HandleFile streams the original uploaded file from S3.
func (h *Handler) HandleFile(w http.ResponseWriter, r *http.Request) {
	doc, _, _, err := h.loadDocument(r)
	if err != nil {
		http.Error(w, err.Error(), statusForLoadError(err))
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	key := documentS3Key(claims.TenantID, uuidToString(doc.ID), doc.OriginalFilename)
	body, contentType, err := h.client.GetObject(r.Context(), key)
	if err != nil {
		http.Error(w, "file not found", http.StatusNotFound)
		return
	}
	defer body.Close()
	if contentType == "" {
		contentType = doc.ContentType
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", doc.OriginalFilename))
	_, _ = io.Copy(w, body)
}

// HandleDelete removes the document row and its S3 object.
func (h *Handler) HandleDelete(w http.ResponseWriter, r *http.Request) {
	doc, docUUID, tenantUUID, err := h.loadDocument(r)
	if err != nil {
		http.Error(w, err.Error(), statusForLoadError(err))
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	key := documentS3Key(claims.TenantID, uuidToString(doc.ID), doc.OriginalFilename)
	if delErr := h.client.DeleteObject(r.Context(), key); delErr != nil {
		log.Printf("ocr delete s3 object error for document %s: %v", uuidToString(doc.ID), delErr)
	}
	rows, err := h.queries.DeleteOCRDocument(r.Context(), database.DeleteOCRDocumentParams{ID: docUUID, TenantID: tenantUUID})
	if err != nil || rows == 0 {
		http.Error(w, "failed to delete document", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func statusForLoadError(err error) int {
	switch err.Error() {
	case "unauthorized":
		return http.StatusUnauthorized
	case "not found":
		return http.StatusNotFound
	default:
		return http.StatusBadRequest
	}
}
```

- [ ] **Step 2: Verify it compiles**

Run: `go build ./...`
Expected: builds with no error.

- [ ] **Step 3: Commit**

```bash
git add internal/ocr/handler.go
git commit -m "feat(ocr): list/get/file/delete document handlers"
```

---

## Task 8: Process handler (spawn scribe session, reuse pipeline)

**Files:**
- Modify: `internal/ocr/handler.go`

- [ ] **Step 1: Add the process request type and handler**

Append to `internal/ocr/handler.go`:

```go
type processRequest struct {
	PatientID     string `json:"patient_id"`
	AppointmentID string `json:"appointment_id"`
	DepartmentID  string `json:"department_id"`
}

func (req processRequest) validate() error {
	if req.PatientID == "" {
		return fmt.Errorf("patient_id required")
	}
	if req.AppointmentID == "" {
		return fmt.Errorf("appointment_id required")
	}
	if req.DepartmentID == "" {
		return fmt.Errorf("department_id required")
	}
	return nil
}

type processResponse struct {
	ScribeSessionID string `json:"scribe_session_id"`
}

// HandleProcess promotes an extracted document into the scribe pipeline: it
// creates a scribe_session seeded with the OCR text as transcript plus the chosen
// patient binding, runs the existing processor, and links the session back to the
// document. The created session is excluded from the scribe list (document_id IS
// NOT NULL); the client navigates to /scribe/sessions/:id to review it.
func (h *Handler) HandleProcess(w http.ResponseWriter, r *http.Request) {
	doc, docUUID, tenantUUID, err := h.loadDocument(r)
	if err != nil {
		http.Error(w, err.Error(), statusForLoadError(err))
		return
	}
	if doc.Status != "extracted" || !doc.ExtractedText.Valid {
		http.Error(w, "document is not ready to process", http.StatusBadRequest)
		return
	}
	if doc.ScribeSessionID.Valid {
		http.Error(w, "document already processed", http.StatusBadRequest)
		return
	}

	var req processRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if err := req.validate(); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	session, err := h.queries.CreateDocumentScribeSession(r.Context(), database.CreateDocumentScribeSessionParams{
		TenantID:      tenantUUID,
		UserID:        doc.UserID,
		PatientID:     req.PatientID,
		AppointmentID: req.AppointmentID,
		DepartmentID:  req.DepartmentID,
		Transcript:    pgtype.Text{String: doc.ExtractedText.String, Valid: true},
		DocumentID:    docUUID,
	})
	if err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}

	// Link the document to its session immediately so the UI can navigate even if
	// processing then fails.
	_ = h.queries.SetOCRDocumentScribeSession(r.Context(), database.SetOCRDocumentScribeSessionParams{
		ID:              docUUID,
		TenantID:        tenantUUID,
		ScribeSessionID: session.ID,
	})

	result, procErr := h.processor.Process(r.Context(), h.cfg.AthenaPracticeID, req.PatientID, doc.ExtractedText.String)
	if procErr != nil {
		log.Printf("ocr process error for document %s: %v", uuidToString(docUUID), procErr)
		_ = h.queries.UpdateScribeSessionError(r.Context(), database.UpdateScribeSessionErrorParams{
			ID:           session.ID,
			TenantID:     tenantUUID,
			ErrorMessage: pgtype.Text{String: procErr.Error(), Valid: true},
		})
		http.Error(w, "processing failed", http.StatusInternalServerError)
		return
	}

	outputJSON, _ := json.Marshal(result.Output)
	if err := h.queries.UpdateScribeSessionComplete(r.Context(), database.UpdateScribeSessionCompleteParams{
		ID:       session.ID,
		TenantID: tenantUUID,
		AiOutput: outputJSON,
	}); err != nil {
		http.Error(w, "failed to save results", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(processResponse{ScribeSessionID: uuidToString(session.ID)})
}
```

> Note: `CreateDocumentScribeSession` returns the same column set as `CreateScribeSession`; confirm the generated param field names (`Transcript`, `DocumentID`, `AppointmentID`, etc.) with `grep -n "CreateDocumentScribeSessionParams" internal/database/*.go` and adjust if sqlc named them differently.

- [ ] **Step 2: Verify it compiles**

Run: `go build ./... && go test ./internal/ocr/ -v`
Expected: builds; existing OCR unit tests PASS.

- [ ] **Step 3: Commit**

```bash
git add internal/ocr/handler.go
git commit -m "feat(ocr): process document into scribe pipeline"
```

---

## Task 9: Wire OCR handler into the server

**Files:**
- Modify: `internal/server/server.go`
- Modify: `cmd/janushc-dash/main.go`

- [ ] **Step 1: Add the field and constructor param in server.go**

In `internal/server/server.go`:

1. Add the import: `"github.com/andybarilla/janushc-dash/internal/ocr"`.
2. Add a field to the `Server` struct after `scribeHandler   *scribe.Handler`:

```go
	ocrHandler      *ocr.Handler
```

3. Update the `New` signature to add `ocrHandler *ocr.Handler` as the final parameter, and set it in the struct literal:

```go
func New(cfg *config.Config, db *pgxpool.Pool, queries *database.Queries, authHandler *auth.Handler, approvalHandler *approval.Handler, usersHandler *users.Handler, scribeHandler *scribe.Handler, ocrHandler *ocr.Handler) *Server {
	s := &Server{
		cfg:             cfg,
		db:              db,
		router:          chi.NewRouter(),
		queries:         queries,
		authHandler:     authHandler,
		approvalHandler: approvalHandler,
		usersHandler:    usersHandler,
		scribeHandler:   scribeHandler,
		ocrHandler:      ocrHandler,
	}
	s.setupMiddleware()
	s.routes()
	return s
}
```

- [ ] **Step 2: Add the routes**

In `internal/server/server.go`, inside the protected `r.Group(...)` block (after the scribe routes, before the closing brace), add:

```go
		r.With(middleware.Timeout(5*time.Minute)).Post("/api/ocr/documents", s.ocrHandler.HandleUpload)
		r.Get("/api/ocr/documents", s.ocrHandler.HandleList)
		r.Get("/api/ocr/documents/{id}", s.ocrHandler.HandleGet)
		r.Get("/api/ocr/documents/{id}/file", s.ocrHandler.HandleFile)
		r.Delete("/api/ocr/documents/{id}", s.ocrHandler.HandleDelete)
		r.With(middleware.Timeout(5*time.Minute)).Post("/api/ocr/documents/{id}/process", s.ocrHandler.HandleProcess)
```

- [ ] **Step 3: Construct the OCR client + handler in main.go**

In `cmd/janushc-dash/main.go`:

1. Add the import: `"github.com/andybarilla/janushc-dash/internal/ocr"`.
2. After the scribe handler is created (the `scribeHandler := scribe.NewHandler(...)` line, ~line 151), add:

```go
	// OCR document upload reuses the transcribe S3 bucket (ocr/ prefix) and the
	// scribe processor for the optional clinical-note pipeline.
	ocrClient, err := ocr.NewClient(context.Background(), cfg.AWSRegion, cfg.AWSTranscribeBucket)
	if err != nil {
		log.Fatalf("failed to create OCR client: %v", err)
	}
	ocrHandler := ocr.NewHandler(queries, scribeProcessor, ocrClient, cfg)
```

3. Update the `server.New(...)` call (~line 154) to pass `ocrHandler` as the final argument:

```go
	srv := server.New(cfg, pool, queries, authHandler, approvalHandler, usersHandler, scribeHandler, ocrHandler)
```

- [ ] **Step 4: Verify the whole backend compiles and tests pass**

Run: `go build ./... && go test ./...`
Expected: builds; all tests PASS (no regressions in scribe/transcribe).

- [ ] **Step 5: Commit**

```bash
git add internal/server/server.go cmd/janushc-dash/main.go
git commit -m "feat(ocr): wire ocr handler and routes"
```

---

## Task 10: Frontend API hooks

**Files:**
- Create: `frontend/src/lib/ocr-queries.ts`

- [ ] **Step 1: Write the hooks**

`frontend/src/lib/ocr-queries.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export type DocumentStatus = "uploaded" | "extracting" | "extracted" | "error";

export interface OcrDocument {
  id: string;
  original_filename: string;
  content_type: string;
  status: DocumentStatus;
  error_message?: string;
  extracted_text?: string;
  scribe_session_id?: string;
  created_at: string;
}

export interface ProcessDocumentInput {
  id: string;
  patient_id: string;
  appointment_id: string;
  department_id: string;
}

export interface ProcessDocumentResult {
  scribe_session_id: string;
}

export const documentsQueryKey = ["ocrDocuments"] as const;

function anyExtracting(docs: OcrDocument[] | undefined): boolean {
  return !!docs?.some((d) => d.status === "extracting" || d.status === "uploaded");
}

export function useDocuments() {
  return useQuery({
    queryKey: documentsQueryKey,
    queryFn: () => api.fetch<OcrDocument[]>("/api/ocr/documents"),
    refetchInterval: (query) => (anyExtracting(query.state.data) ? 3000 : false),
  });
}

export function useDocument(id: string | null) {
  return useQuery({
    queryKey: ["ocrDocument", id],
    queryFn: () => api.fetch<OcrDocument>(`/api/ocr/documents/${id}`),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "extracting" || status === "uploaded" ? 3000 : false;
    },
  });
}

export function useUploadDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("document", file);
      return api.upload<OcrDocument>("/api/ocr/documents", form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentsQueryKey });
    },
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.fetch<void>(`/api/ocr/documents/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentsQueryKey });
    },
  });
}

export function useProcessDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: ProcessDocumentInput) =>
      api.fetch<ProcessDocumentResult>(`/api/ocr/documents/${id}/process`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentsQueryKey });
    },
  });
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/ocr-queries.ts
git commit -m "feat(ocr): frontend api hooks for documents"
```

---

## Task 11: Documents page (list + detail + upload + process)

**Files:**
- Create: `frontend/src/pages/documents.tsx`

For the patient/appointment/department selectors, reuse the existing scribe hooks. Confirm their names first:

Run: `grep -n "export function use" frontend/src/lib/scribe-queries.ts`

The plan below assumes `useScribeDepartments()` (returns `{ id, name }[]`) and `useScribeAppointments(departmentId)` (returns `{ appointment_id, patient_id, patient_name }[]`). If the actual names/shapes differ, adapt the selector block accordingly — the page structure stays the same.

- [ ] **Step 1: Write the page**

`frontend/src/pages/documents.tsx`:

```tsx
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useDocuments,
  useDocument,
  useUploadDocument,
  useDeleteDocument,
  useProcessDocument,
  type OcrDocument,
} from "@/lib/ocr-queries";

export default function DocumentsPage() {
  const navigate = useNavigate();
  const { data: documents } = useDocuments();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const upload = useUploadDocument();
  const fileInput = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const created = await upload.mutateAsync(file);
    setSelectedId(created.id);
  };

  return (
    <div className="janus-scope" style={{ display: "flex", gap: 24, padding: 24 }}>
      <section style={{ flex: "0 0 320px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>Documents</h1>
          <button onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? "Uploading…" : "Upload"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff"
            style={{ display: "none" }}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {(documents ?? []).map((doc) => (
            <li key={doc.id}>
              <button
                onClick={() => setSelectedId(doc.id)}
                aria-current={doc.id === selectedId}
                style={{ display: "block", width: "100%", textAlign: "left", padding: 8 }}
              >
                <div>{doc.original_filename}</div>
                <small>{statusLabel(doc.status)}</small>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section style={{ flex: 1 }}>
        {selectedId ? (
          <DocumentDetail id={selectedId} onDeleted={() => setSelectedId(null)} onProcessed={(sid) => navigate(`/scribe/sessions/${sid}`)} />
        ) : (
          <p>Select a document, or upload a new one.</p>
        )}
      </section>
    </div>
  );
}

function statusLabel(status: OcrDocument["status"]): string {
  switch (status) {
    case "uploaded":
    case "extracting":
      return "Extracting…";
    case "extracted":
      return "Ready";
    case "error":
      return "Error";
  }
}

function DocumentDetail({
  id,
  onDeleted,
  onProcessed,
}: {
  id: string;
  onDeleted: () => void;
  onProcessed: (scribeSessionId: string) => void;
}) {
  const { data: doc } = useDocument(id);
  const del = useDeleteDocument();
  const [showProcess, setShowProcess] = useState(false);

  if (!doc) return <p>Loading…</p>;

  const download = () => {
    const blob = new Blob([doc.extracted_text ?? ""], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.original_filename}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>{doc.original_filename}</h2>
        <button
          onClick={async () => {
            await del.mutateAsync(doc.id);
            onDeleted();
          }}
        >
          Delete
        </button>
      </header>

      {doc.status === "error" && <p role="alert">OCR failed: {doc.error_message}</p>}
      {(doc.status === "uploaded" || doc.status === "extracting") && <p>Extracting text…</p>}

      {doc.status === "extracted" && (
        <>
          <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
            <button onClick={() => navigator.clipboard.writeText(doc.extracted_text ?? "")}>Copy</button>
            <button onClick={download}>Download</button>
            <a href={`/api/ocr/documents/${doc.id}/file`} target="_blank" rel="noreferrer">
              View original
            </a>
            {doc.scribe_session_id ? (
              <button onClick={() => onProcessed(doc.scribe_session_id!)}>Open note</button>
            ) : (
              <button onClick={() => setShowProcess((v) => !v)}>Process</button>
            )}
          </div>
          <pre style={{ whiteSpace: "pre-wrap", border: "1px solid var(--janus-border, #333)", padding: 12 }}>
            {doc.extracted_text}
          </pre>
          {showProcess && !doc.scribe_session_id && (
            <ProcessForm documentId={doc.id} onProcessed={onProcessed} />
          )}
        </>
      )}
    </div>
  );
}

function ProcessForm({
  documentId,
  onProcessed,
}: {
  documentId: string;
  onProcessed: (scribeSessionId: string) => void;
}) {
  const process = useProcessDocument();
  const [patientId, setPatientId] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
  const [departmentId, setDepartmentId] = useState("");

  const submit = async () => {
    const result = await process.mutateAsync({
      id: documentId,
      patient_id: patientId,
      appointment_id: appointmentId,
      department_id: departmentId,
    });
    onProcessed(result.scribe_session_id);
  };

  // Replace these three inputs with the scribe department/appointment selectors
  // (see grep step above). They set departmentId, appointmentId, and patientId.
  return (
    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8, maxWidth: 360 }}>
      <input placeholder="Department ID" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} />
      <input placeholder="Appointment ID" value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)} />
      <input placeholder="Patient ID" value={patientId} onChange={(e) => setPatientId(e.target.value)} />
      <button onClick={submit} disabled={process.isPending || !patientId || !appointmentId || !departmentId}>
        {process.isPending ? "Processing…" : "Process into note"}
      </button>
      {process.isError && <p role="alert">Processing failed.</p>}
    </div>
  );
}
```

> The bare text inputs in `ProcessForm` are a deliberate first pass. Before marking this task done, replace them with the scribe department + appointment selectors found in the grep step so the user picks from real Athena data; setting `patientId` from the chosen appointment.

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/documents.tsx
git commit -m "feat(ocr): documents page with upload, detail, and process"
```

---

## Task 12: Route + navigation entry

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/app-shell.tsx`

- [ ] **Step 1: Register the route**

In `frontend/src/App.tsx`:

1. Add the import after `import ScribePage from "@/pages/scribe";`:

```tsx
import DocumentsPage from "@/pages/documents";
```

2. Add the route inside the authenticated layout, after the `/scribe/*` route:

```tsx
          <Route path="/documents/*" element={<DocumentsPage />} />
```

- [ ] **Step 2: Add the nav entry**

In `frontend/src/components/layout/app-shell.tsx`:

1. Add `ScanText` to the existing `lucide-react` import (find the line importing `FileText`, `Mic`, etc., and add `ScanText`).
2. Add a "Documents" entry to the `MODULE_LABEL_BY_PATH` map:

```tsx
  "/documents": "Documents",
```

3. Add a nav entry to the `items` array, right after the `scribe` entry:

```tsx
    { id: "documents", label: "Documents", icon: ScanText, section: "workspace", path: "/documents" },
```

- [ ] **Step 3: Build the frontend**

Run: `cd frontend && npm run build`
Expected: `tsc -b` and `vite build` both succeed with no error.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/layout/app-shell.tsx
git commit -m "feat(ocr): documents route and nav entry"
```

---

## Task 13: Frontend component test

**Files:**
- Create: `frontend/src/pages/documents.test.tsx`

- [ ] **Step 1: Write the test**

`frontend/src/pages/documents.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import DocumentsPage from "./documents";

const mocks = vi.hoisted(() => ({
  useDocuments: vi.fn(),
  useDocument: vi.fn(),
  useUploadDocument: vi.fn(),
  useDeleteDocument: vi.fn(),
  useProcessDocument: vi.fn(),
}));

vi.mock("@/lib/ocr-queries", () => ({
  useDocuments: mocks.useDocuments,
  useDocument: mocks.useDocument,
  useUploadDocument: mocks.useUploadDocument,
  useDeleteDocument: mocks.useDeleteDocument,
  useProcessDocument: mocks.useProcessDocument,
}));

beforeEach(() => {
  mocks.useDocuments.mockReturnValue({
    data: [
      { id: "doc-1", original_filename: "referral.pdf", content_type: "application/pdf", status: "extracted", created_at: "2026-06-10T00:00:00Z" },
      { id: "doc-2", original_filename: "labs.png", content_type: "image/png", status: "extracting", created_at: "2026-06-10T00:00:00Z" },
    ],
  });
  mocks.useDocument.mockReturnValue({ data: undefined });
  mocks.useUploadDocument.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
  mocks.useDeleteDocument.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
  mocks.useProcessDocument.mockReturnValue({ isPending: false, isError: false, mutateAsync: vi.fn() });
});

afterEach(() => cleanup());

describe("DocumentsPage", () => {
  it("lists documents with status labels", () => {
    render(
      <MemoryRouter>
        <DocumentsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("referral.pdf")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("labs.png")).toBeInTheDocument();
    expect(screen.getByText("Extracting…")).toBeInTheDocument();
  });

  it("prompts to select a document when none is chosen", () => {
    render(
      <MemoryRouter>
        <DocumentsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Select a document/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd frontend && npx vitest run src/pages/documents.test.tsx`
Expected: both tests PASS.

- [ ] **Step 3: Final full build + backend test**

Run: `cd frontend && npm run build` then `cd .. && go test ./...`
Expected: frontend build succeeds; all Go tests PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/documents.test.tsx
git commit -m "test(ocr): documents page component test"
```

---

## Manual verification (after all tasks)

Requires `AWS_TRANSCRIBE_BUCKET` set and AWS credentials with Textract + S3 permissions.

1. `make dev-servers`, log in, click **Documents** in the nav.
2. Upload a multi-page PDF. Confirm the list shows "Extracting…", then "Ready" after polling.
3. Open it: extracted text renders; **Copy**, **Download**, and **View original** work.
4. Click **Process**, pick department/appointment/patient, submit. Confirm you land on `/scribe/sessions/:id` with a populated note.
5. Confirm the new session does NOT appear in the Scribe list (it's document-originated).
6. Upload a `.txt` file → rejected with a 400 before any S3 write.
```
