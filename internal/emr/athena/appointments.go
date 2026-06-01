package athena

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"time"

	"github.com/andybarilla/janushc-dash/internal/emr"
)

// ListTodayAppointments returns today's booked appointments for a department,
// regardless of check-in status. Mirrors ListDepartmentPatients but keeps every
// appointment (no patient dedup) and surfaces appointmentid, time, and status.
func (c *Client) ListTodayAppointments(ctx context.Context, practiceID, departmentID string) ([]emr.Appointment, error) {
	today := time.Now().Format("01/02/2006")
	path := fmt.Sprintf("/v1/%s/appointments/booked?departmentid=%s&startdate=%s&enddate=%s",
		practiceID, url.QueryEscape(departmentID), today, today)

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
			AppointmentID string `json:"appointmentid"`
			PatientID     string `json:"patientid"`
			FirstName     string `json:"patientfirstname"`
			LastName      string `json:"patientlastname"`
			StartTime     string `json:"starttime"`
			Status        string `json:"appointmentstatus"`
			DepartmentID  string `json:"departmentid"`
		} `json:"appointments"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode booked appointments: %w", err)
	}

	appointments := make([]emr.Appointment, 0, len(result.Appointments))
	for _, a := range result.Appointments {
		appointments = append(appointments, emr.Appointment{
			AppointmentID: a.AppointmentID,
			PatientID:     a.PatientID,
			PatientName:   a.FirstName + " " + a.LastName,
			Time:          a.StartTime,
			DepartmentID:  a.DepartmentID,
			Status:        a.Status,
		})
	}
	return appointments, nil
}

// ResolveEncounterID returns the athena encounterid for an appointment, or an
// empty string when no encounter exists yet (patient not checked in).
//
// NOTE: the exact response shape for GET /appointments/{id} is unverified
// against live athena (sandbox access is gated on onboarding). Implemented
// against the documented `encounterid` field; revisit during onboarding.
func (c *Client) ResolveEncounterID(ctx context.Context, practiceID, appointmentID string) (string, error) {
	path := fmt.Sprintf("/v1/%s/appointments/%s", practiceID, url.PathEscape(appointmentID))

	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return "", fmt.Errorf("get appointment: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("get appointment failed (%d): %s", resp.StatusCode, body)
	}

	var result struct {
		Appointments []struct {
			EncounterID string `json:"encounterid"`
		} `json:"appointments"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode appointment: %w", err)
	}
	if len(result.Appointments) == 0 {
		return "", nil
	}
	return result.Appointments[0].EncounterID, nil
}
