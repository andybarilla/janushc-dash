# Scribe Audio Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a batch audio upload endpoint that transcribes audio via AWS Transcribe Medical and feeds the transcript into the existing scribe processing pipeline.

**Architecture:** New `internal/transcribe/` package wraps the AWS Transcribe Medical streaming SDK. The scribe handler gets a new `HandleUpload` endpoint that accepts multipart audio, converts it to FLAC via ffmpeg, streams it to Transcribe, then passes the transcript to the existing `Processor.Process()` pipeline. Frontend swaps the transcript textarea for a file input.

**Tech Stack:** AWS SDK Go v2 (`transcribestreaming`), ffmpeg (system dependency for audio conversion), Go `multipart`, React file input + FormData.

**Note on audio formats:** AWS Transcribe Medical streaming only supports PCM, OGG_OPUS, and FLAC natively. We use ffmpeg to convert all accepted formats (MP3, M4A, WAV, WebM, OGG) to FLAC before streaming. ffmpeg reads from stdin and writes to stdout — no temp files needed.

---

### Task 1: Add AWS Transcribe Streaming SDK dependency

**Files:**
- Modify: `go.mod`

- [ ] **Step 1: Add the dependency**

```bash
go get github.com/aws/aws-sdk-go-v2/service/transcribestreaming
```

- [ ] **Step 2: Verify it resolves**

```bash
go mod tidy
```

- [ ] **Step 3: Commit**

```bash
git add go.mod go.sum
git commit -m "deps: add aws transcribe streaming SDK"
```

---

### Task 2: Create transcribe client with Transcriber interface

**Files:**
- Create: `internal/transcribe/transcribe.go`
- Test: `internal/transcribe/transcribe_test.go`

- [ ] **Step 1: Write the failing test**

Create `internal/transcribe/transcribe_test.go`:

```go
package transcribe

import (
	"context"
	"strings"
	"testing"
)

// mockStream simulates the AWS Transcribe Medical streaming API.
// It returns a fixed transcript regardless of input audio.
type mockStream struct {
	transcript string
	err        error
}

func (m *mockStream) Transcribe(ctx context.Context, audio *AudioInput) (string, error) {
	if m.err != nil {
		return "", m.err
	}
	return m.transcript, nil
}

func TestTranscriberInterface(t *testing.T) {
	mock := &mockStream{transcript: "Provider: Hello. Patient: Hi."}
	var _ Transcriber = mock // compile-time interface check

	result, err := mock.Transcribe(context.Background(), &AudioInput{
		Reader:     strings.NewReader("fake audio"),
		SampleRate: 16000,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "Provider: Hello. Patient: Hi." {
		t.Errorf("unexpected transcript: %s", result)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
go test ./internal/transcribe/ -v -run TestTranscriberInterface
```

Expected: FAIL — `Transcriber` and `AudioInput` types not defined.

- [ ] **Step 3: Write the interface and types**

Create `internal/transcribe/transcribe.go`:

```go
package transcribe

import (
	"context"
	"io"
)

// AudioInput contains the audio data and metadata needed for transcription.
type AudioInput struct {
	Reader     io.Reader
	SampleRate int32
}

// Transcriber converts audio to text using a medical transcription service.
type Transcriber interface {
	Transcribe(ctx context.Context, audio *AudioInput) (string, error)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
go test ./internal/transcribe/ -v -run TestTranscriberInterface
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/transcribe/
git commit -m "feat(transcribe): add Transcriber interface and AudioInput type"
```

---

### Task 3: Implement AWS Transcribe Medical streaming client

**Files:**
- Create: `internal/transcribe/aws.go`
- Modify: `internal/transcribe/transcribe_test.go`

- [ ] **Step 1: Write the failing test for Client construction**

Add to `internal/transcribe/transcribe_test.go`:

```go
func TestNewClient(t *testing.T) {
	client, err := NewClient(context.Background(), "us-east-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if client == nil {
		t.Fatal("expected non-nil client")
	}
	var _ Transcriber = client // compile-time interface check
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
go test ./internal/transcribe/ -v -run TestNewClient
```

Expected: FAIL — `NewClient` not defined.

- [ ] **Step 3: Implement the AWS client**

Create `internal/transcribe/aws.go`:

