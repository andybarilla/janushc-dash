package approval

import (
	"fmt"
	"strings"
	"time"

	"github.com/andybarilla/emrai/internal/database"
	"github.com/andybarilla/emrai/internal/emr"
)

// CheckProtocols runs rule-based flagging against configured protocols.
// Returns a list of flag reasons (empty = standard/routine).
// now is injectable for testability.
func CheckProtocols(item database.ApprovalItem, patient *emr.PatientContext, protocols []database.Protocol, now time.Time) []string {
	var reasons []string

	procedureName := item.ProcedureName
	dosage := ""
	if item.Dosage.Valid {
		dosage = item.Dosage.String
	}

	var matchedProtocol *database.Protocol
	for i, p := range protocols {
		if strings.EqualFold(p.ProcedureName, procedureName) {
			matchedProtocol = &protocols[i]
			break
		}
	}

	if matchedProtocol == nil {
		return []string{"no matching protocol — requires individual review"}
	}

	// Check dosage
	stdDosage := ""
	if matchedProtocol.StandardDosage.Valid {
		stdDosage = matchedProtocol.StandardDosage.String
	}
	if stdDosage != "" && dosage != stdDosage {
		reasons = append(reasons, fmt.Sprintf("dosage differs from standard (%s vs %s)", dosage, stdDosage))
	}

	// Check new patient
	if matchedProtocol.RequiresEstablishedPatient && patient.IsNewPatient {
		reasons = append(reasons, "new patient — requires individual review")
	}

	// Check lab age
	if patient.LastLabDate != "" {
		labDate, err := time.Parse("2006-01-02", patient.LastLabDate)
		if err == nil {
			maxAge := time.Duration(matchedProtocol.MaxLabAgeDays) * 24 * time.Hour
			if now.Sub(labDate) > maxAge {
				reasons = append(reasons, fmt.Sprintf("labs older than %d days", matchedProtocol.MaxLabAgeDays))
			}
		}
	} else {
		reasons = append(reasons, "no lab results on file")
	}

	return reasons
}
