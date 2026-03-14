package approval

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andybarilla/emrai/internal/auth"
	"github.com/andybarilla/emrai/internal/database"
)

type Handler struct {
	queries *database.Queries
}

func NewHandler(queries *database.Queries) *Handler {
	return &Handler{queries: queries}
}

type approvalItemResponse struct {
	ID            string   `json:"id"`
	EmrOrderID    string   `json:"emr_order_id"`
	PatientID     string   `json:"patient_id"`
	PatientName   string   `json:"patient_name"`
	ProcedureName string   `json:"procedure_name"`
	Dosage        string   `json:"dosage,omitempty"`
	StaffName     string   `json:"staff_name,omitempty"`
	OrderDate     string   `json:"order_date"`
	Flagged       bool     `json:"flagged"`
	FlagReasons   []string `json:"flag_reasons,omitempty"`
	Status        string   `json:"status"`
}

func (h *Handler) HandleListPending(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	tenantUUID := pgtype.UUID{}
	if err := tenantUUID.Scan(claims.TenantID); err != nil {
		http.Error(w, "invalid tenant context", http.StatusBadRequest)
		return
	}

	items, err := h.queries.ListPendingApprovalItems(r.Context(), tenantUUID)
	if err != nil {
		http.Error(w, "failed to list items", http.StatusInternalServerError)
		return
	}

	result := make([]approvalItemResponse, 0, len(items))
	for _, item := range items {
		resp := approvalItemResponse{
			ID:            uuidToString(item.ID),
			EmrOrderID:    item.EmrOrderID,
			PatientID:     item.PatientID,
			PatientName:   item.PatientName,
			ProcedureName: item.ProcedureName,
			Flagged:       item.Flagged,
			Status:        item.Status,
		}
		if item.Dosage.Valid {
			resp.Dosage = item.Dosage.String
		}
		if item.StaffName.Valid {
			resp.StaffName = item.StaffName.String
		}
		if item.OrderDate.Valid {
			resp.OrderDate = item.OrderDate.Time.Format("2006-01-02")
		}
		if item.FlagReasons != nil {
			_ = json.Unmarshal(item.FlagReasons, &resp.FlagReasons)
		}
		result = append(result, resp)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

type batchApproveRequest struct {
	ItemIDs []string `json:"item_ids"`
}

type batchApproveResponse struct {
	BatchID      string `json:"batch_id"`
	ApprovedCount int   `json:"approved_count"`
	FlaggedCount  int   `json:"flagged_count"`
}

func (h *Handler) HandleBatchApprove(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req batchApproveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if len(req.ItemIDs) == 0 {
		http.Error(w, "item_ids required", http.StatusBadRequest)
		return
	}

	tenantUUID := pgtype.UUID{}
	if err := tenantUUID.Scan(claims.TenantID); err != nil {
		http.Error(w, "invalid tenant context", http.StatusBadRequest)
		return
	}

	userUUID := pgtype.UUID{}
	if err := userUUID.Scan(claims.UserID); err != nil {
		http.Error(w, "invalid user context", http.StatusBadRequest)
		return
	}

	// Parse item UUIDs
	itemUUIDs := make([]pgtype.UUID, len(req.ItemIDs))
	for i, id := range req.ItemIDs {
		if err := itemUUIDs[i].Scan(id); err != nil {
			http.Error(w, fmt.Sprintf("invalid item ID: %s", id), http.StatusBadRequest)
			return
		}
	}

	// Count flagged items in the batch
	flaggedCount, err := h.queries.CountFlaggedInBatch(r.Context(), database.CountFlaggedInBatchParams{
		TenantID: tenantUUID,
		Column2:  itemUUIDs,
	})
	if err != nil {
		http.Error(w, "failed to count flagged items", http.StatusInternalServerError)
		return
	}

	// Create the batch record
	batch, err := h.queries.CreateApprovalBatch(r.Context(), database.CreateApprovalBatchParams{
		TenantID:     tenantUUID,
		ApprovedBy:   userUUID,
		OrderCount:   int32(len(req.ItemIDs)),
		FlaggedCount: int32(flaggedCount),
	})
	if err != nil {
		http.Error(w, "failed to create batch", http.StatusInternalServerError)
		return
	}

	// Approve the items
	err = h.queries.BatchApproveItems(r.Context(), database.BatchApproveItemsParams{
		BatchID:    batch.ID,
		ReviewedBy: userUUID,
		TenantID:   tenantUUID,
		Column4:    itemUUIDs,
	})
	if err != nil {
		http.Error(w, "failed to approve items", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(batchApproveResponse{
		BatchID:       uuidToString(batch.ID),
		ApprovedCount: len(req.ItemIDs),
		FlaggedCount:  int(flaggedCount),
	})
}

func uuidToString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x", u.Bytes[0:4], u.Bytes[4:6], u.Bytes[6:8], u.Bytes[8:10], u.Bytes[10:16])
}
