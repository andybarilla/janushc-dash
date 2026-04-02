package transcribe

import (
	"context"
	"io"
)

// AudioInput contains the audio data and metadata needed for transcription.
type AudioInput struct {
	Reader     io.Reader
	SampleRate int32
}

// Transcriber converts audio to text using a medical transcription service.
type Transcriber interface {
	Transcribe(ctx context.Context, audio *AudioInput) (string, error)
}