```go
package transcribe

import (
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/transcribestreaming"
	"github.com/aws/aws-sdk-go-v2/service/transcribestreaming/types"
)

const chunkSize = 8192 // 8KB chunks for streaming audio

// Client wraps the AWS Transcribe Medical streaming API.
type Client struct {
	streaming *transcribestreaming.Client
}

// NewClient creates a new AWS Transcribe Medical streaming client.
func NewClient(ctx context.Context, region string) (*Client, error) {
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("load AWS config: %w", err)
	}
	return &Client{
		streaming: transcribestreaming.NewFromConfig(cfg),
	}, nil
}

// Transcribe streams audio to AWS Transcribe Medical and returns the transcript.
// The audio in AudioInput.Reader must be FLAC-encoded (use ffmpeg to convert beforehand).
func (c *Client) Transcribe(ctx context.Context, audio *AudioInput) (string, error) {
	resp, err := c.streaming.StartMedicalStreamTranscription(ctx, &transcribestreaming.StartMedicalStreamTranscriptionInput{
		LanguageCode:         types.LanguageCodeEnUs,
		MediaEncoding:        types.MediaEncodingFlac,
		MediaSampleRateHertz: aws.Int32(audio.SampleRate),
		Specialty:            types.SpecialtyPrimaryCare,
		Type:                 types.TypeDictation,
	})
	if err != nil {
		return "", fmt.Errorf("start medical stream transcription: %w", err)
	}

	stream := resp.GetStream()
	defer stream.Close()

	// Send audio chunks in a goroutine
	sendErr := make(chan error, 1)
	go func() {
		defer stream.Close()
		buf := make([]byte, chunkSize)
		for {
			n, readErr := audio.Reader.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				if err := stream.Send(ctx, &types.AudioStreamMemberAudioEvent{
					Value: types.AudioEvent{AudioChunk: chunk},
				}); err != nil {
					sendErr <- fmt.Errorf("send audio chunk: %w", err)
					return
				}
			}
			if readErr != nil {
				break
			}
		}
		sendErr <- nil
	}()

	// Collect transcript from results
	var transcript strings.Builder
	for event := range stream.Events() {
		switch v := event.(type) {
		case *types.MedicalTranscriptResultStreamMemberTranscriptEvent:
			for _, result := range v.Value.Transcript.Results {
				if result.IsPartial {
					continue
				}
				for _, alt := range result.Alternatives {
					if alt.Transcript != nil {
						transcript.WriteString(*alt.Transcript)
						transcript.WriteString(" ")
					}
				}
			}
		}
	}

	if err := <-sendErr; err != nil {
		return "", err
	}
	if err := stream.Err(); err != nil {
		return "", fmt.Errorf("stream error: %w", err)
	}

	return strings.TrimSpace(transcript.String()), nil
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
go test ./internal/transcribe/ -v -run TestNewClient
```

Expected: PASS (constructor test only — actual transcription requires AWS credentials).

- [ ] **Step 5: Commit**

```bash
git add internal/transcribe/aws.go
git commit -m "feat(transcribe): implement AWS Transcribe Medical streaming client"
```

---

### Task 4: Add ffmpeg audio conversion utility

**Files:**
- Create: `internal/transcribe/convert.go`
- Modify: `internal/transcribe/transcribe_test.go`

- [ ] **Step 1: Write the failing test**

Add to `internal/transcribe/transcribe_test.go`:

```go
func TestDetectSampleRate(t *testing.T) {
	tests := []struct {
		ext  string
		rate int32
	}{
		{".mp3", 0},
		{".m4a", 0},
		{".wav", 0},
		{".webm", 0},
		{".ogg", 0},
	}
	for _, tt := range tests {
		t.Run(tt.ext, func(t *testing.T) {
			// Just verify the function exists and returns a positive rate
			rate := DefaultSampleRate()
			if rate <= 0 {
				t.Errorf("expected positive sample rate, got %d", rate)
			}
		})
	}
}

func TestValidateAudioExtension(t *testing.T) {
	valid := []string{".mp3", ".m4a", ".wav", ".webm", ".ogg"}
	for _, ext := range valid {
		if err := ValidateAudioExtension(ext); err != nil {
			t.Errorf("expected %s to be valid, got error: %v", ext, err)
		}
	}

	invalid := []string{".txt", ".pdf", ".exe", ".jpg", ""}
	for _, ext := range invalid {
		if err := ValidateAudioExtension(ext); err == nil {
			t.Errorf("expected %s to be invalid", ext)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
go test ./internal/transcribe/ -v -run "TestDetectSampleRate|TestValidateAudioExtension"
```

Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement the conversion utility**

