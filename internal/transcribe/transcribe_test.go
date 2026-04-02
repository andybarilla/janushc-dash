package transcribe

import (
	"context"
	"strings"
	"testing"
)

// mockStream simulates the AWS Transcribe Medical streaming API.
type mockStream struct {
	transcript string
	err        error
}

func (m *mockStream) Transcribe(ctx context.Context, audio *AudioInput) (string, error) {
	if m.err != nil {
		return "", m.err
	}
	return m.transcript, nil
}

func TestNewClient(t *testing.T) {
	client, err := NewClient(context.Background(), "us-east-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if client == nil {
		t.Fatal("expected non-nil client")
	}
	var _ Transcriber = client // compile-time interface check
}

func TestTranscriberInterface(t *testing.T) {
	mock := &mockStream{transcript: "Provider: Hello. Patient: Hi."}
	var _ Transcriber = mock // compile-time interface check

	result, err := mock.Transcribe(context.Background(), &AudioInput{
		Reader:     strings.NewReader("fake audio"),
		SampleRate: 16000,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "Provider: Hello. Patient: Hi." {
		t.Errorf("unexpected transcript: %s", result)
	}
}

func TestDefaultSampleRate(t *testing.T) {
	rate := DefaultSampleRate()
	if rate != 16000 {
		t.Errorf("expected 16000, got %d", rate)
	}
}

func TestValidateAudioExtension(t *testing.T) {
	valid := []string{".mp3", ".m4a", ".wav", ".webm", ".ogg"}
	for _, ext := range valid {
		if err := ValidateAudioExtension(ext); err != nil {
			t.Errorf("expected %s to be valid, got error: %v", ext, err)
		}
	}

	invalid := []string{".txt", ".pdf", ".exe", ".jpg", ""}
	for _, ext := range invalid {
		if err := ValidateAudioExtension(ext); err == nil {
			t.Errorf("expected %s to be invalid", ext)
		}
	}
}
