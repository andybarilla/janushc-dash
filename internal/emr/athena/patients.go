package athena

import (
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/andybarilla/emrai/internal/emr"
)

func (c *Client) GetPatientContext(ctx context.Context, practiceID, patientID string) (*emr.PatientContext, error) {
	path := fmt.Sprintf("/v1/%s/patients/%s", practiceID, patientID)
	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, fmt.Errorf("get patient: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("get patient failed (%d): %s", resp.StatusCode, body)
	}

	var result struct {
		PatientID string `json:"patientid"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode patient: %w", err)
	}

	return &emr.PatientContext{
		PatientID: result.PatientID,
	}, nil
}
