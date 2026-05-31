package scribe

import (
	"encoding/json"
	"testing"

	"github.com/andybarilla/janushc-dash/internal/database"
)

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

func TestEffectiveOutput_EditOverridesAI(t *testing.T) {
	ai := mustJSON(t, ScribeOutput{
		HPI:            "ai hpi",
		AssessmentPlan: "ai plan",
		PhysicalExam:   "ai exam",
	})
	edits := []database.GetSessionSectionEditsRow{
		{Section: "hpi", Content: mustJSON(t, "edited hpi")},
	}

	out := effectiveOutput(ai, edits)

	if out.HPI != "edited hpi" {
		t.Errorf("HPI = %q, want edited content", out.HPI)
	}
	if out.AssessmentPlan != "ai plan" {
		t.Errorf("AssessmentPlan = %q, want AI fallback for unedited section", out.AssessmentPlan)
	}
	if out.PhysicalExam != "ai exam" {
		t.Errorf("PhysicalExam = %q, want AI fallback for unedited section", out.PhysicalExam)
	}
}

func TestEffectiveOutput_LabsEditMerges(t *testing.T) {
	ai := mustJSON(t, ScribeOutput{
		DiagnosesLabs: []DiagnosisLab{{Diagnosis: "ai dx", Lab: "ai lab"}},
	})
	edits := []database.GetSessionSectionEditsRow{
		{Section: "labs", Content: mustJSON(t, []DiagnosisLab{{Diagnosis: "edited dx", Lab: "edited lab"}})},
	}

	out := effectiveOutput(ai, edits)

	if len(out.DiagnosesLabs) != 1 || out.DiagnosesLabs[0].Diagnosis != "edited dx" || out.DiagnosesLabs[0].Lab != "edited lab" {
		t.Errorf("DiagnosesLabs = %+v, want edited content", out.DiagnosesLabs)
	}
}

func TestEffectiveOutput_NoEditsReturnsAI(t *testing.T) {
	ai := mustJSON(t, ScribeOutput{HPI: "ai hpi", PhysicalExam: "ai exam"})

	out := effectiveOutput(ai, nil)

	if out.HPI != "ai hpi" || out.PhysicalExam != "ai exam" {
		t.Errorf("got %+v, want unchanged AI output", out)
	}
}

func TestEffectiveOutput_MalformedEditFallsBackToAI(t *testing.T) {
	ai := mustJSON(t, ScribeOutput{HPI: "ai hpi"})
	edits := []database.GetSessionSectionEditsRow{
		{Section: "hpi", Content: []byte(`{not valid json`)},
	}

	out := effectiveOutput(ai, edits)

	if out.HPI != "ai hpi" {
		t.Errorf("HPI = %q, want AI fallback when edit content is malformed", out.HPI)
	}
}
