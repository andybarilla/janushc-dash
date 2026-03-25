package athena

import (
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/andybarilla/janushc-dash/internal/emr"
)

func (c *Client) ListDepartments(ctx context.Context, practiceID string) ([]emr.Department, error) {
	path := fmt.Sprintf("/v1/%s/departments", practiceID)
	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, fmt.Errorf("list departments: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("list departments failed (%d): %s", resp.StatusCode, body)
	}

	var result struct {
		Departments []struct {
			DepartmentID string `json:"departmentid"`
			Name         string `json:"name"`
			Clinicals    string `json:"clinicals"`
		} `json:"departments"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode departments: %w", err)
	}

	var departments []emr.Department
	for _, d := range result.Departments {
		if d.Clinicals == "ON" {
			departments = append(departments, emr.Department{
				ID:   d.DepartmentID,
				Name: d.Name,
			})
		}
	}
	return departments, nil
}