Create `internal/transcribe/convert.go`:

```go
package transcribe

import (
	"fmt"
	"io"
	"os/exec"
	"strings"
)

var allowedExtensions = map[string]bool{
	".mp3":  true,
	".m4a":  true,
	".wav":  true,
	".webm": true,
	".ogg":  true,
}

// DefaultSampleRate returns the sample rate used for transcription output.
// AWS Transcribe Medical works well with 16kHz for speech.
func DefaultSampleRate() int32 {
	return 16000
}

// ValidateAudioExtension checks if the file extension is an accepted audio format.
func ValidateAudioExtension(ext string) error {
	if !allowedExtensions[strings.ToLower(ext)] {
		return fmt.Errorf("unsupported audio format %q: accepted formats are .mp3, .m4a, .wav, .webm, .ogg", ext)
	}
	return nil
}

// ConvertToFLAC converts audio from any supported format to FLAC via ffmpeg.
// Reads from src and returns a reader of FLAC-encoded audio at 16kHz mono.
// The caller must call the returned cleanup function when done reading.
func ConvertToFLAC(src io.Reader) (io.ReadCloser, func(), error) {
	cmd := exec.Command("ffmpeg",
		"-i", "pipe:0",
		"-f", "flac",
		"-ar", "16000",
		"-ac", "1",
		"pipe:1",
	)
	cmd.Stdin = src

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, nil, fmt.Errorf("ffmpeg stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, nil, fmt.Errorf("start ffmpeg: %w", err)
	}

	cleanup := func() {
		stdout.Close()
		cmd.Wait()
	}

	return stdout, cleanup, nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
go test ./internal/transcribe/ -v -run "TestDetectSampleRate|TestValidateAudioExtension"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/transcribe/convert.go internal/transcribe/transcribe_test.go
git commit -m "feat(transcribe): add audio format validation and ffmpeg conversion"
```

---

### Task 5: Add HandleUpload to scribe handler

**Files:**
- Modify: `internal/scribe/handler.go`
- Modify: `internal/scribe/handler_test.go`

- [ ] **Step 1: Write the failing tests for upload validation**

Add to `internal/scribe/handler_test.go`:

```go
import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestValidateUpload_MissingFile(t *testing.T) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/scribe/sessions/fake-id/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	_, _, err := parseAudioUpload(req, 100<<20)
	if err == nil {
		t.Error("expected error for missing audio file")
	}
}

func TestValidateUpload_InvalidExtension(t *testing.T) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, _ := writer.CreateFormFile("audio", "notes.txt")
	part.Write([]byte("not audio"))
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/scribe/sessions/fake-id/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	_, _, err := parseAudioUpload(req, 100<<20)
	if err == nil {
		t.Error("expected error for invalid file extension")
	}
}

func TestValidateUpload_ValidFile(t *testing.T) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, _ := writer.CreateFormFile("audio", "recording.mp3")
	part.Write([]byte("fake mp3 data"))
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/scribe/sessions/fake-id/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	file, ext, err := parseAudioUpload(req, 100<<20)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer file.Close()
	if ext != ".mp3" {
		t.Errorf("expected .mp3, got %s", ext)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
go test ./internal/scribe/ -v -run "TestValidateUpload"
```

Expected: FAIL — `parseAudioUpload` not defined.

- [ ] **Step 3: Implement parseAudioUpload and HandleUpload**

Add to `internal/scribe/handler.go`:

Add these imports to the existing import block:

```go
"io"
"mime/multipart"
"path/filepath"
"strings"

"github.com/andybarilla/janushc-dash/internal/transcribe"
```

Add a `transcriber` field to the Handler struct and update the constructor:

```go
type Handler struct {
	queries    *database.Queries
	processor  *Processor
	cfg        *config.Config
	transcriber transcribe.Transcriber
}

func NewHandler(queries *database.Queries, processor *Processor, cfg *config.Config, transcriber transcribe.Transcriber) *Handler {
	return &Handler{queries: queries, processor: processor, cfg: cfg, transcriber: transcriber}
}
```

Add the upload parsing and handler functions:

