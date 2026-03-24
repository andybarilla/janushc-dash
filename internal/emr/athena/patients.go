package athena

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
)

func (c *Client) GetPatientName(ctx context.Context, practiceID, patientID string) (string, error) {
	path := fmt.Sprintf("/v1/%s/patients/%s", practiceID, patientID)
	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return "", fmt.Errorf("get patient: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("get patient failed (%d): %s", resp.StatusCode, body)
	}

	var patients []struct {
		FirstName string `json:"firstname"`
		LastName  string `json:"lastname"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&patients); err != nil {
		return "", fmt.Errorf("decode patient: %w", err)
	}
	if len(patients) == 0 {
		return "", fmt.Errorf("no patient data returned")
	}

	return patients[0].FirstName + " " + patients[0].LastName, nil
}
