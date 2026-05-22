package mobile

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/andybarilla/janushc-dash/internal/config"
)

const testToken = "spike-secret"

func newUploadRequest(t *testing.T, withFile bool) *http.Request {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	_ = writer.WriteField("patient_label", "Test patient")
	_ = writer.WriteField("created_at", "2026-05-21T10:00:00Z")
	if withFile {
		part, _ := writer.CreateFormFile("audio", "janushc-123.m4a")
		_, _ = part.Write([]byte("fake m4a bytes"))
	}
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/mobile/recordings", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req
}

func TestHandleCreateRecording(t *testing.T) {
	dir := t.TempDir()
	h := NewHandler(&config.Config{MobileRecordingsDir: dir, MobileSpikeToken: testToken})

	req := newUploadRequest(t, true)
	req.Header.Set("Authorization", "Bearer "+testToken)
	rec := httptest.NewRecorder()

	h.HandleCreateRecording(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusCreated, rec.Body.String())
	}

	var resp recordingResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.SizeBytes != int64(len("fake m4a bytes")) {
		t.Errorf("size_bytes = %d, want %d", resp.SizeBytes, len("fake m4a bytes"))
	}
	if resp.PatientLabel != "Test patient" {
		t.Errorf("patient_label = %q, want %q", resp.PatientLabel, "Test patient")
	}

	stored, err := os.ReadFile(resp.StoredPath)
	if err != nil {
		t.Fatalf("read stored file: %v", err)
	}
	if !bytes.Equal(stored, []byte("fake m4a bytes")) {
		t.Errorf("stored audio does not match upload")
	}
}

func TestHandleCreateRecordingMissingFile(t *testing.T) {
	h := NewHandler(&config.Config{MobileRecordingsDir: t.TempDir(), MobileSpikeToken: testToken})

	req := newUploadRequest(t, false)
	req.Header.Set("Authorization", "Bearer "+testToken)
	rec := httptest.NewRecorder()

	h.HandleCreateRecording(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestHandleCreateRecordingDisabledWithoutToken(t *testing.T) {
	h := NewHandler(&config.Config{MobileRecordingsDir: t.TempDir()})

	req := newUploadRequest(t, true)
	req.Header.Set("Authorization", "Bearer anything")
	rec := httptest.NewRecorder()

	h.HandleCreateRecording(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}
}

func TestHandleCreateRecordingWrongToken(t *testing.T) {
	h := NewHandler(&config.Config{MobileRecordingsDir: t.TempDir(), MobileSpikeToken: testToken})

	for _, header := range []string{"", "Bearer wrong", "wrong", "Basic " + testToken} {
		req := newUploadRequest(t, true)
		if header != "" {
			req.Header.Set("Authorization", header)
		}
		rec := httptest.NewRecorder()

		h.HandleCreateRecording(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Errorf("Authorization %q: status = %d, want %d", header, rec.Code, http.StatusUnauthorized)
		}
	}
}
