package ocr

import (
	"fmt"
	"path/filepath"
	"strings"

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
