package scribe

import (
	"testing"
)

func TestValidateCreateRequest_Valid(t *testing.T) {
	req := createSessionRequest{
		PatientID:    "12345",
		EncounterID:  "67890",
		DepartmentID: "1",
	}
	if err := req.validate(); err != nil {
		t.Errorf("expected valid request, got error: %v", err)
	}
}

func TestValidateCreateRequest_MissingPatientID(t *testing.T) {
	req := createSessionRequest{
		EncounterID:  "67890",
		DepartmentID: "1",
	}
	if err := req.validate(); err == nil {
		t.Error("expected error for missing patient_id")
	}
}

func TestValidateCreateRequest_MissingEncounterID(t *testing.T) {
	req := createSessionRequest{
		PatientID:    "12345",
		DepartmentID: "1",
	}
	if err := req.validate(); err == nil {
		t.Error("expected error for missing encounter_id")
	}
}

func TestValidateProcessRequest_Valid(t *testing.T) {
	req := processRequest{
		Transcript: "Provider: Hello. Patient: Hi.",
	}
	if err := req.validate(); err != nil {
		t.Errorf("expected valid request, got error: %v", err)
	}
}

func TestValidateProcessRequest_EmptyTranscript(t *testing.T) {
	req := processRequest{}
	if err := req.validate(); err == nil {
		t.Error("expected error for empty transcript")
	}
}
