package scribe

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestValidateCreateRequest_Valid(t *testing.T) {
	req := createSessionRequest{
		PatientID:    "12345",
		EncounterID:  "67890",
		DepartmentID: "1",
	}
	if err := req.validate(); err != nil {
		t.Errorf("expected valid request, got error: %v", err)
	}
}

func TestValidateCreateRequest_MissingPatientID(t *testing.T) {
	req := createSessionRequest{
		EncounterID:  "67890",
		DepartmentID: "1",
	}
	if err := req.validate(); err == nil {
		t.Error("expected error for missing patient_id")
	}
}

func TestValidateCreateRequest_MissingEncounterID(t *testing.T) {
	req := createSessionRequest{
		PatientID:    "12345",
		DepartmentID: "1",
	}
	if err := req.validate(); err == nil {
		t.Error("expected error for missing encounter_id")
	}
}

func TestValidateProcessRequest_Valid(t *testing.T) {
	req := processRequest{
		Transcript: "Provider: Hello. Patient: Hi.",
	}
	if err := req.validate(); err != nil {
		t.Errorf("expected valid request, got error: %v", err)
	}
}

func TestValidateProcessRequest_EmptyTranscript(t *testing.T) {
	req := processRequest{}
	if err := req.validate(); err == nil {
		t.Error("expected error for empty transcript")
	}
}

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
