package athena

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/andybarilla/emrai/internal/emr"
)

func (c *Client) ListPatientOrders(ctx context.Context, practiceID, patientID, departmentID string, orderTypes []string) ([]emr.Order, error) {
	path := fmt.Sprintf("/v1/%s/patients/%s/documents/order?departmentid=%s&status=REVIEW", practiceID, patientID, departmentID)
	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, fmt.Errorf("list patient orders: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("list patient orders failed (%d): %s", resp.StatusCode, body)
	}

	var result struct {
		Orders []struct {
			OrderID             int    `json:"orderid"`
			PatientID           int    `json:"patientid"`
			DocumentDescription string `json:"documentdescription"`
			CreatedDate         string `json:"createddate"`
			Status              string `json:"status"`
			OrderType           string `json:"ordertype"`
			EncounterID         string `json:"encounterid"`
			DepartmentID        string `json:"departmentid"`
		} `json:"orders"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode orders: %w", err)
	}

	// Build allowed set for case-insensitive filtering
	allowed := make(map[string]bool, len(orderTypes))
	for _, ot := range orderTypes {
		allowed[strings.ToUpper(ot)] = true
	}

	var orders []emr.Order
	for _, o := range result.Orders {
		if len(allowed) > 0 && !allowed[strings.ToUpper(o.OrderType)] {
			continue
		}
		orders = append(orders, emr.Order{
			ID:            strconv.Itoa(o.OrderID),
			PatientID:     strconv.Itoa(o.PatientID),
			ProcedureName: o.DocumentDescription,
			OrderDate:     o.CreatedDate,
			Status:        o.Status,
			EncounterID:   o.EncounterID,
			OrderType:     o.OrderType,
			DepartmentID:  o.DepartmentID,
		})
	}
	return orders, nil
}

func (c *Client) ApproveOrders(ctx context.Context, practiceID string, orderIDs []string) ([]string, error) {
	return nil, fmt.Errorf("ApproveOrders: not yet implemented — awaiting API audit results")
}