```go
const maxUploadSize = 100 << 20 // 100 MB

// parseAudioUpload extracts and validates the audio file from a multipart request.
// Returns the file, its lowercase extension, and any validation error.
func parseAudioUpload(r *http.Request, maxSize int64) (multipart.File, string, error) {
	r.Body = http.MaxBytesReader(nil, r.Body, maxSize)

	file, header, err := r.FormFile("audio")
	if err != nil {
		return nil, "", fmt.Errorf("missing or invalid audio file: %w", err)
	}

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if err := transcribe.ValidateAudioExtension(ext); err != nil {
		file.Close()
		return nil, "", err
	}

	return file, ext, nil
}

func (h *Handler) HandleUpload(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	sessionID := chi.URLParam(r, "id")
	sessionUUID := pgtype.UUID{}
	if err := sessionUUID.Scan(sessionID); err != nil {
		http.Error(w, "invalid session ID", http.StatusBadRequest)
		return
	}
	tenantUUID := pgtype.UUID{}
	if err := tenantUUID.Scan(claims.TenantID); err != nil {
		http.Error(w, "invalid tenant context", http.StatusBadRequest)
		return
	}

	// Verify session exists and belongs to tenant
	session, err := h.queries.GetScribeSession(r.Context(), database.GetScribeSessionParams{
		ID:       sessionUUID,
		TenantID: tenantUUID,
	})
	if err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	if session.Status == "complete" {
		http.Error(w, "session already complete", http.StatusBadRequest)
		return
	}

	// Parse and validate the uploaded audio file
	file, _, err := parseAudioUpload(r, maxUploadSize)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Convert to FLAC via ffmpeg
	flacReader, cleanup, err := transcribe.ConvertToFLAC(file)
	if err != nil {
		http.Error(w, "failed to convert audio", http.StatusInternalServerError)
		return
	}
	defer cleanup()

	// Transcribe the audio
	transcript, err := h.transcriber.Transcribe(r.Context(), &transcribe.AudioInput{
		Reader:     flacReader,
		SampleRate: transcribe.DefaultSampleRate(),
	})
	if err != nil {
		log.Printf("scribe transcription error for session %s: %v", sessionID, err)
		_ = h.queries.UpdateScribeSessionError(r.Context(), database.UpdateScribeSessionErrorParams{
			ID:           sessionUUID,
			TenantID:     tenantUUID,
			ErrorMessage: pgtype.Text{String: fmt.Sprintf("transcription failed: %v", err), Valid: true},
		})
		http.Error(w, "transcription failed", http.StatusInternalServerError)
		return
	}

	if transcript == "" {
		_ = h.queries.UpdateScribeSessionError(r.Context(), database.UpdateScribeSessionErrorParams{
			ID:           sessionUUID,
			TenantID:     tenantUUID,
			ErrorMessage: pgtype.Text{String: "transcription returned empty result", Valid: true},
		})
		http.Error(w, "transcription returned empty result", http.StatusInternalServerError)
		return
	}

	// Store transcript and mark processing
	err = h.queries.UpdateScribeSessionProcessing(r.Context(), database.UpdateScribeSessionProcessingParams{
		ID:         sessionUUID,
		TenantID:   tenantUUID,
		Transcript: pgtype.Text{String: transcript, Valid: true},
	})
	if err != nil {
		http.Error(w, "failed to update session", http.StatusInternalServerError)
		return
	}

	// Run the AI pipeline
	output, err := h.processor.Process(r.Context(), h.cfg.AthenaPracticeID, session.PatientID, transcript)
	if err != nil {
		log.Printf("scribe process error for session %s: %v", sessionID, err)
		_ = h.queries.UpdateScribeSessionError(r.Context(), database.UpdateScribeSessionErrorParams{
			ID:           sessionUUID,
			TenantID:     tenantUUID,
			ErrorMessage: pgtype.Text{String: err.Error(), Valid: true},
		})
		http.Error(w, "processing failed", http.StatusInternalServerError)
		return
	}

	// Store AI output
	outputJSON, _ := json.Marshal(output)
	err = h.queries.UpdateScribeSessionComplete(r.Context(), database.UpdateScribeSessionCompleteParams{
		ID:       sessionUUID,
		TenantID: tenantUUID,
		AiOutput: outputJSON,
	})
	if err != nil {
		http.Error(w, "failed to save results", http.StatusInternalServerError)
		return
	}

	// Write to athena (non-blocking)
	if writeErr := h.processor.WriteToAthena(r.Context(), h.cfg.AthenaPracticeID, session.EncounterID, output); writeErr != nil {
		log.Printf("scribe athena write error for session %s: %v", sessionID, writeErr)
	}

	// Re-fetch session to return updated state
	updated, err := h.queries.GetScribeSession(r.Context(), database.GetScribeSessionParams{
		ID:       sessionUUID,
		TenantID: tenantUUID,
	})
	if err != nil {
		http.Error(w, "failed to fetch updated session", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(toSessionResponse(updated))
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
go test ./internal/scribe/ -v -run "TestValidateUpload"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/scribe/handler.go internal/scribe/handler_test.go
git commit -m "feat(scribe): add HandleUpload endpoint with audio validation"
```

