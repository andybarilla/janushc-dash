package scribe

import (
	"encoding/json"

	"github.com/andybarilla/janushc-dash/internal/database"
)

// effectiveOutput returns the scribe output to write to the EHR: the AI output
// with each section replaced by the provider's latest edit when one exists.
// Edits are stored per section as validated JSON (a string for text sections, a
// []DiagnosisLab for labs). Malformed edit content falls back to the AI value.
func effectiveOutput(aiOutput []byte, editRows []database.GetSessionSectionEditsRow) ScribeOutput {
	var out ScribeOutput
	_ = json.Unmarshal(aiOutput, &out)

	for _, e := range editRows {
		switch e.Section {
		case "hpi":
			var s string
			if json.Unmarshal(e.Content, &s) == nil {
				out.HPI = s
			}
		case "plan":
			var s string
			if json.Unmarshal(e.Content, &s) == nil {
				out.AssessmentPlan = s
			}
		case "exam":
			var s string
			if json.Unmarshal(e.Content, &s) == nil {
				out.PhysicalExam = s
			}
		case "labs":
			var rows []DiagnosisLab
			if json.Unmarshal(e.Content, &rows) == nil {
				out.DiagnosesLabs = rows
			}
		}
	}
	return out
}
