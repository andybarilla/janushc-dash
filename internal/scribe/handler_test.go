package scribe

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andybarilla/janushc-dash/internal/config"
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
			UserName: "Courtney Crance",
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

func TestAllSectionsReadyToSend_LabsNotRequired(t *testing.T) {
	// labs is reference-only and is not written to the EHR, so it must not
	// gate sending. hpi/plan/exam approved with labs left pending → ready.
	rows := makeApprovalRows("hpi", "plan", "exam")
	if !allSectionsReadyToSend(rows, nil) {
		t.Error("expected ready to send when hpi/plan/exam approved and labs left pending")
	}
}

func TestAllSectionsReadyToSend_StaleLabsDoesNotBlock(t *testing.T) {
	rows := makeApprovalRows("hpi", "plan", "exam", "labs")
	edit := makeEditRow("labs", 1) // labs edited after approval → stale
	if !allSectionsReadyToSend(rows, []database.GetSessionSectionEditsRow{edit}) {
		t.Error("expected ready: a stale labs section must not block send")
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

func TestAudioContentType_M4A(t *testing.T) {
	if got := audioContentType("session.m4a"); got != "audio/mp4" {
		t.Fatalf("audioContentType(.m4a) = %q, want audio/mp4", got)
	}
}

func TestSaveSessionAudio_PersistsAndRewinds(t *testing.T) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, _ := writer.CreateFormFile("audio", "recording.mp3")
	part.Write([]byte("fake mp3 data"))
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/scribe/sessions/fake-id/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	file, ext, err := parseAudioUpload(req, 100<<20)
	if err != nil {
		t.Fatalf("unexpected parse error: %v", err)
	}
	defer file.Close()

	h := NewHandler(nil, nil, &config.Config{ScribeAudioDir: t.TempDir()}, nil, nil)
	if _, err := h.saveSessionAudio(file, "tenant-1", "session-1", ext); err != nil {
		t.Fatalf("saveSessionAudio: %v", err)
	}

	got, err := os.ReadFile(filepath.Join(h.audioBaseDir(), "tenant-1", "session-1.mp3"))
	if err != nil {
		t.Fatalf("read saved audio: %v", err)
	}
	if string(got) != "fake mp3 data" {
		t.Fatalf("saved audio mismatch: %q", string(got))
	}
	rewound, err := io.ReadAll(file)
	if err != nil {
		t.Fatalf("read rewound upload: %v", err)
	}
	if string(rewound) != "fake mp3 data" {
		t.Fatalf("upload was not rewound: %q", string(rewound))
	}
	if !h.sessionAudioAvailable("tenant-1", "session-1") {
		t.Fatal("expected saved audio to be available")
	}
}

func TestIsValidFeedbackSection(t *testing.T) {
	cases := map[string]bool{
		"overall": true,
		"hpi":     true,
		"plan":    true,
		"exam":    true,
		"labs":    true,
		"":        false,
		"summary": false,
		"HPI":     false,
	}
	for input, want := range cases {
		if got := isValidFeedbackSection(input); got != want {
			t.Errorf("isValidFeedbackSection(%q) = %v, want %v", input, got, want)
		}
	}
}

func TestIsValidFeedbackCategory(t *testing.T) {
	for _, c := range []string{"missed_info", "incorrect", "hallucination", "formatting", "good", "comment"} {
		if !isValidFeedbackCategory(c) {
			t.Errorf("expected %q to be valid", c)
		}
	}
	for _, c := range []string{"", "missing", "bug", "Good"} {
		if isValidFeedbackCategory(c) {
			t.Errorf("expected %q to be invalid", c)
		}
	}
}

func TestDeriveInitials(t *testing.T) {
	cases := map[string]string{
		"Jane Smith":          "JS",
		"jane smith":          "JS",
		"Dr. Marie Curie":     "MC",
		"Cher":                "CH",
		"  Madonna  ":         "MA",
		"X":                   "X",
		"":                    "",
		"Mary Jane Smith Doe": "MD",
	}
	for in, want := range cases {
		if got := deriveInitials(in); got != want {
			t.Errorf("deriveInitials(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestValidateCreateFeedbackRequest_Valid(t *testing.T) {
	req := createFeedbackRequest{Section: "hpi", Category: "missed_info", Body: "Missed allergy."}
	if err := req.validate(); err != nil {
		t.Errorf("expected valid, got %v", err)
	}
}

func TestValidateCreateFeedbackRequest_BadSection(t *testing.T) {
	req := createFeedbackRequest{Section: "summary", Category: "good", Body: "ok"}
	if err := req.validate(); err == nil {
		t.Error("expected error for invalid section")
	}
}

func TestValidateCreateFeedbackRequest_BadCategory(t *testing.T) {
	req := createFeedbackRequest{Section: "hpi", Category: "bug", Body: "ok"}
	if err := req.validate(); err == nil {
		t.Error("expected error for invalid category")
	}
}

func TestValidateCreateFeedbackRequest_EmptyBody(t *testing.T) {
	req := createFeedbackRequest{Section: "hpi", Category: "good", Body: "   "}
	if err := req.validate(); err == nil {
		t.Error("expected error for empty body")
	}
}
