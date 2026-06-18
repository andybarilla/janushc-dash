package scribe

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgtype"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	_ "github.com/mattn/go-sqlite3"

	"github.com/andybarilla/janushc-dash/internal/auth"
	"github.com/andybarilla/janushc-dash/internal/config"
	"github.com/andybarilla/janushc-dash/internal/database"
	"github.com/andybarilla/janushc-dash/internal/emr"
)

func TestValidateCreateRequest_Valid(t *testing.T) {
	req := createSessionRequest{
		PatientID:     "12345",
		AppointmentID: "67890",
		DepartmentID:  "1",
	}
	if err := req.validate(); err != nil {
		t.Errorf("expected valid request, got error: %v", err)
	}
}

func TestValidateCreateRequest_MissingPatientID(t *testing.T) {
	req := createSessionRequest{
		AppointmentID: "67890",
		DepartmentID:  "1",
	}
	if err := req.validate(); err == nil {
		t.Error("expected error for missing patient_id")
	}
}

func TestValidateCreateRequest_MissingAppointmentID(t *testing.T) {
	req := createSessionRequest{
		PatientID:    "12345",
		DepartmentID: "1",
	}
	if err := req.validate(); err == nil {
		t.Error("expected error for missing appointment_id")
	}
}

func TestValidateCreateRequest_LabelOnly(t *testing.T) {
	req := createSessionRequest{Label: "Jane D."}
	if err := req.validate(); err != nil {
		t.Errorf("expected label-only request to be valid, got error: %v", err)
	}
}

