package scribe

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andybarilla/janushc-dash/internal/auth"
	"github.com/andybarilla/janushc-dash/internal/config"
	"github.com/andybarilla/janushc-dash/internal/database"
	"github.com/andybarilla/janushc-dash/internal/transcribe"
)

type Handler struct {
	queries     *database.Queries
	processor   *Processor
	cfg         *config.Config
	transcriber transcribe.Transcriber
}

func NewHandler(queries *database.Queries, processor *Processor, cfg *config.Config, transcriber transcribe.Transcriber) *Handler {
	return &Handler{queries: queries, processor: processor, cfg: cfg, transcriber: transcriber}
}

const maxUploadSize = 100 << 20 // 100 MB

// parseAudioUpload extracts and validates the audio file from a multipart request.
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

type createSessionRequest struct {
	PatientID    string `json:"patient_id"`
	EncounterID  string `json:"encounter_id"`
	DepartmentID string `json:"department_id"`
}

func (r createSessionRequest) validate() error {
	if r.PatientID == "" {
		return fmt.Errorf("patient_id required")
	}
	if r.EncounterID == "" {
		return fmt.Errorf("encounter_id required")
	}
	if r.DepartmentID == "" {
		return fmt.Errorf("department_id required")
	}
	return nil
}

type processRequest struct {
	Transcript string `json:"transcript"`
}

func (r processRequest) validate() error {
	if r.Transcript == "" {
		return fmt.Errorf("transcript required")
	}
	return nil
}

type sessionResponse struct {
	ID            string `json:"id"`
	PatientID     string `json:"patient_id"`
	EncounterID   string `json:"encounter_id"`
	DepartmentID  string `json:"department_id"`
	Status        string `json:"status"`
	ErrorMessage  string `json:"error_message,omitempty"`
	CreatedAt     string `json:"created_at"`
	CompletedAt   string `json:"completed_at,omitempty"`
	SentToEhrAt   string `json:"sent_to_ehr_at,omitempty"`
	RejectedAt    string `json:"rejected_at,omitempty"`
	ApprovedCount int    `json:"approved_count"`
}

type sectionState struct {
	State          string          `json:"state"` // "pending" | "approved" | "stale"
	Content        json.RawMessage `json:"content"`
	ApprovedByName string          `json:"approved_by_name,omitempty"`
	ApprovedAt     string          `json:"approved_at,omitempty"`
	EditedAt       string          `json:"edited_at,omitempty"`
}

// sectionStateCore holds derived state for one section, without content.
// Used by HandleSend to check readiness without loading AI output.
type sectionStateCore struct {
	state          string // "pending" | "approved" | "stale"
	approvedByName string
	approvedAt     pgtype.Timestamptz
	editedAt       pgtype.Timestamptz
}

type sessionDetailResponse struct {
	sessionResponse
	Transcript     string                  `json:"transcript,omitempty"`
	AIOutput       *ScribeOutput           `json:"ai_output,omitempty"`
	Sections       map[string]sectionState `json:"sections"`
	AudioAvailable bool                    `json:"audio_available"`
}

var sectionKeys = []string{"hpi", "plan", "exam", "labs"}

func isValidSection(s string) bool {
	for _, k := range sectionKeys {
		if k == s {
			return true
		}
	}
	return false
}

func (h *Handler) audioBaseDir() string {
	if h.cfg != nil && h.cfg.ScribeAudioDir != "" {
		return h.cfg.ScribeAudioDir
	}
	return "tmp/scribe-audio"
}

func (h *Handler) sessionAudioPath(tenantID, sessionID, ext string) string {
	return filepath.Join(h.audioBaseDir(), tenantID, sessionID+ext)
}

