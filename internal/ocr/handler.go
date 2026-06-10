package ocr

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
