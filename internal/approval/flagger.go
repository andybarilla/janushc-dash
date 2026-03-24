package approval

import (
	"fmt"
	"strings"

	"github.com/andybarilla/emrai/internal/database"
)

func CheckProtocols(item database.ApprovalItem, protocols []database.Protocol) []string {
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

	stdDosage := ""
	if matchedProtocol.StandardDosage.Valid {
		stdDosage = matchedProtocol.StandardDosage.String
	}
	if stdDosage != "" && dosage != stdDosage {
		reasons = append(reasons, fmt.Sprintf("dosage differs from standard (%s vs %s)", dosage, stdDosage))
	}

	return reasons
}
