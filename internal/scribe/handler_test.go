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





func makeApprovalRows(sections ...string) []database.GetSessionSectionStatesRow {
	rows := make([]database.GetSessionSectionStatesRow, 0, len(sections))
	for _, s := range sections {
		rows = append(rows, database.GetSessionSectionStatesRow{
			Section:  s,
			Action:   "approved",
			At:       pgtype.Timestamptz{Time: time.Now(), Valid: true},
			UserName: "Courtney Barilla",
		})
	}
	return rows
}

func makeEditRow(section string, secondsAfter int) database.GetSessionSectionEditsRow {
	return database.GetSessionSectionEditsRow{
		Section: section,
		Content: []byte(`"edited"`),
		At:      pgtype.Timestamptz{Time: time.Now().Add(time.Duration(secondsAfter) * time.Second), Valid: true},
	}
}

func TestBuildSectionStates_AllApproved_NoEdits(t *testing.T) {
	rows := makeApprovalRows("hpi", "plan", "exam", "labs")
	states := buildSectionStates(rows, nil)
	for _, k := range []string{"hpi", "plan", "exam", "labs"} {
		if states[k].state != "approved" {
			t.Errorf("section %s: expected approved, got %q", k, states[k].state)
		}
	}
}

func TestBuildSectionStates_EditAfterApproval_IsStale(t *testing.T) {
	rows := makeApprovalRows("hpi")
	edit := makeEditRow("hpi", 1) // edit 1 second after approval
	states := buildSectionStates(rows, []database.GetSessionSectionEditsRow{edit})
	if states["hpi"].state != "stale" {
		t.Errorf("expected stale, got %q", states["hpi"].state)
	}
}

func TestBuildSectionStates_EditBeforeApproval_IsApproved(t *testing.T) {
	// Approval row timestamp is "now"; edit is in the past (1s ago → negative offset)
	edit := makeEditRow("hpi", -1)
	rows := makeApprovalRows("hpi")
	states := buildSectionStates(rows, []database.GetSessionSectionEditsRow{edit})
	if states["hpi"].state != "approved" {
		t.Errorf("expected approved, got %q", states["hpi"].state)
	}
}

func TestAllSectionsReadyToSend_StaleBlocksSend(t *testing.T) {
	rows := makeApprovalRows("hpi", "plan", "exam", "labs")
	edit := makeEditRow("hpi", 1) // hpi stale
	if allSectionsReadyToSend(rows, []database.GetSessionSectionEditsRow{edit}) {
		t.Error("expected false when a section is stale")
	}
}

func TestAllSectionsReadyToSend_AllApprovedNoEdits(t *testing.T) {
	rows := makeApprovalRows("hpi", "plan", "exam", "labs")
	if !allSectionsReadyToSend(rows, nil) {
		t.Error("expected true when all sections approved and no edits")
	}
}

func TestValidateSectionContent_TextSection_ValidString(t *testing.T) {
	if err := validateSectionContent("hpi", []byte(`"some text"`)); err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

func TestValidateSectionContent_TextSection_InvalidJSON(t *testing.T) {
	if err := validateSectionContent("hpi", []byte(`123`)); err == nil {
		t.Error("expected error for non-string hpi content")
	}
}

func TestValidateSectionContent_Labs_ValidArray(t *testing.T) {
	raw := []byte(`[{"diagnosis":"HTN","lab":"CBC"}]`)
	if err := validateSectionContent("labs", raw); err != nil {
		t.Errorf("expected nil error, got %v", err)
	}
}

func TestValidateSectionContent_Labs_InvalidShape(t *testing.T) {
	if err := validateSectionContent("labs", []byte(`"not an array"`)); err == nil {
		t.Error("expected error for non-array labs content")
	}
}

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
