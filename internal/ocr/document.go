package ocr

import (
	"fmt"
	"path/filepath"
	"strings"
)

// MaxUploadSize bounds an uploaded document's size.
const MaxUploadSize = 50 << 20 // 50 MB

var allowedExts = map[string]bool{
	".pdf": true, ".png": true, ".jpg": true, ".jpeg": true, ".tif": true, ".tiff": true,
}

// ValidateExt reports whether ext (including the leading dot) is a document type
// supported for OCR.
func ValidateExt(ext string) error {
	if !allowedExts[strings.ToLower(ext)] {
		return fmt.Errorf("unsupported file type %q (allowed: pdf, png, jpg, jpeg, tif, tiff)", ext)
	}
	return nil
}

// ContentTypeForFilename returns a MIME type derived from the file extension
// (never from a client-supplied content type), defaulting to
// application/octet-stream. Serving a derived type avoids stored-XSS via a
// spoofed upload content type.
func ContentTypeForFilename(filename string) string {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".pdf":
		return "application/pdf"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".tif", ".tiff":
		return "image/tiff"
	default:
		return "application/octet-stream"
	}
}