func (h *Handler) removeExistingSessionAudio(tenantID, sessionID string) error {
	matches, err := filepath.Glob(filepath.Join(h.audioBaseDir(), tenantID, sessionID+".*"))
	if err != nil {
		return err
	}
	for _, match := range matches {
		if err := os.Remove(match); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func (h *Handler) saveSessionAudio(file multipart.File, tenantID, sessionID, ext string) (int64, error) {
	if err := os.MkdirAll(filepath.Join(h.audioBaseDir(), tenantID), 0o750); err != nil {
		return 0, err
	}
	if err := h.removeExistingSessionAudio(tenantID, sessionID); err != nil {
		return 0, err
	}

	out, err := os.OpenFile(h.sessionAudioPath(tenantID, sessionID, ext), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return 0, err
	}
	written, copyErr := io.Copy(out, file)
	closeErr := out.Close()
	if copyErr != nil {
		return written, copyErr
	}
	if closeErr != nil {
		return written, closeErr
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return written, err
	}
	return written, nil
}

func (h *Handler) findSessionAudioPath(tenantID, sessionID string) (string, error) {
	matches, err := filepath.Glob(filepath.Join(h.audioBaseDir(), tenantID, sessionID+".*"))
	if err != nil {
		return "", err
	}
	for _, match := range matches {
		if info, err := os.Stat(match); err == nil && !info.IsDir() {
			return match, nil
		}
	}
	return "", os.ErrNotExist
}

func (h *Handler) sessionAudioAvailable(tenantID, sessionID string) bool {
	_, err := h.findSessionAudioPath(tenantID, sessionID)
	return err == nil
}

func audioContentType(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".m4a":
		return "audio/mp4"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".webm":
		return "audio/webm"
	case ".ogg":
		return "audio/ogg"
	case ".flac":
		return "audio/flac"
	}
	contentType := mime.TypeByExtension(filepath.Ext(path))
	if contentType == "" {
		return "application/octet-stream"
	}
	return contentType
}

var feedbackSections = []string{"overall", "hpi", "plan", "exam", "labs"}
var feedbackCategories = []string{
	"missed_info", "incorrect", "hallucination", "formatting", "good", "comment",
}

func isValidFeedbackSection(s string) bool {
	for _, k := range feedbackSections {
		if k == s {
			return true
		}
	}
	return false
}

func isValidFeedbackCategory(c string) bool {
	for _, k := range feedbackCategories {
		if k == c {
			return true
		}
	}
	return false
}

// deriveInitials returns up to two uppercase letters from the user's display
// name. Multi-word names take first letter of first and last word. Single-word
// names take the first two letters. Strips a leading "Dr. " honorific so it
// doesn't dominate the initials.
func deriveInitials(name string) string {
	trimmed := strings.TrimSpace(name)
	trimmed = strings.TrimPrefix(trimmed, "Dr. ")
	trimmed = strings.TrimPrefix(trimmed, "dr. ")
	fields := strings.Fields(trimmed)
	switch {
	case len(fields) == 0:
		return ""
	case len(fields) == 1:
		w := fields[0]
		if len(w) == 1 {
			return strings.ToUpper(w)
		}
		return strings.ToUpper(w[:2])
	default:
		first := fields[0]
		last := fields[len(fields)-1]
		return strings.ToUpper(string(first[0]) + string(last[0]))
	}
}

type createFeedbackRequest struct {
	Section  string `json:"section"`
	Category string `json:"category"`
	Body     string `json:"body"`
}

func (r createFeedbackRequest) validate() error {
	if !isValidFeedbackSection(r.Section) {
		return fmt.Errorf("invalid section")
	}
	if !isValidFeedbackCategory(r.Category) {
		return fmt.Errorf("invalid category")
	}
	if strings.TrimSpace(r.Body) == "" {
		return fmt.Errorf("body is required")
	}
	return nil
}

type feedbackResponse struct {
	ID             string `json:"id"`
	Section        string `json:"section"`
	Category       string `json:"category"`
	Body           string `json:"body"`
	Author         string `json:"author"`
	AuthorInitials string `json:"authorInitials"`
	At             string `json:"at"`
}

func (h *Handler) HandleCreate(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req createSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if err := req.validate(); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
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

	session, err := h.queries.CreateScribeSession(r.Context(), database.CreateScribeSessionParams{
		TenantID:     tenantUUID,
		UserID:       userUUID,
		PatientID:    req.PatientID,
		EncounterID:  req.EncounterID,
		DepartmentID: req.DepartmentID,
	})
	if err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(sessionResponse{
		ID:           uuidToString(session.ID),
		PatientID:    session.PatientID,
		EncounterID:  session.EncounterID,
		DepartmentID: session.DepartmentID,
		Status:       session.Status,
		CreatedAt:    session.CreatedAt.Time.UTC().Format("2006-01-02T15:04:05Z"),
	})
}

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

	sessions, err := h.queries.ListScribeSessions(r.Context(), tenantUUID)
	if err != nil {
		http.Error(w, "failed to list sessions", http.StatusInternalServerError)
		return
	}

	result := make([]sessionResponse, 0, len(sessions))
	for _, s := range sessions {
		result = append(result, toListSessionResponse(s))
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *Handler) HandleGet(w http.ResponseWriter, r *http.Request) {
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

	session, err := h.queries.GetScribeSession(r.Context(), database.GetScribeSessionParams{
		ID:       sessionUUID,
		TenantID: tenantUUID,
	})
	if err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	resp := sessionDetailResponse{
		sessionResponse: toSessionResponse(session),
		AudioAvailable:  h.sessionAudioAvailable(claims.TenantID, sessionID),
	}
	if session.Transcript.Valid {
		resp.Transcript = session.Transcript.String
	}
	if session.AiOutput != nil {
		var output ScribeOutput
		if err := json.Unmarshal(session.AiOutput, &output); err == nil {
			resp.AIOutput = &output
		}
	}

	approvalRows, err := h.queries.GetSessionSectionStates(r.Context(), sessionUUID)
	if err != nil {
		http.Error(w, "failed to load section states", http.StatusInternalServerError)
		return
	}
	editRows, err := h.queries.GetSessionSectionEdits(r.Context(), sessionUUID)
	if err != nil {
		http.Error(w, "failed to load section edits", http.StatusInternalServerError)
		return
	}
	sectionStates := buildSectionStates(approvalRows, editRows)
	var aiOutput *ScribeOutput
	if resp.AIOutput != nil {
		aiOutput = resp.AIOutput
	}
	resp.Sections = buildDetailSections(sectionStates, editRows, aiOutput)
	approved := 0
	for _, s := range resp.Sections {
		if s.State == "approved" {
			approved++
		}
	}
	resp.ApprovedCount = approved

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (h *Handler) HandleAudio(w http.ResponseWriter, r *http.Request) {
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

	if _, err := h.queries.GetScribeSession(r.Context(), database.GetScribeSessionParams{
		ID:       sessionUUID,
		TenantID: tenantUUID,
	}); err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	path, err := h.findSessionAudioPath(claims.TenantID, sessionID)
	if err != nil {
		http.Error(w, "audio not found", http.StatusNotFound)
		return
	}
	file, err := os.Open(path)
	if err != nil {
		http.Error(w, "audio not found", http.StatusNotFound)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		http.Error(w, "audio not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", audioContentType(path))
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", filepath.Base(path)))
	http.ServeContent(w, r, filepath.Base(path), info.ModTime(), file)
}

// buildSectionStates derives the approval + stale state for each section
// from the latest approval event and latest edit per section.
// This is the authoritative readiness check used by HandleSend.
func buildSectionStates(
	approvalRows []database.GetSessionSectionStatesRow,
	editRows []database.GetSessionSectionEditsRow,
) map[string]sectionStateCore {
	// Index latest edit timestamp per section
	editedAt := make(map[string]pgtype.Timestamptz, len(editRows))
	for _, e := range editRows {
		editedAt[e.Section] = e.At
	}

	out := make(map[string]sectionStateCore, len(sectionKeys))
	for _, k := range sectionKeys {
		out[k] = sectionStateCore{state: "pending"}
	}
	for _, r := range approvalRows {
		core := sectionStateCore{approvedAt: r.At, approvedByName: r.UserName}
		if r.Action != "approved" {
			core.state = "pending"
		} else if ea, hasEdit := editedAt[r.Section]; hasEdit && ea.Valid && r.At.Valid && ea.Time.After(r.At.Time) {
			core.state = "stale"
			core.editedAt = ea
		} else {
			core.state = "approved"
		}
		out[r.Section] = core
	}
	return out
}

// allSectionsReadyToSend returns true only when all four sections are "approved"
// (not pending, not stale). Used by HandleSend.
func allSectionsReadyToSend(
	approvalRows []database.GetSessionSectionStatesRow,
	editRows []database.GetSessionSectionEditsRow,
) bool {
	states := buildSectionStates(approvalRows, editRows)
	for _, k := range sectionKeys {
		if states[k].state != "approved" {
			return false
		}
	}
	return true
}

// allSectionsApproved checks only approval events (no edit consideration).
// Kept for tests that verify the event-log invariant in isolation.
func allSectionsApproved(rows []database.GetSessionSectionStatesRow) bool {
	approved := make(map[string]bool, len(sectionKeys))
	for _, r := range rows {
		if r.Action == "approved" {
			approved[r.Section] = true
		} else {
			approved[r.Section] = false
		}
	}
	for _, k := range sectionKeys {
		if !approved[k] {
			return false
		}
	}
	return true
}

// sectionContentFromAI extracts the original AI-generated content for a section
// as a JSON-encoded value ready to embed in a response.
func sectionContentFromAI(section string, output *ScribeOutput) json.RawMessage {
	if output == nil {
		return sectionContentEmpty(section)
	}
	var v any
	switch section {
	case "hpi":
		v = output.HPI
	case "plan":
		v = output.AssessmentPlan
	case "exam":
		v = output.PhysicalExam
	case "labs":
		v = output.DiagnosesLabs
	default:
		return sectionContentEmpty(section)
	}
	b, _ := json.Marshal(v)
	return b
}

func sectionContentEmpty(section string) json.RawMessage {
	if section == "labs" {
		return json.RawMessage(`[]`)
	}
	return json.RawMessage(`""`)
}

// buildDetailSections assembles the full section response including content and
// human-readable timestamps, suitable for the GET detail endpoint.
func buildDetailSections(
	states map[string]sectionStateCore,
	editRows []database.GetSessionSectionEditsRow,
	aiOutput *ScribeOutput,
) map[string]sectionState {
	// Index edit content per section
	editContent := make(map[string]json.RawMessage, len(editRows))
	for _, e := range editRows {
		editContent[e.Section] = json.RawMessage(e.Content)
	}

	out := make(map[string]sectionState, len(sectionKeys))
	for _, k := range sectionKeys {
		core := states[k]
		content, hasEdit := editContent[k]
		if !hasEdit {
			content = sectionContentFromAI(k, aiOutput)
		}
		s := sectionState{State: core.state, Content: content}
		if core.approvedAt.Valid {
			s.ApprovedByName = core.approvedByName
			s.ApprovedAt = core.approvedAt.Time.UTC().Format("2006-01-02T15:04:05Z")
		}
		if core.editedAt.Valid {
			s.EditedAt = core.editedAt.Time.UTC().Format("2006-01-02T15:04:05Z")
		}
		out[k] = s
	}
	return out
}

func (h *Handler) HandleProcess(w http.ResponseWriter, r *http.Request) {
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

	var req processRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if err := req.validate(); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
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

	// Store transcript and mark processing
	err = h.queries.UpdateScribeSessionProcessing(r.Context(), database.UpdateScribeSessionProcessingParams{
		ID:         sessionUUID,
		TenantID:   tenantUUID,
		Transcript: pgtype.Text{String: req.Transcript, Valid: true},
	})
	if err != nil {
		http.Error(w, "failed to update session", http.StatusInternalServerError)
		return
	}

	// Run the AI pipeline
	output, err := h.processor.Process(r.Context(), h.cfg.AthenaPracticeID, session.PatientID, req.Transcript)
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

	// Parse, validate, and persist the uploaded audio file for later playback.
	file, ext, err := parseAudioUpload(r, maxUploadSize)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	defer file.Close()
	audioBytes, err := h.saveSessionAudio(file, claims.TenantID, sessionID, ext)
	if err != nil {
		log.Printf("scribe audio save error for session %s: %v", sessionID, err)
		http.Error(w, "failed to save audio", http.StatusInternalServerError)
		return
	}
	log.Printf("scribe audio saved for session %s: %d bytes (ext=%s)", sessionID, audioBytes, ext)

	// Convert to FLAC via ffmpeg
	flacReader, cleanup, err := transcribe.ConvertToFLAC(r.Context(), file)
	if err != nil {
		log.Printf("scribe audio conversion error for session %s: %v", sessionID, err)
		http.Error(w, "failed to convert audio", http.StatusInternalServerError)
		return
	}

	// Transcribe the audio
	transcript, err := h.transcriber.Transcribe(r.Context(), &transcribe.AudioInput{
		Reader:     flacReader,
		SampleRate: transcribe.DefaultSampleRate(),
	})
	// ffmpeg has exited by the time Transcribe returns (stdout EOF). Capture
	// its exit error now so we can report it as the root cause when the
	// transcript came back empty or transcription itself failed.
	ffmpegErr := cleanup()
	if ffmpegErr != nil {
		log.Printf("scribe ffmpeg error for session %s: %v", sessionID, ffmpegErr)
	}
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
		errMsg := "transcription returned empty result"
		if ffmpegErr != nil {
			errMsg = fmt.Sprintf("audio conversion failed: %v", ffmpegErr)
		}
		log.Printf("scribe transcription empty result for session %s (%d bytes uploaded)", sessionID, audioBytes)
		_ = h.queries.UpdateScribeSessionError(r.Context(), database.UpdateScribeSessionErrorParams{
			ID:           sessionUUID,
			TenantID:     tenantUUID,
			ErrorMessage: pgtype.Text{String: errMsg, Valid: true},
		})
		http.Error(w, errMsg, http.StatusInternalServerError)
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

func (h *Handler) HandleEditSection(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	section := chi.URLParam(r, "section")
	if !isValidSection(section) {
		http.Error(w, "invalid section", http.StatusBadRequest)
		return
	}

	sessionUUID := pgtype.UUID{}
	if err := sessionUUID.Scan(chi.URLParam(r, "id")); err != nil {
		http.Error(w, "invalid session ID", http.StatusBadRequest)
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

	session, err := h.queries.GetScribeSession(r.Context(), database.GetScribeSessionParams{
		ID:       sessionUUID,
		TenantID: tenantUUID,
	})
	if err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	if session.Status != "complete" {
		http.Error(w, "session is not ready for editing", http.StatusBadRequest)
		return
	}
	if session.RejectedAt.Valid {
		http.Error(w, "rejected sessions cannot be edited", http.StatusBadRequest)
		return
	}
	if session.SentToEhrAt.Valid {
		http.Error(w, "sent sessions cannot be edited", http.StatusBadRequest)
		return
	}

	// Parse and validate the content field per section type.
	var body struct {
		Content json.RawMessage `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Content == nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if err := validateSectionContent(section, body.Content); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := h.queries.RecordSectionEdit(r.Context(), database.RecordSectionEditParams{
		SessionID: sessionUUID,
		Section:   section,
		Content:   body.Content,
		EditedBy:  userUUID,
	}); err != nil {
		http.Error(w, "failed to record edit", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte("{}"))
}

// validateSectionContent checks that the raw JSON content matches the expected
// shape for the given section: a string for text sections, an array of
// {diagnosis, lab} objects for labs.
func validateSectionContent(section string, raw json.RawMessage) error {
	if section == "labs" {
		var rows []DiagnosisLab
		if err := json.Unmarshal(raw, &rows); err != nil {
			return fmt.Errorf("labs content must be an array of {diagnosis, lab} objects")
		}
		return nil
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return fmt.Errorf("%s content must be a string", section)
	}
	return nil
}

func (h *Handler) HandleReject(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	sessionUUID := pgtype.UUID{}
	if err := sessionUUID.Scan(chi.URLParam(r, "id")); err != nil {
		http.Error(w, "invalid session ID", http.StatusBadRequest)
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

	session, err := h.queries.GetScribeSession(r.Context(), database.GetScribeSessionParams{
		ID:       sessionUUID,
		TenantID: tenantUUID,
	})
	if err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	if session.Status != "complete" {
		http.Error(w, "only complete sessions can be rejected", http.StatusBadRequest)
		return
	}

	n, err := h.queries.MarkScribeSessionRejected(r.Context(), database.MarkScribeSessionRejectedParams{
		ID:         sessionUUID,
		TenantID:   tenantUUID,
		RejectedBy: userUUID,
	})
	if err != nil {
		http.Error(w, "failed to reject session", http.StatusInternalServerError)
		return
	}
	if n == 0 {
		http.Error(w, "session already rejected or already sent", http.StatusConflict)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte("{}"))
}

func (h *Handler) HandleApproveSection(w http.ResponseWriter, r *http.Request) {
	h.handleSectionAction(w, r, "approved")
}

func (h *Handler) HandleRevokeSection(w http.ResponseWriter, r *http.Request) {
	h.handleSectionAction(w, r, "revoked")
}

func (h *Handler) HandleSend(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	sessionUUID := pgtype.UUID{}
	if err := sessionUUID.Scan(chi.URLParam(r, "id")); err != nil {
		http.Error(w, "invalid session ID", http.StatusBadRequest)
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

	session, err := h.queries.GetScribeSession(r.Context(), database.GetScribeSessionParams{
		ID:       sessionUUID,
		TenantID: tenantUUID,
	})
	if err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	if session.Status != "complete" {
		http.Error(w, "session is not ready to send", http.StatusBadRequest)
		return
	}

	approvalRows, err := h.queries.GetSessionSectionStates(r.Context(), sessionUUID)
	if err != nil {
		http.Error(w, "failed to load section states", http.StatusInternalServerError)
		return
	}
	editRows, err := h.queries.GetSessionSectionEdits(r.Context(), sessionUUID)
	if err != nil {
		http.Error(w, "failed to load section edits", http.StatusInternalServerError)
		return
	}
	if !allSectionsReadyToSend(approvalRows, editRows) {
		http.Error(w, "all sections must be approved (re-approve any edited sections)", http.StatusBadRequest)
		return
	}

	// Mark sent first — the UPDATE is the gate against double-sends.
	// 0 rows affected means already sent by a concurrent request.
	n, err := h.queries.MarkScribeSessionSent(r.Context(), database.MarkScribeSessionSentParams{
		ID:          sessionUUID,
		TenantID:    tenantUUID,
		SentToEhrBy: userUUID,
	})
	if err != nil {
		http.Error(w, "failed to mark session as sent", http.StatusInternalServerError)
		return
	}
	if n == 0 {
		http.Error(w, "session already sent", http.StatusConflict)
		return
	}

	// Call athena after marking. If athena fails, the session remains marked sent
	// in the DB — do not roll back. A timeout means athena may have received the
	// write; rolling back and retrying risks a duplicate note in the EMR.
	// Manual resolution required on persistent failure; that's preferable to a double-send.
	if session.AiOutput != nil {
		var output ScribeOutput
		if err := json.Unmarshal(session.AiOutput, &output); err == nil {
			if writeErr := h.processor.WriteToAthena(r.Context(), h.cfg.AthenaPracticeID, session.EncounterID, output); writeErr != nil {
				log.Printf("scribe send: athena write error for session %s (marked sent, manual review needed): %v", uuidToString(sessionUUID), writeErr)
				http.Error(w, "sent to EHR failed — contact support", http.StatusInternalServerError)
				return
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte("{}"))
}

func (h *Handler) handleSectionAction(w http.ResponseWriter, r *http.Request, action string) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	section := chi.URLParam(r, "section")
	if !isValidSection(section) {
		http.Error(w, "invalid section", http.StatusBadRequest)
		return
	}

	sessionUUID := pgtype.UUID{}
	if err := sessionUUID.Scan(chi.URLParam(r, "id")); err != nil {
		http.Error(w, "invalid session ID", http.StatusBadRequest)
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

	session, err := h.queries.GetScribeSession(r.Context(), database.GetScribeSessionParams{
		ID:       sessionUUID,
		TenantID: tenantUUID,
	})
	if err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	if session.Status != "complete" {
		http.Error(w, "session is not ready for approval", http.StatusBadRequest)
		return
	}

	if err := h.queries.RecordSectionApproval(r.Context(), database.RecordSectionApprovalParams{
		SessionID: sessionUUID,
		Section:   section,
		Action:    action,
		UserID:    userUUID,
	}); err != nil {
		http.Error(w, "failed to record approval", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte("{}"))
}

func (h *Handler) HandleCreateFeedback(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	sessionUUID := pgtype.UUID{}
	if err := sessionUUID.Scan(chi.URLParam(r, "id")); err != nil {
		http.Error(w, "invalid session ID", http.StatusBadRequest)
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

	if _, err := h.queries.GetScribeSession(r.Context(), database.GetScribeSessionParams{
		ID:       sessionUUID,
		TenantID: tenantUUID,
	}); err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	var req createFeedbackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if err := req.validate(); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	row, err := h.queries.CreateFeedback(r.Context(), database.CreateFeedbackParams{
		SessionID: sessionUUID,
		Section:   req.Section,
		Category:  req.Category,
		Body:      strings.TrimSpace(req.Body),
		UserID:    userUUID,
	})
	if err != nil {
		http.Error(w, "failed to save feedback", http.StatusInternalServerError)
		return
	}

	user, err := h.queries.GetUserByID(r.Context(), userUUID)
	if err != nil {
		http.Error(w, "failed to load author", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(feedbackResponse{
		ID:             uuidToString(row.ID),
		Section:        row.Section,
		Category:       row.Category,
		Body:           row.Body,
		Author:         user.Name,
		AuthorInitials: deriveInitials(user.Name),
		At:             row.At.Time.UTC().Format("2006-01-02T15:04:05Z"),
	})
}

func (h *Handler) HandleListFeedback(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	sessionUUID := pgtype.UUID{}
	if err := sessionUUID.Scan(chi.URLParam(r, "id")); err != nil {
		http.Error(w, "invalid session ID", http.StatusBadRequest)
		return
	}
	tenantUUID := pgtype.UUID{}
	if err := tenantUUID.Scan(claims.TenantID); err != nil {
		http.Error(w, "invalid tenant context", http.StatusBadRequest)
		return
	}

	if _, err := h.queries.GetScribeSession(r.Context(), database.GetScribeSessionParams{
		ID:       sessionUUID,
		TenantID: tenantUUID,
	}); err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	rows, err := h.queries.GetSessionFeedback(r.Context(), sessionUUID)
	if err != nil {
		http.Error(w, "failed to load feedback", http.StatusInternalServerError)
		return
	}

	out := make([]feedbackResponse, 0, len(rows))
	for _, row := range rows {
		out = append(out, feedbackResponse{
			ID:             uuidToString(row.ID),
			Section:        row.Section,
			Category:       row.Category,
			Body:           row.Body,
			Author:         row.AuthorName,
			AuthorInitials: deriveInitials(row.AuthorName),
			At:             row.At.Time.UTC().Format("2006-01-02T15:04:05Z"),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

func toSessionResponse(s database.ScribeSession) sessionResponse {
	resp := sessionResponse{
		ID:           uuidToString(s.ID),
		PatientID:    s.PatientID,
		EncounterID:  s.EncounterID,
		DepartmentID: s.DepartmentID,
		Status:       s.Status,
		CreatedAt:    s.CreatedAt.Time.UTC().Format("2006-01-02T15:04:05Z"),
	}
	if s.ErrorMessage.Valid {
		resp.ErrorMessage = s.ErrorMessage.String
	}
	if s.CompletedAt.Valid {
		resp.CompletedAt = s.CompletedAt.Time.UTC().Format("2006-01-02T15:04:05Z")
	}
	if s.SentToEhrAt.Valid {
		resp.SentToEhrAt = s.SentToEhrAt.Time.UTC().Format("2006-01-02T15:04:05Z")
	}
	if s.RejectedAt.Valid {
		resp.RejectedAt = s.RejectedAt.Time.UTC().Format("2006-01-02T15:04:05Z")
	}
	return resp
}

func toListSessionResponse(s database.ListScribeSessionsRow) sessionResponse {
	resp := sessionResponse{
		ID:            uuidToString(s.ID),
		PatientID:     s.PatientID,
		EncounterID:   s.EncounterID,
		DepartmentID:  s.DepartmentID,
		Status:        s.Status,
		CreatedAt:     s.CreatedAt.Time.UTC().Format("2006-01-02T15:04:05Z"),
		ApprovedCount: int(s.ApprovedCount),
	}
	if s.ErrorMessage.Valid {
		resp.ErrorMessage = s.ErrorMessage.String
	}
	if s.CompletedAt.Valid {
		resp.CompletedAt = s.CompletedAt.Time.UTC().Format("2006-01-02T15:04:05Z")
	}
	if s.SentToEhrAt.Valid {
		resp.SentToEhrAt = s.SentToEhrAt.Time.UTC().Format("2006-01-02T15:04:05Z")
	}
	if s.RejectedAt.Valid {
		resp.RejectedAt = s.RejectedAt.Time.UTC().Format("2006-01-02T15:04:05Z")
	}
	return resp
}

func uuidToString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x", u.Bytes[0:4], u.Bytes[4:6], u.Bytes[6:8], u.Bytes[8:10], u.Bytes[10:16])
}
