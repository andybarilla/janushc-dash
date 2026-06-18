package transcriptimport

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/andybarilla/janushc-dash/internal/bedrock"
)

type stubCompletionClient struct {
	result       bedrock.CompletionResult
	err          error
	systemPrompt string
	userPrompt   string
	maxTokens    int
}

func (s *stubCompletionClient) Complete(ctx context.Context, systemPrompt, userPrompt string, maxTokens int) (bedrock.CompletionResult, error) {
	s.systemPrompt = systemPrompt
	s.userPrompt = userPrompt
	s.maxTokens = maxTokens
	return s.result, s.err
}

func TestFirstCleanTranscriptLine(t *testing.T) {
	tests := []struct {
		name       string
		transcript string
		want       string
	}{
		{name: "strips speaker prefix", transcript: "\nSpeaker 1: Jane Smith is here\nSpeaker 2: hello", want: "Jane Smith is here"},
		{name: "keeps clean first line", transcript: "Jane Smith is here\nSpeaker 2: hello", want: "Jane Smith is here"},
		{name: "trims quotes", transcript: ` "Jane Smith is here" `, want: "Jane Smith is here"},
		{name: "blank transcript", transcript: " \n\t\n", want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := FirstCleanTranscriptLine(tt.transcript); got != tt.want {
				t.Fatalf("FirstCleanTranscriptLine() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestParseInferredPatientName(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "clear JSON", raw: `{"patient_name":" Jane Smith "}`, want: "Jane Smith"},
		{name: "fenced JSON", raw: "```json\n{\"patient_name\":\"Michelle Williamson\"}\n```", want: "Michelle Williamson"},
		{name: "blank field", raw: `{"patient_name":""}`, want: ""},
		{name: "missing field", raw: `{"other":"Jane"}`, want: ""},
		{name: "invalid JSON", raw: `Jane Smith`, want: ""},
		{name: "uncertain output", raw: `{"patient_name":"unknown patient"}`, want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ParseInferredPatientName(tt.raw); got != tt.want {
				t.Fatalf("ParseInferredPatientName() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestInferPatientName(t *testing.T) {
	sentinel := errors.New("bedrock failed")

	t.Run("returns parsed name", func(t *testing.T) {
		client := &stubCompletionClient{result: bedrock.CompletionResult{Text: `{"patient_name":"Jane Smith"}`}}
		got, err := InferPatientName(context.Background(), client, "Jane Smith is here")
		if err != nil {
			t.Fatalf("InferPatientName() error = %v", err)
		}
		if got != "Jane Smith" {
			t.Fatalf("InferPatientName() = %q, want Jane Smith", got)
		}
		if client.maxTokens <= 0 {
			t.Fatalf("InferPatientName() maxTokens = %d, want positive", client.maxTokens)
		}
		if !strings.Contains(client.systemPrompt, `{"patient_name":"..."}`) {
			t.Fatalf("InferPatientName() system prompt = %q, want JSON constraint", client.systemPrompt)
		}
		if !strings.Contains(client.userPrompt, "Jane Smith is here") {
			t.Fatalf("InferPatientName() user prompt = %q, want first line", client.userPrompt)
		}
	})

	t.Run("passes through bedrock error", func(t *testing.T) {
		got, err := InferPatientName(context.Background(), &stubCompletionClient{err: sentinel}, "Jane Smith is here")
		if !errors.Is(err, sentinel) {
			t.Fatalf("InferPatientName() error = %v, want %v", err, sentinel)
		}
		if got != "" {
			t.Fatalf("InferPatientName() = %q, want blank on error", got)
		}
	})
}
