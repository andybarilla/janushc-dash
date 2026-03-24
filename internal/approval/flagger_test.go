package approval

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andybarilla/emrai/internal/database"
)

func makeProtocol(procedureName, stdDosage string) database.Protocol {
	p := database.Protocol{
		ProcedureName: procedureName,
	}
	if stdDosage != "" {
		p.StandardDosage = pgtype.Text{String: stdDosage, Valid: true}
	}
	return p
}

func makeItem(procedureName, dosage string) database.ApprovalItem {
	item := database.ApprovalItem{
		ProcedureName: procedureName,
	}
	if dosage != "" {
		item.Dosage = pgtype.Text{String: dosage, Valid: true}
	}
	return item
}

func TestCheckProtocols_NoMatch(t *testing.T) {
	item := makeItem("Unknown Procedure", "")
	protocols := []database.Protocol{makeProtocol("Testosterone Injection", "200mg")}

	reasons := CheckProtocols(item, protocols)
	if len(reasons) != 1 || reasons[0] != "no matching protocol — requires individual review" {
		t.Errorf("expected no-match reason, got %v", reasons)
	}
}

func TestCheckProtocols_StandardOrder(t *testing.T) {
	item := makeItem("Testosterone Injection", "200mg")
	protocols := []database.Protocol{makeProtocol("Testosterone Injection", "200mg")}

	reasons := CheckProtocols(item, protocols)
	if len(reasons) != 0 {
		t.Errorf("expected no flags for standard order, got %v", reasons)
	}
}

func TestCheckProtocols_DosageDiffers(t *testing.T) {
	item := makeItem("Testosterone Injection", "300mg")
	protocols := []database.Protocol{makeProtocol("Testosterone Injection", "200mg")}

	reasons := CheckProtocols(item, protocols)
	if len(reasons) != 1 || reasons[0] != "dosage differs from standard (300mg vs 200mg)" {
		t.Errorf("expected dosage-differs flag, got %v", reasons)
	}
}

func TestCheckProtocols_NoDosageProtocol(t *testing.T) {
	item := makeItem("Testosterone Injection", "200mg")
	protocols := []database.Protocol{makeProtocol("Testosterone Injection", "")}

	reasons := CheckProtocols(item, protocols)
	if len(reasons) != 0 {
		t.Errorf("expected no flags when protocol has no standard dosage, got %v", reasons)
	}
}