---

### Task 6: Wire transcribe client and upload route

**Files:**
- Modify: `cmd/janushc-dash/main.go`
- Modify: `internal/server/server.go`

- [ ] **Step 1: Update main.go to create transcribe client**

In `cmd/janushc-dash/main.go`, add the import:

```go
"github.com/andybarilla/janushc-dash/internal/transcribe"
```

After the bedrock client creation (line 61), add:

```go
// Create transcribe client
transcribeClient, err := transcribe.NewClient(context.Background(), cfg.AWSRegion)
if err != nil {
	log.Fatalf("failed to create transcribe client: %v", err)
}
```

Update the scribe handler construction to pass the transcriber:

```go
scribeHandler := scribe.NewHandler(queries, scribeProcessor, cfg, transcribeClient)
```

- [ ] **Step 2: Add the upload route in server.go**

In `internal/server/server.go`, add the upload route after line 82 (the existing process route), wrapped in a timeout middleware for the 5-minute limit:

```go
r.With(middleware.Timeout(5 * time.Minute)).Post("/api/scribe/sessions/{id}/upload", s.scribeHandler.HandleUpload)
```

Add `"time"` to the imports in `server.go` if not already present.

- [ ] **Step 3: Verify the project compiles**

```bash
go build ./...
```

Expected: builds successfully.

- [ ] **Step 4: Run all existing tests**

```bash
go test ./...
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add cmd/janushc-dash/main.go internal/server/server.go
git commit -m "feat(scribe): wire transcribe client and upload route"
```

---

### Task 7: Add FormData support to frontend API client

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add the upload method to ApiClient**

In `frontend/src/lib/api.ts`, add this method to the `ApiClient` class after the existing `fetch<T>` method:

```ts
async upload<T>(path: string, formData: FormData): Promise<T> {
  const headers: Record<string, string> = {};

  const token = this.getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Do NOT set Content-Type — the browser sets it with the multipart boundary
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (res.status === 401) {
    this.setToken(null);
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const text = await res.text();
    const err: ApiError = { status: res.status, message: text };
    throw err;
  }

  return res.json();
}
```

- [ ] **Step 2: Verify the frontend builds**

```bash
cd frontend && npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(api): add FormData upload method to API client"
```

---

### Task 8: Add useUploadScribeAudio query hook

**Files:**
- Modify: `frontend/src/lib/scribe-queries.ts`

- [ ] **Step 1: Add the upload mutation hook**

Add to the end of `frontend/src/lib/scribe-queries.ts`:

```ts
export function useUploadScribeAudio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => {
      const formData = new FormData();
      formData.append("audio", file);
      return api.upload<ScribeSession>(
        `/api/scribe/sessions/${id}/upload`,
        formData
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scribeSessions"] });
    },
  });
}
```

- [ ] **Step 2: Verify the frontend builds**

```bash
cd frontend && npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/scribe-queries.ts
git commit -m "feat(scribe): add useUploadScribeAudio mutation hook"
```

---

### Task 9: Update scribe page to use file upload

**Files:**
- Modify: `frontend/src/pages/scribe.tsx`

- [ ] **Step 1: Replace transcript textarea with file input**

Replace the full contents of `frontend/src/pages/scribe.tsx` with:

