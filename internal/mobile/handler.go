// Package mobile serves the native mobile recorder spike (issue #7). The single
// endpoint here is a placeholder that proves the spike app can upload a recorded
// visit. It is deliberately minimal: no auth, no database, no transcription. The
// production shape — recording sessions, signed S3 upload, transcription job
// linkage — is documented in docs/mobile-recorder-spike.md and is out of scope
// until the build decision in issue #7 is made.
package mobile

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/andybarilla/janushc-dash/internal/config"
)

// maxUploadSize caps an upload at 200 MB. A 60-minute HIGH_QUALITY m4a from
// expo-av is roughly 30–60 MB, so this leaves comfortable headroom.
const maxUploadSize = 200 << 20

type Handler struct {
	cfg *config.Config
}

func NewHandler(cfg *config.Config) *Handler {
	return &Handler{cfg: cfg}
}

type recordingResponse struct {
	StoredPath   string `json:"stored_path"`
	SizeBytes    int64  `json:"size_bytes"`
	PatientLabel string `json:"patient_label"`
	CreatedAt    string `json:"created_at"`
	ReceivedAt   string `json:"received_at"`
}

// HandleCreateRecording accepts the spike app's multipart upload (audio file
// plus patient_label and created_at fields), writes the audio to disk, and
// echoes back what it stored so the device can confirm the round trip.
//
// The endpoint is internet-facing once deployed, so it is guarded by a shared
// token: it stays disabled until MOBILE_SPIKE_TOKEN is set, and then requires a
// matching "Authorization: Bearer <token>" header.
func (h *Handler) HandleCreateRecording(w http.ResponseWriter, r *http.Request) {
	token := ""
	if h.cfg != nil {
		token = h.cfg.MobileSpikeToken
	}
	if token == "" {
		http.Error(w, "mobile recorder endpoint disabled", http.StatusServiceUnavailable)
		return
	}
	if subtle.ConstantTimeCompare([]byte(bearerToken(r.Header.Get("Authorization"))), []byte(token)) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)

	file, header, err := r.FormFile("audio")
	if err != nil {
		http.Error(w, "missing or invalid audio file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	dir := h.recordingsDir()
	if err := os.MkdirAll(dir, 0o750); err != nil {
		log.Printf("mobile recording: prepare storage: %v", err)
		http.Error(w, "failed to prepare storage", http.StatusInternalServerError)
		return
	}

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if ext == "" {
		ext = ".m4a"
	}
	storedPath := filepath.Join(dir, fmt.Sprintf("%d%s", time.Now().UnixNano(), ext))

	out, err := os.OpenFile(storedPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		log.Printf("mobile recording: create file: %v", err)
		http.Error(w, "failed to save recording", http.StatusInternalServerError)
		return
	}
	size, copyErr := io.Copy(out, file)
	closeErr := out.Close()
	if copyErr != nil {
		log.Printf("mobile recording: write file: %v", copyErr)
		http.Error(w, "failed to save recording", http.StatusInternalServerError)
		return
	}
	if closeErr != nil {
		log.Printf("mobile recording: close file: %v", closeErr)
	}

	resp := recordingResponse{
		StoredPath:   storedPath,
		SizeBytes:    size,
		PatientLabel: r.FormValue("patient_label"),
		CreatedAt:    r.FormValue("created_at"),
		ReceivedAt:   time.Now().UTC().Format(time.RFC3339),
	}
	log.Printf("mobile recording: stored %d bytes at %s (label=%q)", size, storedPath, resp.PatientLabel)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(resp)
}

// bearerToken extracts the credentials from an "Authorization: Bearer <token>"
// header, returning "" if the header is absent or malformed.
func bearerToken(header string) string {
	const prefix = "Bearer "
	if len(header) > len(prefix) && strings.EqualFold(header[:len(prefix)], prefix) {
		return header[len(prefix):]
	}
	return ""
}

func (h *Handler) recordingsDir() string {
	if h.cfg != nil && h.cfg.MobileRecordingsDir != "" {
		return h.cfg.MobileRecordingsDir
	}
	return "tmp/mobile-recordings"
}
