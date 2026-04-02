package scribe

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andybarilla/janushc-dash/internal/auth"
	"github.com/andybarilla/janushc-dash/internal/config"
	"github.com/andybarilla/janushc-dash/internal/database"
)

type Handler struct {
	queries   *database.Queries
	processor *Processor
	cfg       *config.Config
}

func NewHandler(queries *database.Queries, processor *Processor, cfg *config.Config) *Handler {
	return &Handler{queries: queries, processor: processor, cfg: cfg}
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
	ID           string `json:"id"`
	PatientID    string `json:"patient_id"`
	EncounterID  string `json:"encounter_id"`
	DepartmentID string `json:"department_id"`
	Status       string `json:"status"`
	ErrorMessage string `json:"error_message,omitempty"`
	CreatedAt    string `json:"created_at"`
	CompletedAt  string `json:"completed_at,omitempty"`
}

type sessionDetailResponse struct {
	sessionResponse
	Transcript string       `json:"transcript,omitempty"`
	AIOutput   *ScribeOutput `json:"ai_output,omitempty"`
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
	json.NewEncoder(w).Encode(toSessionResponse(session))
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
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

	// Write to athena (non-blocking — if it fails, session is still complete with output cached)
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

func toSessionResponse(s database.ScribeSession) sessionResponse {
	resp := sessionResponse{
		ID:           uuidToString(s.ID),
		PatientID:    s.PatientID,
		EncounterID:  s.EncounterID,
		DepartmentID: s.DepartmentID,
		Status:       s.Status,
		CreatedAt:    s.CreatedAt.Time.Format("2006-01-02T15:04:05Z"),
	}
	if s.ErrorMessage.Valid {
		resp.ErrorMessage = s.ErrorMessage.String
	}
	if s.CompletedAt.Valid {
		resp.CompletedAt = s.CompletedAt.Time.Format("2006-01-02T15:04:05Z")
	}
	return resp
}

func toListSessionResponse(s database.ListScribeSessionsRow) sessionResponse {
	resp := sessionResponse{
		ID:           uuidToString(s.ID),
		PatientID:    s.PatientID,
		EncounterID:  s.EncounterID,
		DepartmentID: s.DepartmentID,
		Status:       s.Status,
		CreatedAt:    s.CreatedAt.Time.Format("2006-01-02T15:04:05Z"),
	}
	if s.ErrorMessage.Valid {
		resp.ErrorMessage = s.ErrorMessage.String
	}
	if s.CompletedAt.Valid {
		resp.CompletedAt = s.CompletedAt.Time.Format("2006-01-02T15:04:05Z")
	}
	return resp
}

func uuidToString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x", u.Bytes[0:4], u.Bytes[4:6], u.Bytes[6:8], u.Bytes[8:10], u.Bytes[10:16])
}
