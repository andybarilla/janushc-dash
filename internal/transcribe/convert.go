package transcribe

import (
	"fmt"
	"io"
	"os/exec"
	"strings"
)

var allowedExtensions = map[string]bool{
	".mp3":  true,
	".m4a":  true,
	".wav":  true,
	".webm": true,
	".ogg":  true,
}

// DefaultSampleRate returns the sample rate used for transcription output.
// AWS Transcribe Medical works well with 16kHz for speech.
func DefaultSampleRate() int32 {
	return 16000
}

// ValidateAudioExtension checks if the file extension is an accepted audio format.
func ValidateAudioExtension(ext string) error {
	if !allowedExtensions[strings.ToLower(ext)] {
		return fmt.Errorf("unsupported audio format %q: accepted formats are .mp3, .m4a, .wav, .webm, .ogg", ext)
	}
	return nil
}

// ConvertToFLAC converts audio from any supported format to FLAC via ffmpeg.
// Reads from src and returns a reader of FLAC-encoded audio at 16kHz mono.
// The caller must call the returned cleanup function when done reading.
func ConvertToFLAC(src io.Reader) (io.ReadCloser, func(), error) {
	cmd := exec.Command("ffmpeg",
		"-i", "pipe:0",
		"-f", "flac",
		"-ar", "16000",
		"-ac", "1",
		"pipe:1",
	)
	cmd.Stdin = src

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, nil, fmt.Errorf("ffmpeg stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, nil, fmt.Errorf("start ffmpeg: %w", err)
	}

	cleanup := func() {
		stdout.Close()
		cmd.Wait()
	}

	return stdout, cleanup, nil
}
