package approval

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andybarilla/emrai/internal/database"
	"github.com/andybarilla/emrai/internal/emr"
)

func makeProtocol(procedureName, stdDosage string, maxLabDays int32, requiresEstablished bool) database.Protocol {
	p := database.Protocol{
		ProcedureName:              procedureName,
		MaxLabAgeDays:              maxLabDays,
		RequiresEstablishedPatient: requiresEstablished,
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
	patient := &emr.PatientContext{PatientID: "p1"}
	protocols := []database.Protocol{makeProtocol("Testosterone Injection", "200mg", 90, true)}

	reasons := CheckProtocols(item, patient, protocols, time.Now())
	if len(reasons) != 1 || reasons[0] != "no matching protocol — requires individual review" {
		t.Errorf("expected no-match reason, got %v", reasons)
	}
}

func TestCheckProtocols_StandardOrder(t *testing.T) {
	item := makeItem("Testosterone Injection", "200mg")
	patient := &emr.PatientContext{
		PatientID:    "p1",
		IsNewPatient: false,
		LastLabDate:  time.Now().AddDate(0, -1, 0).Format("2006-01-02"),
	}
	protocols := []database.Protocol{makeProtocol("Testosterone Injection", "200mg", 90, true)}

	reasons := CheckProtocols(item, patient, protocols, time.Now())
	if len(reasons) != 0 {
		t.Errorf("expected no flags for standard order, got %v", reasons)
	}
}

func TestCheckProtocols_DosageDiffers(t *testing.T) {
	item := makeItem("Testosterone Injection", "300mg")
	patient := &emr.PatientContext{
		PatientID:   "p1",
		LastLabDate: time.Now().AddDate(0, -1, 0).Format("2006-01-02"),
	}
	protocols := []database.Protocol{makeProtocol("Testosterone Injection", "200mg", 90, true)}

	reasons := CheckProtocols(item, patient, protocols, time.Now())
	found := false
	for _, r := range reasons {
		if r == "dosage differs from standard (300mg vs 200mg)" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected dosage-differs flag, got %v", reasons)
	}
}

func TestCheckProtocols_NewPatient(t *testing.T) {
	item := makeItem("Testosterone Injection", "200mg")
	patient := &emr.PatientContext{
		PatientID:    "p1",
		IsNewPatient: true,
		LastLabDate:  time.Now().AddDate(0, -1, 0).Format("2006-01-02"),
	}
	protocols := []database.Protocol{makeProtocol("Testosterone Injection", "200mg", 90, true)}

	reasons := CheckProtocols(item, patient, protocols, time.Now())
	found := false
	for _, r := range reasons {
		if r == "new patient — requires individual review" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected new-patient flag, got %v", reasons)
	}
}

func TestCheckProtocols_OldLabs(t *testing.T) {
	item := makeItem("Testosterone Injection", "200mg")
	patient := &emr.PatientContext{
		PatientID:   "p1",
		LastLabDate: time.Now().AddDate(0, -6, 0).Format("2006-01-02"),
	}
	protocols := []database.Protocol{makeProtocol("Testosterone Injection", "200mg", 90, true)}

	reasons := CheckProtocols(item, patient, protocols, time.Now())
	found := false
	for _, r := range reasons {
		if r == "labs older than 90 days" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected old-labs flag, got %v", reasons)
	}
}

func TestCheckProtocols_NoLabs(t *testing.T) {
	item := makeItem("Testosterone Injection", "200mg")
	patient := &emr.PatientContext{
		PatientID: "p1",
	}
	protocols := []database.Protocol{makeProtocol("Testosterone Injection", "200mg", 90, true)}

	reasons := CheckProtocols(item, patient, protocols, time.Now())
	found := false
	for _, r := range reasons {
		if r == "no lab results on file" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected no-labs flag, got %v", reasons)
	}
}
