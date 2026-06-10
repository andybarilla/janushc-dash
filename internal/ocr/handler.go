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
