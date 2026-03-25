package athena

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/andybarilla/janushc-dash/internal/emr"
)

func (c *Client) ListDepartmentPatients(ctx context.Context, practiceID, departmentID string) ([]emr.Patient, error) {
	today := time.Now().Format("01/02/2006")
	path := fmt.Sprintf("/v1/%s/appointments/booked?departmentid=%s&startdate=%s&enddate=%s",
		practiceID, departmentID, today, today)

	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, fmt.Errorf("list booked appointments: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("list booked appointments failed (%d): %s", resp.StatusCode, body)
	}

	var result struct {
		Appointments []struct {
			PatientID string `json:"patientid"`
			FirstName string `json:"patientfirstname"`
			LastName  string `json:"patientlastname"`
		} `json:"appointments"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode booked appointments: %w", err)
	}

	seen := make(map[string]bool)
	var patients []emr.Patient
	for _, a := range result.Appointments {
		if seen[a.PatientID] {
			continue
		}
		seen[a.PatientID] = true
		patients = append(patients, emr.Patient{
			ID:   a.PatientID,
			Name: a.FirstName + " " + a.LastName,
		})
	}
	return patients, nil
}

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
