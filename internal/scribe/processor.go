package scribe

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/andybarilla/janushc-dash/internal/bedrock"
	"github.com/andybarilla/janushc-dash/internal/emr"
)

type ScribeOutput struct {
	HPI            string         `json:"hpi"`
	AssessmentPlan string         `json:"assessment_plan"`
	PhysicalExam   string         `json:"physical_exam"`
	DiagnosesLabs  []DiagnosisLab `json:"diagnoses_labs"`
}

type DiagnosisLab struct {
	Diagnosis string `json:"diagnosis"`
	Lab       string `json:"lab"`
}

type Processor struct {
	bedrock *bedrock.Client
	emr     emr.EMR
}

func NewProcessor(bedrockClient *bedrock.Client, emrClient emr.EMR) *Processor {
	return &Processor{bedrock: bedrockClient, emr: emrClient}
}

const systemPrompt = `You are a medical scribe AI assistant. You receive a transcript of a doctor-patient visit along with the patient's active diagnoses.

Produce a JSON object with these fields:

1. "hpi" (string): History of Present Illness — a free-form text summary of the patient's current status, complaints, and what was discussed during the visit.

2. "assessment_plan" (string): Assessment & Plan — a numbered list of the doctor's decisions, actions, and orders. Include any labs or diagnoses mentioned in the conversation.

3. "physical_exam" (string): Physical Exam findings organized by body system. Mark systems as normal based on what the doctor describes (e.g., "lungs sound good" means respiratory is normal). For body systems not mentioned, omit them. IMPORTANT: Review the active diagnoses list — include relevant findings from active diagnoses that the doctor would not say aloud (e.g., if "obesity" is an active diagnosis, include it under the appropriate system). Never mark a finding as normal if the active diagnoses indicate an abnormality for that system.

4. "diagnoses_labs" (array of objects): Each object has "diagnosis" (ICD code and description) and "lab" (the lab or test associated with it). Extract these from the conversation.

Handle gracefully:
- Speaker labels may be noisy or missing — infer from context when possible.
- Single-mic recordings may have overlapping speech — do your best.
- If a section has no relevant content from the transcript, use an empty string or empty array.

Respond with ONLY the JSON object, no markdown formatting, no explanation.`

func buildUserPrompt(transcript string, diagnoses []emr.Diagnosis) string {
	var b strings.Builder
	b.WriteString("## Transcript\n\n")
	b.WriteString(transcript)
	b.WriteString("\n\n## Active Diagnoses\n\n")
	if len(diagnoses) == 0 {
		b.WriteString("None on file.\n")
	} else {
		for _, d := range diagnoses {
			fmt.Fprintf(&b, "- %s: %s\n", d.Code, d.Description)
		}
	}
	return b.String()
}

func parseAIOutput(raw string) (ScribeOutput, error) {
	// Strip markdown code fences if Claude wraps the response
	cleaned := strings.TrimSpace(raw)
	if strings.HasPrefix(cleaned, "```") {
		lines := strings.SplitN(cleaned, "\n", 2)
		if len(lines) == 2 {
			cleaned = lines[1]
		}
		if idx := strings.LastIndex(cleaned, "```"); idx > 0 {
			cleaned = cleaned[:idx]
		}
		cleaned = strings.TrimSpace(cleaned)
	}

	var output ScribeOutput
	if err := json.Unmarshal([]byte(cleaned), &output); err != nil {
		return ScribeOutput{}, fmt.Errorf("parse AI output: %w", err)
	}
	return output, nil
}

func (p *Processor) Process(ctx context.Context, practiceID, patientID, transcript string) (ScribeOutput, error) {
	diagnoses, err := p.emr.GetActiveDiagnoses(ctx, practiceID, patientID)
	if err != nil {
		// Non-fatal: process without diagnoses, physical exam pre-population will be limited
		diagnoses = nil
	}

	userPrompt := buildUserPrompt(transcript, diagnoses)
	raw, err := p.bedrock.Complete(ctx, systemPrompt, userPrompt, 4096)
	if err != nil {
		return ScribeOutput{}, fmt.Errorf("bedrock complete: %w", err)
	}

	output, err := parseAIOutput(raw)
	if err != nil {
		return ScribeOutput{}, fmt.Errorf("parse output: %w (raw: %s)", err, raw)
	}

	return output, nil
}

func (p *Processor) WriteToAthena(ctx context.Context, practiceID, encounterID string, output ScribeOutput) error {
	var errs []string

	if output.HPI != "" {
		if err := p.emr.WriteEncounterHPI(ctx, practiceID, encounterID, output.HPI); err != nil {
			errs = append(errs, fmt.Sprintf("HPI: %v", err))
		}
	}

	if output.AssessmentPlan != "" {
		if err := p.emr.WriteEncounterAssessmentPlan(ctx, practiceID, encounterID, output.AssessmentPlan); err != nil {
			errs = append(errs, fmt.Sprintf("A/P: %v", err))
		}
	}

	if output.PhysicalExam != "" {
		if err := p.emr.WriteEncounterPhysicalExam(ctx, practiceID, encounterID, output.PhysicalExam); err != nil {
			errs = append(errs, fmt.Sprintf("PE: %v", err))
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("athena write errors: %s", strings.Join(errs, "; "))
	}
	return nil
}
