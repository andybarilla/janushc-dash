package athena

import (
	"context"
	"fmt"

	"github.com/andybarilla/janushc-dash/internal/emr"
)

func (c *Client) GetActiveDiagnoses(ctx context.Context, practiceID, patientID string) ([]emr.Diagnosis, error) {
	// TODO: implement against athena API - GET /v1/{practiceID}/chart/{patientID}/problems
	return nil, fmt.Errorf("GetActiveDiagnoses not yet implemented")
}

func (c *Client) ListTodayEncounters(ctx context.Context, practiceID, departmentID string) ([]emr.Encounter, error) {
	// TODO: implement against athena API - GET /v1/{practiceID}/appointments/open
	return nil, fmt.Errorf("ListTodayEncounters not yet implemented")
}

func (c *Client) WriteEncounterHPI(ctx context.Context, practiceID, encounterID, hpiText string) error {
	// TODO: implement against athena API - PUT /v1/{practiceID}/chart/encounter/{encounterID}/hpi
	return fmt.Errorf("WriteEncounterHPI not yet implemented")
}

func (c *Client) WriteEncounterAssessmentPlan(ctx context.Context, practiceID, encounterID, apText string) error {
	// TODO: implement against athena API
	return fmt.Errorf("WriteEncounterAssessmentPlan not yet implemented")
}

func (c *Client) WriteEncounterPhysicalExam(ctx context.Context, practiceID, encounterID, peText string) error {
	// TODO: implement against athena API
	return fmt.Errorf("WriteEncounterPhysicalExam not yet implemented")
}
