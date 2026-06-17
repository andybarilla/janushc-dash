package main

import (
	"encoding/json"
	"testing"

	"github.com/andybarilla/janushc-dash/internal/scribe"
)

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
