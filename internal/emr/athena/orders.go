package athena

import (
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/andybarilla/emrai/internal/emr"
)

func (c *Client) ListPendingOrders(ctx context.Context, practiceID string, procedureTypes []string) ([]emr.Order, error) {
	path := fmt.Sprintf("/v1/%s/orders", practiceID)
	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, fmt.Errorf("list orders: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("list orders failed (%d): %s", resp.StatusCode, body)
	}

	var result struct {
		Orders []struct {
			OrderID     string `json:"orderid"`
			PatientID   string `json:"patientid"`
			Description string `json:"description"`
			Status      string `json:"status"`
			OrderDate   string `json:"orderdate"`
		} `json:"orders"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode orders: %w", err)
	}

	var orders []emr.Order
	for _, o := range result.Orders {
		orders = append(orders, emr.Order{
			ID:            o.OrderID,
			PatientID:     o.PatientID,
			ProcedureName: o.Description,
			OrderDate:     o.OrderDate,
			Status:        o.Status,
		})
	}
	return orders, nil
}

func (c *Client) ApproveOrders(ctx context.Context, practiceID string, orderIDs []string) ([]string, error) {
	return nil, fmt.Errorf("ApproveOrders: not yet implemented — awaiting API audit results")
}
