package scribe

import (
	"context"
	"errors"
	"testing"

	"github.com/andybarilla/janushc-dash/internal/bedrock"
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

func TestProcessorReturnsOutputAndUsage(t *testing.T) {
	processor := &Processor{
		bedrock: fakeCompletionClient{result: bedrock.CompletionResult{
			Text:         `{"hpi":"Patient is stable.","assessment_plan":"Continue plan.","physical_exam":"Normal.","diagnoses_labs":[]}`,
			ModelID:      "anthropic.claude-test",
			InputTokens:  100,
			OutputTokens: 50,
		}},
		emr: fakeProcessorEMR{},
	}

	result, err := processor.Process(context.Background(), "practice-1", "patient-1", "transcript")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Output.HPI != "Patient is stable." {
		t.Fatalf("unexpected HPI: %s", result.Output.HPI)
	}
	if result.Usage.ModelID != "anthropic.claude-test" {
		t.Fatalf("unexpected model ID: %s", result.Usage.ModelID)
	}
	if result.Usage.InputTokens != 100 || result.Usage.OutputTokens != 50 || result.Usage.TotalTokens != 150 {
		t.Fatalf("unexpected usage: %+v", result.Usage)
	}
}

func TestProcessorParseErrorExposesUsage(t *testing.T) {
	rawOutput := `not json with patient says chest pain`
	processor := &Processor{
		bedrock: fakeCompletionClient{result: bedrock.CompletionResult{
			Text:         rawOutput,
			ModelID:      "anthropic.claude-test",
			InputTokens:  12,
			OutputTokens: 8,
		}},
		emr: fakeProcessorEMR{},
	}

	result, err := processor.Process(context.Background(), "practice-1", "patient-1", "transcript")
	if err == nil {
		t.Fatal("expected error")
	}
	var processErr *ProcessError
	if !errors.As(err, &processErr) {
		t.Fatalf("expected ProcessError, got %T", err)
	}
	if result.Usage.TotalTokens != 20 {
		t.Fatalf("unexpected result usage: %+v", result.Usage)
	}
	if processErr.Usage.TotalTokens != 20 {
		t.Fatalf("unexpected error usage: %+v", processErr.Usage)
	}
	if !contains(processErr.Error(), "parse output:") {
		t.Fatalf("expected sanitized parse error, got: %s", processErr.Error())
	}
	if contains(processErr.Error(), rawOutput) || contains(processErr.Error(), "chest pain") {
		t.Fatalf("expected raw output omitted from error, got: %s", processErr.Error())
	}
}

type fakeCompletionClient struct {
	result bedrock.CompletionResult
	err    error
}

func (f fakeCompletionClient) Complete(ctx context.Context, systemPrompt, userPrompt string, maxTokens int) (bedrock.CompletionResult, error) {
	return f.result, f.err
}

type fakeProcessorEMR struct{}

func (fakeProcessorEMR) ListPatientOrders(ctx context.Context, practiceID, patientID, departmentID string, orderTypes []string) ([]emr.Order, error) {
	return nil, nil
}
func (fakeProcessorEMR) ListDepartments(ctx context.Context, practiceID string) ([]emr.Department, error) {
	return nil, nil
}
func (fakeProcessorEMR) ListDepartmentPatients(ctx context.Context, practiceID, departmentID string) ([]emr.Patient, error) {
	return nil, nil
}
func (fakeProcessorEMR) GetPatientName(ctx context.Context, practiceID, patientID string) (string, error) {
	return "", nil
}
func (fakeProcessorEMR) ApproveOrders(ctx context.Context, practiceID string, orderIDs []string) ([]string, error) {
	return nil, nil
}
func (fakeProcessorEMR) GetActiveDiagnoses(ctx context.Context, practiceID, patientID string) ([]emr.Diagnosis, error) {
	return nil, nil
}
func (fakeProcessorEMR) ListTodayEncounters(ctx context.Context, practiceID, departmentID string) ([]emr.Encounter, error) {
	return nil, nil
}
func (fakeProcessorEMR) ListTodayAppointments(ctx context.Context, practiceID, departmentID string) ([]emr.Appointment, error) {
	return nil, nil
}
func (fakeProcessorEMR) ResolveEncounterID(ctx context.Context, practiceID, appointmentID string) (string, error) {
	return "", nil
}
func (fakeProcessorEMR) WriteEncounterHPI(ctx context.Context, practiceID, encounterID, hpiText string) error {
	return nil
}
func (fakeProcessorEMR) WriteEncounterAssessmentPlan(ctx context.Context, practiceID, encounterID, apText string) error {
	return nil
}
func (fakeProcessorEMR) WriteEncounterPhysicalExam(ctx context.Context, practiceID, encounterID, peText string) error {
	return nil
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
