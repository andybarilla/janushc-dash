package scribe

import (
	"testing"

	"github.com/andybarilla/janushc-dash/internal/emr"
)

func TestBuildUserPrompt_WithDiarization(t *testing.T) {
	transcript := "Provider: How are you feeling today?\nPatient: My back has been hurting."
	diagnoses := []emr.Diagnosis{
		{Code: "E66.01", Description: "Morbid obesity"},
	}

	prompt := buildUserPrompt(transcript, diagnoses)

	if prompt == "" {
		t.Fatal("expected non-empty prompt")
	}
	if !contains(prompt, "back has been hurting") {
		t.Error("prompt should contain transcript text")
	}
	if !contains(prompt, "E66.01") {
		t.Error("prompt should contain diagnosis codes")
	}
	if !contains(prompt, "Morbid obesity") {
		t.Error("prompt should contain diagnosis descriptions")
	}
}

func TestBuildUserPrompt_NoDiagnoses(t *testing.T) {
	transcript := "Provider: Let's check your labs."
	prompt := buildUserPrompt(transcript, nil)

	if prompt == "" {
		t.Fatal("expected non-empty prompt")
	}
	if !contains(prompt, "check your labs") {
		t.Error("prompt should contain transcript text")
	}
}

func TestParseAIOutput_ValidJSON(t *testing.T) {
	raw := `{
		"hpi": "Patient presents with lower back pain for 2 weeks.",
		"assessment_plan": "1. Lower back pain - order lumbar X-ray\n2. Continue ibuprofen 400mg",
		"physical_exam": "General: Alert, oriented. Musculoskeletal: Tenderness over L4-L5. Respiratory: Clear bilateral.",
		"diagnoses_labs": [
			{"diagnosis": "M54.5 - Low back pain", "lab": "Lumbar X-ray"}
		]
	}`

	output, err := parseAIOutput(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if output.HPI != "Patient presents with lower back pain for 2 weeks." {
		t.Errorf("unexpected HPI: %s", output.HPI)
	}
	if output.AssessmentPlan == "" {
		t.Error("expected non-empty assessment plan")
	}
	if output.PhysicalExam == "" {
		t.Error("expected non-empty physical exam")
	}
	if len(output.DiagnosesLabs) != 1 {
		t.Errorf("expected 1 diagnosis/lab pair, got %d", len(output.DiagnosesLabs))
	}
}

func TestParseAIOutput_InvalidJSON(t *testing.T) {
	_, err := parseAIOutput("this is not json")
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
