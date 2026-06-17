package main

import (
	"encoding/json"
	"testing"

	"github.com/andybarilla/janushc-dash/internal/scribe"
)

func TestLabelFromFirstDialog(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		transcript string
		want       string
	}{
		{
			name:       "diarized label",
			transcript: "Speaker 0: Jane Smith\nSpeaker 1: Hello",
			want:       "Jane Smith",
		},
		{
			name:       "empty diarization then next line",
			transcript: "Speaker 0:\nJane Smith",
			want:       "Jane Smith",
		},
		{
			name:       "plain transcript",
			transcript: "Jane Smith\nFollow-up discussion",
			want:       "Jane Smith",
		},
		{
			name:       "blank and quote only returns empty",
			transcript: "\n\t\n\"\"\n‘’\n  ”  ",
			want:       "",
		},
		{
			name:       "punctuation outside quote trim set remains",
			transcript: "---Jane Smith…",
			want:       "---Jane Smith…",
		},
		{
			name:       "whitespace around lines prefix and label",
			transcript: "  \n \t Speaker 12: \t “Jane Smith” \t \nSpeaker 1: ignored",
			want:       "Jane Smith",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got := labelFromFirstDialog(tt.transcript)
			if got != tt.want {
				t.Fatalf("labelFromFirstDialog() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestAIOutputJSONStoresScribeOutputFieldsAtTopLevel(t *testing.T) {
	processResult := scribe.ProcessResult{
		Output: scribe.ScribeOutput{
			HPI:            "Patient feels well.",
			AssessmentPlan: "Continue current medications.",
			PhysicalExam:   "Cardiac: regular rate and rhythm.",
			DiagnosesLabs: []scribe.DiagnosisLab{
				{Diagnosis: "I10 Hypertension", Lab: "CMP"},
			},
		},
		Usage: scribe.LLMUsage{ModelID: "test-model", InputTokens: 10, OutputTokens: 20, TotalTokens: 30},
	}

	storedAIOutput, err := aiOutputJSON(processResult)
	if err != nil {
		t.Fatalf("marshal AI output: %v", err)
	}

	var stored map[string]json.RawMessage
	if err := json.Unmarshal(storedAIOutput, &stored); err != nil {
		t.Fatalf("unmarshal stored AI output: %v", err)
	}

	for _, field := range []string{"hpi", "assessment_plan", "physical_exam", "diagnoses_labs"} {
		if _, ok := stored[field]; !ok {
			t.Fatalf("expected %q at top level, got keys %v", field, stored)
		}
	}
	for _, nestedField := range []string{"Output", "Usage"} {
		if _, ok := stored[nestedField]; ok {
			t.Fatalf("did not expect %q at top level, got keys %v", nestedField, stored)
		}
	}
}
