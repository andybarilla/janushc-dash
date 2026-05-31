package athena

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/url"

	"github.com/andybarilla/janushc-dash/internal/emr"
)

func (c *Client) GetActiveDiagnoses(ctx context.Context, practiceID, patientID string) ([]emr.Diagnosis, error) {
	// TODO: implement against athena API - GET /v1/{practiceID}/chart/{patientID}/problems
	return nil, fmt.Errorf("GetActiveDiagnoses not yet implemented")
}

// WriteEncounterAssessmentPlan writes the reviewed Assessment & Plan to the
// encounter's assessment section note. Assessment is the only section that
// takes a plain write — no GET-merge is required.
func (c *Client) WriteEncounterAssessmentPlan(ctx context.Context, practiceID, encounterID, apText string) error {
	path := fmt.Sprintf("/v1/%s/chart/encounter/%s/assessment", practiceID, encounterID)
	form := url.Values{
		"assessmenttext": {apText},
		"replacetext":    {"true"},
	}
	return c.putEncounterSection(ctx, path, form)
}

// WriteEncounterHPI writes the reviewed HPI to the encounter's section note.
// athena replaces the entire HPI with whatever the PUT contains, so the
// structured `hpi` array from the GET must be echoed back or existing findings
// are deleted (per docs.athenahealth.com/api/workflows/adding-notes-to-an-encounter).
func (c *Client) WriteEncounterHPI(ctx context.Context, practiceID, encounterID, hpiText string) error {
	path := fmt.Sprintf("/v1/%s/chart/encounter/%s/hpi", practiceID, encounterID)

	var existing struct {
		HPI json.RawMessage `json:"hpi"`
	}
	if err := c.getEncounterSection(ctx, path+"?showstructured=true", &existing); err != nil {
		return err
	}

	form := url.Values{
		"sectionnote":        {hpiText},
		"replacesectionnote": {"true"},
	}
	if len(existing.HPI) > 0 {
		form.Set("hpi", string(existing.HPI))
	}
	return c.putEncounterSection(ctx, path, form)
}

// WriteEncounterPhysicalExam writes the reviewed Physical Exam to the
// encounter's section note. Existing template ids must be passed back in
// `templateids` or athena removes those templates from the exam.
func (c *Client) WriteEncounterPhysicalExam(ctx context.Context, practiceID, encounterID, peText string) error {
	path := fmt.Sprintf("/v1/%s/chart/encounter/%s/physicalexam", practiceID, encounterID)

	var existing struct {
		TemplateData []struct {
			TemplateID json.Number `json:"templateid"`
		} `json:"templatedata"`
	}
	if err := c.getEncounterSection(ctx, path+"?showstructured=true", &existing); err != nil {
		return err
	}

	form := url.Values{
		"sectionnote":        {peText},
		"replacesectionnote": {"true"},
	}
	ids := make([]json.Number, 0, len(existing.TemplateData))
	for _, t := range existing.TemplateData {
		if t.TemplateID != "" {
			ids = append(ids, t.TemplateID)
		}
	}
	if len(ids) > 0 {
		if encoded, err := json.Marshal(ids); err == nil {
			form.Set("templateids", string(encoded))
		}
	}
	return c.putEncounterSection(ctx, path, form)
}

// getEncounterSection performs a chart-section GET and decodes the JSON body.
func (c *Client) getEncounterSection(ctx context.Context, path string, dst any) error {
	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return fmt.Errorf("GET %s (%d): %s", path, resp.StatusCode, body)
	}
	if err := json.Unmarshal(body, dst); err != nil {
		return fmt.Errorf("decode %s: %w", path, err)
	}
	return nil
}

// putEncounterSection performs a form-urlencoded chart-section write and
// surfaces athena's success/errormessage envelope as a Go error.
func (c *Client) putEncounterSection(ctx context.Context, path string, form url.Values) error {
	resp, err := c.doForm(ctx, "PUT", path, form)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return fmt.Errorf("PUT %s (%d): %s", path, resp.StatusCode, body)
	}

	var result struct {
		Success      json.RawMessage `json:"success"`
		ErrorMessage string          `json:"errormessage"`
	}
	_ = json.Unmarshal(body, &result)
	if result.ErrorMessage != "" {
		return fmt.Errorf("PUT %s: %s", path, result.ErrorMessage)
	}
	switch string(result.Success) {
	case `"false"`, "false":
		return fmt.Errorf("PUT %s: athena reported failure: %s", path, body)
	}
	return nil
}
