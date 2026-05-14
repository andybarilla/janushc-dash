package scribe

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andybarilla/janushc-dash/internal/database"
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

func TestIsValidSection(t *testing.T) {
	for _, s := range []string{"hpi", "plan", "exam", "labs"} {
		if !isValidSection(s) {
			t.Errorf("expected %q to be valid", s)
		}
	}
	for _, s := range []string{"", "HPI", "foo", "hpi "} {
		if isValidSection(s) {
			t.Errorf("expected %q to be invalid", s)
		}
	}
}

func TestBuildSectionsMap_EmptyDefaultsAllPending(t *testing.T) {
	out := buildSectionsMap(nil)
	if len(out) != 4 {
		t.Fatalf("expected 4 keys, got %d", len(out))
	}
	for _, k := range []string{"hpi", "plan", "exam", "labs"} {
		if out[k].State != "pending" {
			t.Errorf("section %s: expected pending, got %q", k, out[k].State)
		}
	}
}

func TestBuildSectionsMap_ApprovedRowSetsApprovedState(t *testing.T) {
	at := time.Date(2026, 5, 14, 15, 32, 0, 0, time.UTC)
	rows := []database.GetSessionSectionStatesRow{
		{
			Section:  "hpi",
			Action:   "approved",
			At:       pgtype.Timestamptz{Time: at, Valid: true},
			UserName: "Courtney Barilla",
		},
	}
	out := buildSectionsMap(rows)
	if out["hpi"].State != "approved" {
		t.Errorf("expected approved, got %q", out["hpi"].State)
	}
	if out["hpi"].ApprovedByName != "Courtney Barilla" {
		t.Errorf("expected approver name, got %q", out["hpi"].ApprovedByName)
	}
	if out["hpi"].ApprovedAt == "" {
		t.Error("expected approved_at to be set")
	}
	if out["plan"].State != "pending" {
		t.Errorf("untouched section should remain pending, got %q", out["plan"].State)
	}
}

// The DB query (DISTINCT ON ... ORDER BY at DESC) returns at most one row per
// section — the latest event. If that latest event is a 'revoked' action, the
// section must end up pending. This guards the Go-side derivation contract.
func TestAllSectionsApproved_AllApproved(t *testing.T) {
	rows := []database.GetSessionSectionStatesRow{
		{Section: "hpi", Action: "approved"},
		{Section: "plan", Action: "approved"},
		{Section: "exam", Action: "approved"},
		{Section: "labs", Action: "approved"},
	}
	if !allSectionsApproved(rows) {
		t.Error("expected all sections approved")
	}
}

func TestAllSectionsApproved_MissingSection(t *testing.T) {
	rows := []database.GetSessionSectionStatesRow{
		{Section: "hpi", Action: "approved"},
		{Section: "plan", Action: "approved"},
		{Section: "exam", Action: "approved"},
		// labs missing
	}
	if allSectionsApproved(rows) {
		t.Error("expected false when a section is missing")
	}
}

func TestAllSectionsApproved_OneRevoked(t *testing.T) {
	rows := []database.GetSessionSectionStatesRow{
		{Section: "hpi", Action: "approved"},
		{Section: "plan", Action: "approved"},
		{Section: "exam", Action: "revoked"},
		{Section: "labs", Action: "approved"},
	}
	if allSectionsApproved(rows) {
		t.Error("expected false when a section is revoked")
	}
}

func TestBuildSectionsMap_RevokedRowYieldsPending(t *testing.T) {
	rows := []database.GetSessionSectionStatesRow{
		{Section: "hpi", Action: "revoked"},
	}
	out := buildSectionsMap(rows)
	if out["hpi"].State != "pending" {
		t.Errorf("expected pending after revoke, got %q", out["hpi"].State)
	}
	if out["hpi"].ApprovedByName != "" || out["hpi"].ApprovedAt != "" {
		t.Error("revoked section must not carry approver metadata")
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