func TestValidateCreateRequest_EmptyLabelAndNoTriple(t *testing.T) {
	req := createSessionRequest{Label: "   "}
	if err := req.validate(); err == nil {
		t.Error("expected error for blank label with no Athena triple")
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

	h := NewHandler(nil, nil, &config.Config{ScribeAudioDir: t.TempDir()}, nil, nil, nil)
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

func TestHandleListAppointmentsRequiresDepartment(t *testing.T) {
	h := NewHandler(nil, nil, &config.Config{}, nil, nil, nil)
	rec := httptest.NewRecorder()
	h.HandleListAppointments(rec, httptest.NewRequest(http.MethodGet, "/api/scribe/appointments", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestHandleListAppointmentsReturnsJSONArray(t *testing.T) {
	processor := &Processor{emr: fakeProcessorEMR{}}
	h := NewHandler(nil, processor, &config.Config{}, nil, nil, nil)
	rec := httptest.NewRecorder()
	h.HandleListAppointments(rec, httptest.NewRequest(http.MethodGet, "/api/scribe/appointments?department_id=1", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if got := strings.TrimSpace(rec.Body.String()); got != "[]" {
		t.Fatalf("expected empty JSON array, got %s", got)
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

// --- HandleSend integration harness ---------------------------------------
//
// HandleSend runs against the concrete *database.Queries and a *Processor that
// delegates to an emr.EMR. The seams are a SQL-dispatching fake DBTX (so the
// handler's GetScribeSession / GetSessionSectionStates / GetSessionSectionEdits
// / SetScribeSessionEncounter / MarkScribeSessionSent calls all resolve) and a
// configurable fake EMR (ResolveEncounterID result + write recorder).

const sendTestTenant = "11111111-1111-1111-1111-111111111111"
const sendTestUser = "22222222-2222-2222-2222-222222222222"

func newPatientIDUpdateHandler(t *testing.T) (*Handler, *sql.DB) {
	t.Helper()

	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite db: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	_, err = db.Exec(`
		CREATE TABLE scribe_sessions (
			id TEXT NOT NULL,
			tenant_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			patient_id TEXT NOT NULL,
			encounter_id TEXT NOT NULL DEFAULT '',
			department_id TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL,
			transcript TEXT,
			ai_output TEXT,
			error_message TEXT,
			started_at TIMESTAMP,
			stopped_at TIMESTAMP,
			completed_at TIMESTAMP,
			created_at TIMESTAMP NOT NULL,
			sent_to_ehr_at TIMESTAMP,
			sent_to_ehr_by TEXT,
			rejected_at TIMESTAMP,
			rejected_by TEXT,
			appointment_id TEXT NOT NULL DEFAULT '',
			label TEXT NOT NULL DEFAULT '',
			document_filename TEXT NOT NULL DEFAULT '',
			PRIMARY KEY (id, tenant_id)
		);
	`)
	if err != nil {
		t.Fatalf("create scribe_sessions: %v", err)
	}

	return NewHandler(database.New(db), nil, &config.Config{}, nil, nil, nil), db
}

type patientIDUpdateSession struct {
	id            string
	tenantID      string
	userID        string
	patientID     string
	appointmentID string
	departmentID  string
	encounterID   string
	status        string
	sentAt        any
	rejectedAt    any
}

func insertPatientIDUpdateSession(t *testing.T, db *sql.DB, session patientIDUpdateSession) {
	t.Helper()

	if session.tenantID == "" {
		session.tenantID = sendTestTenant
	}
	if session.userID == "" {
		session.userID = sendTestUser
	}
	if session.patientID == "" {
		session.patientID = "patient-original"
	}
	if session.status == "" {
		session.status = "complete"
	}

	_, err := db.Exec(`
		INSERT INTO scribe_sessions (
			id, tenant_id, user_id, patient_id, encounter_id, department_id, status,
			transcript, ai_output, error_message, started_at, stopped_at, completed_at,
			created_at, sent_to_ehr_at, sent_to_ehr_by, rejected_at, rejected_by,
			appointment_id, label, document_filename
		) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, '{}', NULL, NULL, NULL, NULL, ?, ?, NULL, ?, NULL, ?, 'Original Label', '')
	`, session.id, session.tenantID, session.userID, session.patientID, session.encounterID,
		session.departmentID, session.status, time.Now(), session.sentAt, session.rejectedAt, session.appointmentID)
	if err != nil {
		t.Fatalf("insert scribe session: %v", err)
	}
}

func patientIDUpdateRequest(sessionID string, body string, claims *auth.Claims) *http.Request {
	req := httptest.NewRequest(http.MethodPut, "/api/scribe/sessions/"+sessionID+"/patient-id", strings.NewReader(body))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", sessionID)
	ctx := context.WithValue(req.Context(), chi.RouteCtxKey, rctx)
	ctx = auth.NewContext(ctx, claims)
	return req.WithContext(ctx)
}

func fetchPatientIDUpdateFields(t *testing.T, db *sql.DB, sessionID string, tenantID string) (patientID, appointmentID, departmentID, encounterID, label string) {
	t.Helper()

	err := db.QueryRow(`
		SELECT patient_id, appointment_id, department_id, encounter_id, label
		FROM scribe_sessions
		WHERE id = ? AND tenant_id = ?
	`, sessionID, tenantID).Scan(&patientID, &appointmentID, &departmentID, &encounterID, &label)
	if err != nil {
		t.Fatalf("fetch scribe session fields: %v", err)
	}
	return patientID, appointmentID, departmentID, encounterID, label
}

func TestHandleUpdatePatientID_TrimsAndPersistsOnlyPatientID(t *testing.T) {
	h, db := newPatientIDUpdateHandler(t)
	sessionID := "33333333-3333-3333-3333-333333333333"
	insertPatientIDUpdateSession(t, db, patientIDUpdateSession{
		id:            sessionID,
		appointmentID: "appointment-original",
		departmentID:  "department-original",
		encounterID:   "encounter-original",
	})

	_, appointmentBefore, departmentBefore, encounterBefore, labelBefore := fetchPatientIDUpdateFields(t, db, sessionID, sendTestTenant)
	w := httptest.NewRecorder()
	h.HandleUpdatePatientID(w, patientIDUpdateRequest(sessionID, `{ "patient_id": "  patient-corrected  " }`, &auth.Claims{UserID: sendTestUser, TenantID: sendTestTenant}))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if body := strings.TrimSpace(w.Body.String()); body != "{}" {
		t.Fatalf("expected body {}, got %s", body)
	}
	patientID, appointmentID, departmentID, encounterID, label := fetchPatientIDUpdateFields(t, db, sessionID, sendTestTenant)
	if patientID != "patient-corrected" {
		t.Fatalf("expected trimmed patient ID persisted, got %q", patientID)
	}
	if appointmentID != appointmentBefore || departmentID != departmentBefore || encounterID != encounterBefore || label != labelBefore {
		t.Fatalf("expected only patient ID to change; got appointment=%q department=%q encounter=%q label=%q", appointmentID, departmentID, encounterID, label)
	}
}

func TestHandleUpdatePatientID_OtherTenantDoesNotUpdate(t *testing.T) {
	h, db := newPatientIDUpdateHandler(t)
	sessionID := "33333333-3333-3333-3333-333333333333"
	otherTenantID := "44444444-4444-4444-4444-444444444444"
	insertPatientIDUpdateSession(t, db, patientIDUpdateSession{id: sessionID, tenantID: otherTenantID})

	w := httptest.NewRecorder()
	h.HandleUpdatePatientID(w, patientIDUpdateRequest(sessionID, `{ "patient_id": "patient-corrected" }`, &auth.Claims{UserID: sendTestUser, TenantID: sendTestTenant}))

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
	patientID, _, _, _, _ := fetchPatientIDUpdateFields(t, db, sessionID, otherTenantID)
	if patientID != "patient-original" {
		t.Fatalf("expected other tenant row unchanged, got patient_id %q", patientID)
	}
}

func TestHandleUpdatePatientID_RejectsBlankPatientID(t *testing.T) {
	h, db := newPatientIDUpdateHandler(t)
	sessionID := "33333333-3333-3333-3333-333333333333"
	insertPatientIDUpdateSession(t, db, patientIDUpdateSession{id: sessionID})

	w := httptest.NewRecorder()
	h.HandleUpdatePatientID(w, patientIDUpdateRequest(sessionID, `{ "patient_id": "   " }`, &auth.Claims{UserID: sendTestUser, TenantID: sendTestTenant}))

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	patientID, _, _, _, _ := fetchPatientIDUpdateFields(t, db, sessionID, sendTestTenant)
	if patientID != "patient-original" {
		t.Fatalf("expected blank patient ID not to update row, got %q", patientID)
	}
}

func TestHandleUpdatePatientID_RejectsSentSession(t *testing.T) {
	h, db := newPatientIDUpdateHandler(t)
	sessionID := "33333333-3333-3333-3333-333333333333"
	insertPatientIDUpdateSession(t, db, patientIDUpdateSession{id: sessionID, sentAt: time.Now()})

	w := httptest.NewRecorder()
	h.HandleUpdatePatientID(w, patientIDUpdateRequest(sessionID, `{ "patient_id": "patient-corrected" }`, &auth.Claims{UserID: sendTestUser, TenantID: sendTestTenant}))

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "sent sessions cannot be edited") {
		t.Fatalf("expected sent session error, got %q", w.Body.String())
	}
	patientID, _, _, _, _ := fetchPatientIDUpdateFields(t, db, sessionID, sendTestTenant)
	if patientID != "patient-original" {
		t.Fatalf("expected sent session not to update row, got %q", patientID)
	}
}

func TestHandleUpdatePatientID_RejectsRejectedSession(t *testing.T) {
	h, db := newPatientIDUpdateHandler(t)
	sessionID := "33333333-3333-3333-3333-333333333333"
	insertPatientIDUpdateSession(t, db, patientIDUpdateSession{id: sessionID, rejectedAt: time.Now()})

	w := httptest.NewRecorder()
	h.HandleUpdatePatientID(w, patientIDUpdateRequest(sessionID, `{ "patient_id": "patient-corrected" }`, &auth.Claims{UserID: sendTestUser, TenantID: sendTestTenant}))

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "rejected sessions cannot be edited") {
		t.Fatalf("expected rejected session error, got %q", w.Body.String())
	}
	patientID, _, _, _, _ := fetchPatientIDUpdateFields(t, db, sessionID, sendTestTenant)
	if patientID != "patient-original" {
		t.Fatalf("expected rejected session not to update row, got %q", patientID)
	}
}

func TestHandleUpdatePatientID_AllowsProcessingSession(t *testing.T) {
	h, db := newPatientIDUpdateHandler(t)
	sessionID := "33333333-3333-3333-3333-333333333333"
	insertPatientIDUpdateSession(t, db, patientIDUpdateSession{id: sessionID, status: "processing"})

	w := httptest.NewRecorder()
	h.HandleUpdatePatientID(w, patientIDUpdateRequest(sessionID, `{ "patient_id": "  patient-processing  " }`, &auth.Claims{UserID: sendTestUser, TenantID: sendTestTenant}))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if body := strings.TrimSpace(w.Body.String()); body != "{}" {
		t.Fatalf("expected body {}, got %s", body)
	}
	patientID, _, _, _, _ := fetchPatientIDUpdateFields(t, db, sessionID, sendTestTenant)
	if patientID != "patient-processing" {
		t.Fatalf("expected processing session update, got %q", patientID)
	}
}

// sendFakeEMR is a configurable, pointer-based emr.EMR for HandleSend tests.
// It is distinct from the value-typed fakeProcessorEMR used by processor tests.
type sendFakeEMR struct {
	resolveResult    string
	resolveErr       error
	writeEncounterID string
	writeCalled      bool
}

func (e *sendFakeEMR) ListPatientOrders(ctx context.Context, practiceID, patientID, departmentID string, orderTypes []string) ([]emr.Order, error) {
	return nil, nil
}
func (e *sendFakeEMR) ListDepartments(ctx context.Context, practiceID string) ([]emr.Department, error) {
	return nil, nil
}
func (e *sendFakeEMR) ListDepartmentPatients(ctx context.Context, practiceID, departmentID string) ([]emr.Patient, error) {
	return nil, nil
}
func (e *sendFakeEMR) GetPatientName(ctx context.Context, practiceID, patientID string) (string, error) {
	return "", nil
}
func (e *sendFakeEMR) ApproveOrders(ctx context.Context, practiceID string, orderIDs []string) ([]string, error) {
	return nil, nil
}
func (e *sendFakeEMR) GetActiveDiagnoses(ctx context.Context, practiceID, patientID string) ([]emr.Diagnosis, error) {
	return nil, nil
}
func (e *sendFakeEMR) ListTodayEncounters(ctx context.Context, practiceID, departmentID string) ([]emr.Encounter, error) {
	return nil, nil
}
func (e *sendFakeEMR) ListTodayAppointments(ctx context.Context, practiceID, departmentID string) ([]emr.Appointment, error) {
	return nil, nil
}
func (e *sendFakeEMR) ResolveEncounterID(ctx context.Context, practiceID, appointmentID string) (string, error) {
	return e.resolveResult, e.resolveErr
}
func (e *sendFakeEMR) WriteEncounterHPI(ctx context.Context, practiceID, encounterID, hpiText string) error {
	e.writeCalled = true
	e.writeEncounterID = encounterID
	return nil
}
func (e *sendFakeEMR) WriteEncounterAssessmentPlan(ctx context.Context, practiceID, encounterID, apText string) error {
	e.writeCalled = true
	e.writeEncounterID = encounterID
	return nil
}
func (e *sendFakeEMR) WriteEncounterPhysicalExam(ctx context.Context, practiceID, encounterID, peText string) error {
	e.writeCalled = true
	e.writeEncounterID = encounterID
	return nil
}

// sendFakeDB dispatches by SQL text so the multiple distinct queries HandleSend
// issues each get the right rows, and records Exec calls so the test can assert
// what was persisted / whether the session was marked sent.
type sendFakeDB struct {
	session     database.ScribeSession
	stateRows   [][]interface{}
	editRows    [][]interface{}
	encounterDB string // EncounterID passed to SetScribeSessionEncounter
	markedSent  bool
}

func (db *sendFakeDB) Exec(ctx context.Context, sql string, args ...interface{}) (pgconn.CommandTag, error) {
	switch {
	case strings.Contains(sql, "UPDATE scribe_sessions") && strings.Contains(sql, "encounter_id"):
		if len(args) >= 3 {
			if s, ok := args[2].(string); ok {
				db.encounterDB = s
			}
		}
	case strings.Contains(sql, "sent_to_ehr_at"):
		db.markedSent = true
	}
	return pgconn.CommandTag{}, nil
}

func (db *sendFakeDB) Query(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error) {
	if strings.Contains(sql, "scribe_section_approvals") {
		return newSendRows(db.stateRows), nil
	}
	return newSendRows(db.editRows), nil
}

func (db *sendFakeDB) QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row {
	s := db.session
	return &sendRow{values: []interface{}{
		s.ID, s.TenantID, s.UserID, s.PatientID, s.EncounterID, s.DepartmentID,
		s.Status, s.Transcript, s.AiOutput, s.ErrorMessage, s.StartedAt, s.StoppedAt,
		s.CompletedAt, s.CreatedAt, s.SentToEhrAt, s.SentToEhrBy, s.RejectedAt,
		s.RejectedBy, s.AppointmentID, s.Label, s.DocumentFilename,
	}}
}

type fakeSQLResult struct{}

func (fakeSQLResult) LastInsertId() (int64, error) { return 0, nil }
func (fakeSQLResult) RowsAffected() (int64, error) { return 0, nil }

func (db *sendFakeDB) ExecContext(ctx context.Context, query string, args ...interface{}) (sql.Result, error) {
	_, err := db.Exec(ctx, query, args...)
	return fakeSQLResult{}, err
}

func (db *sendFakeDB) PrepareContext(ctx context.Context, query string) (*sql.Stmt, error) {
	return nil, fmt.Errorf("sendFakeDB does not support prepared statements")
}

func (db *sendFakeDB) QueryContext(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error) {
	return nil, fmt.Errorf("sendFakeDB QueryContext is unavailable in compile-only patient ID tests")
}

func (db *sendFakeDB) QueryRowContext(ctx context.Context, query string, args ...interface{}) *sql.Row {
	return nil
}

type sendRow struct {
	values []interface{}
	err    error
}

func (r *sendRow) Scan(dest ...interface{}) error {
	if r.err != nil {
		return r.err
	}
	return sendScan(dest, r.values)
}

type sendRows struct {
	values [][]interface{}
	index  int
}

func newSendRows(values [][]interface{}) *sendRows { return &sendRows{values: values, index: -1} }

func (rows *sendRows) Close()                                       {}
func (rows *sendRows) Err() error                                   { return nil }
func (rows *sendRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (rows *sendRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (rows *sendRows) Values() ([]interface{}, error)               { return rows.values[rows.index], nil }
func (rows *sendRows) RawValues() [][]byte                          { return nil }
func (rows *sendRows) Conn() *pgx.Conn                              { return nil }
func (rows *sendRows) Next() bool {
	if rows.index+1 >= len(rows.values) {
		return false
	}
	rows.index++
	return true
}
func (rows *sendRows) Scan(dest ...interface{}) error { return sendScan(dest, rows.values[rows.index]) }

func sendScan(dest, values []interface{}) error {
	if len(dest) != len(values) {
		return fmt.Errorf("scan destination count mismatch: %d != %d", len(dest), len(values))
	}
	for i := range dest {
		switch target := dest[i].(type) {
		case *pgtype.UUID:
			target.Bytes, target.Valid = values[i].(pgtype.UUID).Bytes, values[i].(pgtype.UUID).Valid
		case *pgtype.Timestamptz:
			*target = values[i].(pgtype.Timestamptz)
		case *pgtype.Text:
			*target = values[i].(pgtype.Text)
		case *string:
			*target = values[i].(string)
		case *[]byte:
			*target = values[i].([]byte)
		default:
			return fmt.Errorf("unsupported scan destination %T", dest[i])
		}
	}
	return nil
}

func mustScanUUID(t *testing.T, s string) pgtype.UUID {
	t.Helper()
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		t.Fatalf("scan uuid %q: %v", s, err)
	}
	return u
}

// approvedStateRows builds GetSessionSectionStates rows (section, action,
// user_id, at, user_name) for the given sections, all approved "now".
func approvedStateRows(sections ...string) [][]interface{} {
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
	var rows [][]interface{}
	for _, s := range sections {
		rows = append(rows, []interface{}{s, "approved", pgtype.UUID{}, now, "Courtney Crance"})
	}
	return rows
}

func newSendHandler(db *sendFakeDB, emrClient *sendFakeEMR) *Handler {
	return NewHandler(database.New(db), &Processor{emr: emrClient}, &config.Config{}, nil, emrClient, nil)
}

func sendRequest(sessionID string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/api/scribe/sessions/"+sessionID+"/send", nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", sessionID)
	ctx := context.WithValue(req.Context(), chi.RouteCtxKey, rctx)
	ctx = auth.NewContext(ctx, &auth.Claims{UserID: sendTestUser, TenantID: sendTestTenant})
	return req.WithContext(ctx)
}

func TestHandleSend_ResolvesEncounterFromAppointment(t *testing.T) {
	sessionUUID := mustScanUUID(t, "33333333-3333-3333-3333-333333333333")
	tenantUUID := mustScanUUID(t, sendTestTenant)
	db := &sendFakeDB{
		session: database.ScribeSession{
			ID:            sessionUUID,
			TenantID:      tenantUUID,
			EncounterID:   "",
			AppointmentID: "A1",
			Status:        "complete",
			AiOutput:      []byte(`{"hpi":"h","assessment_plan":"a","physical_exam":"p"}`),
		},
		stateRows: approvedStateRows("hpi", "plan", "exam"),
	}
	emrClient := &sendFakeEMR{resolveResult: "E99"}
	h := newSendHandler(db, emrClient)

	w := httptest.NewRecorder()
	h.HandleSend(w, sendRequest("33333333-3333-3333-3333-333333333333"))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if body := strings.TrimSpace(w.Body.String()); body != "{}" {
		t.Fatalf("expected body {}, got %s", body)
	}
	if !emrClient.writeCalled {
		t.Fatal("expected WriteToAthena (encounter writes) to be called")
	}
	if emrClient.writeEncounterID != "E99" {
		t.Fatalf("expected encounter writes to receive E99, got %q", emrClient.writeEncounterID)
	}
	if db.encounterDB != "E99" {
		t.Fatalf("expected resolved encounter E99 persisted, got %q", db.encounterDB)
	}
	if !db.markedSent {
		t.Fatal("expected session to be marked sent")
	}
}

func TestHandleSend_UnresolvedEncounterBlocksSend(t *testing.T) {
	sessionUUID := mustScanUUID(t, "33333333-3333-3333-3333-333333333333")
	tenantUUID := mustScanUUID(t, sendTestTenant)
	db := &sendFakeDB{
		session: database.ScribeSession{
			ID:            sessionUUID,
			TenantID:      tenantUUID,
			EncounterID:   "",
			AppointmentID: "A1",
			Status:        "complete",
			AiOutput:      []byte(`{"hpi":"h","assessment_plan":"a","physical_exam":"p"}`),
		},
		stateRows: approvedStateRows("hpi", "plan", "exam"),
	}
	emrClient := &sendFakeEMR{resolveResult: ""}
	h := newSendHandler(db, emrClient)

	w := httptest.NewRecorder()
	h.HandleSend(w, sendRequest("33333333-3333-3333-3333-333333333333"))

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if emrClient.writeCalled {
		t.Fatal("expected no encounter writes when encounter unresolved")
	}
	if db.markedSent {
		t.Fatal("expected session NOT to be marked sent when encounter unresolved")
	}
}

type fakeEMR struct {
	departments []emr.Department
	encounters  []emr.Encounter
	err         error
}

func (f fakeEMR) ListDepartments(ctx context.Context, practiceID string) ([]emr.Department, error) {
	return f.departments, f.err
}
func (f fakeEMR) ListTodayEncounters(ctx context.Context, practiceID, departmentID string) ([]emr.Encounter, error) {
	return f.encounters, f.err
}
func (f fakeEMR) ListTodayAppointments(ctx context.Context, practiceID, departmentID string) ([]emr.Appointment, error) {
	return nil, nil
}
func (f fakeEMR) ResolveEncounterID(ctx context.Context, practiceID, appointmentID string) (string, error) {
	return "", nil
}
func (f fakeEMR) ListPatientOrders(ctx context.Context, practiceID, patientID, departmentID string, orderTypes []string) ([]emr.Order, error) {
	return nil, nil
}
func (f fakeEMR) ListDepartmentPatients(ctx context.Context, practiceID, departmentID string) ([]emr.Patient, error) {
	return nil, nil
}
func (f fakeEMR) GetPatientName(ctx context.Context, practiceID, patientID string) (string, error) {
	return "", nil
}
func (f fakeEMR) ApproveOrders(ctx context.Context, practiceID string, orderIDs []string) ([]string, error) {
	return nil, nil
}
func (f fakeEMR) GetActiveDiagnoses(ctx context.Context, practiceID, patientID string) ([]emr.Diagnosis, error) {
	return nil, nil
}
func (f fakeEMR) WriteEncounterHPI(ctx context.Context, practiceID, encounterID, hpiText string) error {
	return nil
}
func (f fakeEMR) WriteEncounterAssessmentPlan(ctx context.Context, practiceID, encounterID, apText string) error {
	return nil
}
func (f fakeEMR) WriteEncounterPhysicalExam(ctx context.Context, practiceID, encounterID, peText string) error {
	return nil
}

func TestShouldAutoTranscribe(t *testing.T) {
	cases := []struct {
		value string
		want  bool
	}{
		{"", true}, // absent → default true
		{"true", true},
		{"1", true},
		{"yes", true},
		{"on", true},
		{"false", false},
		{"0", false},
		{"off", false},
		{"no", false},
		{"FALSE", false}, // case-insensitive
		{"OFF", false},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(http.MethodPost, "/upload", strings.NewReader("auto_transcribe="+tc.value))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		got := shouldAutoTranscribe(req)
		if got != tc.want {
			t.Errorf("shouldAutoTranscribe(%q) = %v, want %v", tc.value, got, tc.want)
		}
	}
}

func TestHandleListDepartments(t *testing.T) {
	h := &Handler{
		cfg: &config.Config{AthenaPracticeID: "195900"},
		emr: fakeEMR{departments: []emr.Department{{ID: "1", Name: "Primary Care"}}},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/scribe/departments", nil)
	w := httptest.NewRecorder()
	h.HandleListDepartments(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"Primary Care"`) {
		t.Errorf("expected department in body, got %s", w.Body.String())
	}
}

func TestHandleListEncounters(t *testing.T) {
	h := &Handler{
		cfg: &config.Config{AthenaPracticeID: "195900"},
		emr: fakeEMR{encounters: []emr.Encounter{
			{ID: "900", PatientID: "55", PatientName: "Ada Lovelace", DepartmentID: "1", Date: "05/31/2026"},
		}},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/scribe/encounters?department_id=1", nil)
	w := httptest.NewRecorder()
	h.HandleListEncounters(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !strings.Contains(body, `"encounter_id":"900"`) || !strings.Contains(body, `"patient_name":"Ada Lovelace"`) {
		t.Errorf("unexpected body: %s", body)
	}
}

func TestHandleListEncounters_MissingDepartment(t *testing.T) {
	h := &Handler{cfg: &config.Config{AthenaPracticeID: "195900"}, emr: fakeEMR{}}

	req := httptest.NewRequest(http.MethodGet, "/api/scribe/encounters", nil)
	w := httptest.NewRecorder()
	h.HandleListEncounters(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}
