package transcriptimport

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"

	"github.com/andybarilla/janushc-dash/internal/bedrock"
)

const inferPatientNameMaxTokens = 64

var transcriptSpeakerPrefix = regexp.MustCompile(`^\s*Speaker\s+\d+\s*:`)

type CompletionClient interface {
	Complete(ctx context.Context, systemPrompt, userPrompt string, maxTokens int) (bedrock.CompletionResult, error)
}

func FirstCleanTranscriptLine(transcript string) string {
	for _, line := range strings.Split(transcript, "\n") {
		withoutSpeaker := transcriptSpeakerPrefix.ReplaceAllString(line, "")
		cleanLine := strings.Trim(strings.TrimSpace(withoutSpeaker), " \t\n\r\"'“”‘’")
		if cleanLine == "" {
			continue
		}

		return cleanLine
	}

	return ""
}

func InferPatientName(ctx context.Context, client CompletionClient, firstLine string) (string, error) {
	systemPrompt := `Extract the patient name from the transcript opening. Return only JSON in this exact shape: {"patient_name":"..."}. Use an empty string when no clear patient name is present.`
	userPrompt := "Transcript first line:\n" + firstLine

	result, err := client.Complete(ctx, systemPrompt, userPrompt, inferPatientNameMaxTokens)
	if err != nil {
		return "", err
	}

	return ParseInferredPatientName(result.Text), nil
}

func ParseInferredPatientName(raw string) string {
	var parsed struct {
		PatientName string `json:"patient_name"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &parsed); err != nil {
		return ""
	}

	patientName := strings.TrimSpace(parsed.PatientName)
	if patientName == "" {
		return ""
	}
	if isUncertainPatientName(patientName) {
		return ""
	}

	return patientName
}

func isUncertainPatientName(patientName string) bool {
	normalized := strings.ToLower(strings.TrimSpace(patientName))
	uncertainNames := map[string]struct{}{
		"unknown":         {},
		"unknown patient": {},
		"uncertain":       {},
		"unsure":          {},
		"n/a":             {},
		"none":            {},
	}
	_, uncertain := uncertainNames[normalized]
	return uncertain
}