```tsx
import { useRef, useState } from "react";
import {
  useScribeSessions,
  useCreateScribeSession,
  useUploadScribeAudio,
} from "@/lib/scribe-queries";
import { Button } from "@/components/ui/button";

const ACCEPTED_FORMATS = ".mp3,.m4a,.wav,.webm,.ogg";

export default function ScribePage() {
  const [patientId, setPatientId] = useState("");
  const [encounterId, setEncounterId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [activeSessionId, setActiveSessionId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: sessions = [], isLoading } = useScribeSessions();
  const createSession = useCreateScribeSession();
  const uploadAudio = useUploadScribeAudio();

  const handleCreate = async () => {
    const session = await createSession.mutateAsync({
      patient_id: patientId,
      encounter_id: encounterId,
      department_id: departmentId,
    });
    setActiveSessionId(session.id);
  };

  const handleUpload = async () => {
    if (!activeSessionId || !selectedFile) return;
    await uploadAudio.mutateAsync({
      id: activeSessionId,
      file: selectedFile,
    });
    setSelectedFile(null);
    setActiveSessionId("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const statusColor: Record<string, string> = {
    processing: "text-yellow-500",
    complete: "text-green-500",
    error: "text-red-500",
    recording: "text-blue-500",
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h2 className="text-lg font-semibold">Scribe</h2>

      <div className="space-y-3 bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-medium text-muted-foreground">
          {activeSessionId ? "Upload Audio" : "New Session"}
        </h3>

        {!activeSessionId ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                placeholder="Patient ID"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <input
                type="text"
                placeholder="Encounter ID"
                value={encounterId}
                onChange={(e) => setEncounterId(e.target.value)}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <input
                type="text"
                placeholder="Department ID"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="bg-background border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <Button
              onClick={handleCreate}
              disabled={
                !patientId ||
                !encounterId ||
                !departmentId ||
                createSession.isPending
              }
              size="sm"
            >
              {createSession.isPending ? "Creating..." : "Create Session"}
            </Button>
          </>
        ) : (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FORMATS}
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border file:border-border file:text-sm file:font-medium file:bg-background file:text-foreground hover:file:bg-muted"
            />
            {selectedFile && (
              <p className="text-xs text-muted-foreground">
                {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)
              </p>
            )}
            <div className="flex gap-2">
              <Button
                onClick={handleUpload}
                disabled={!selectedFile || uploadAudio.isPending}
                size="sm"
              >
                {uploadAudio.isPending
                  ? "Transcribing & Processing..."
                  : "Upload & Process"}
              </Button>
              <Button
                onClick={() => {
                  setActiveSessionId("");
                  setSelectedFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                variant="outline"
                size="sm"
              >
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">
          Session History
        </h3>
        {isLoading ? (
          <div className="text-center text-muted-foreground py-8">
            Loading...
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            No sessions yet.
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="bg-card border border-border rounded-lg p-3 flex items-center justify-between"
              >
                <div className="space-y-1">
                  <div className="text-sm">
                    Patient {session.patient_id} — Encounter{" "}
                    {session.encounter_id}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(session.created_at).toLocaleString()}
                  </div>
                </div>
                <span
                  className={`text-xs font-medium ${statusColor[session.status] || ""}`}
                >
                  {session.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the frontend builds**

```bash
cd frontend && npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/scribe.tsx
git commit -m "feat(scribe): replace transcript textarea with audio file upload"
```

---

### Task 10: Remove unused process imports from frontend

**Files:**
- Modify: `frontend/src/pages/scribe.tsx`
- Modify: `frontend/src/lib/scribe-queries.ts`

- [ ] **Step 1: Verify useProcessScribeSession is no longer imported in scribe.tsx**

The page rewrite in Task 9 already removed the `useProcessScribeSession` import. Verify by checking the file no longer references it.

- [ ] **Step 2: Verify the frontend builds cleanly**

```bash
cd frontend && npm run build
```

Expected: build succeeds with no warnings about unused imports.

- [ ] **Step 3: Commit (if any cleanup was needed)**

```bash
git add frontend/src/
git commit -m "chore: clean up unused scribe process imports"
```

---

### Task 11: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Run all backend tests**

```bash
go test ./...
```

Expected: all tests pass.

- [ ] **Step 2: Run frontend build**

```bash
cd frontend && npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Verify ffmpeg is available**

```bash
ffmpeg -version
```

Expected: ffmpeg version info printed. If not installed, install via `sudo apt install ffmpeg` or `brew install ffmpeg`.

- [ ] **Step 4: Verify the full application compiles**

```bash
go build ./cmd/janushc-dash/
```

Expected: builds successfully.
