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
