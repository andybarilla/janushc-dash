package approval

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andybarilla/janushc-dash/internal/auth"
	"github.com/andybarilla/janushc-dash/internal/config"
	"github.com/andybarilla/janushc-dash/internal/database"
	"github.com/andybarilla/janushc-dash/internal/emr"
)

type Handler struct {
	queries *database.Queries
	emr     emr.EMR
	cfg     *config.Config
}

func NewHandler(queries *database.Queries, emrClient emr.EMR, cfg *config.Config) *Handler {
	return &Handler{queries: queries, emr: emrClient, cfg: cfg}
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
	BatchID       string `json:"batch_id"`
	ApprovedCount int    `json:"approved_count"`
	FlaggedCount  int    `json:"flagged_count"`
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

func (h *Handler) HandleSync(w http.ResponseWriter, r *http.Request) {
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

	practiceID := h.cfg.AthenaPracticeID

	// List clinical departments
	departments, err := h.emr.ListDepartments(r.Context(), practiceID)
	if err != nil {
		log.Printf("sync: list departments error: %v", err)
		http.Error(w, "failed to list departments", http.StatusInternalServerError)
		return
	}

	// Load protocols for flagging
	protocols, err := h.queries.ListProtocols(r.Context(), tenantUUID)
	if err != nil {
		log.Printf("sync: list protocols error: %v", err)
		http.Error(w, "failed to list protocols", http.StatusInternalServerError)
		return
	}

	syncedCount := 0

	for _, dept := range departments {
		patients, err := h.emr.ListDepartmentPatients(r.Context(), practiceID, dept.ID)
		if err != nil {
			log.Printf("sync: list patients for dept %s: %v", dept.ID, err)
			continue
		}

		for _, patient := range patients {
			orders, err := h.emr.ListPatientOrders(r.Context(), practiceID, patient.ID, dept.ID, []string{"PROCEDURE"})
			if err != nil {
				log.Printf("sync: list orders for patient %s dept %s: %v", patient.ID, dept.ID, err)
				continue
			}

			if len(orders) == 0 {
				continue
			}

			patientName := patient.Name

			for _, order := range orders {
				// Build a temporary ApprovalItem for flagging
				item := database.ApprovalItem{
					ProcedureName: order.ProcedureName,
				}
				if order.Dosage != "" {
					item.Dosage = pgtype.Text{String: order.Dosage, Valid: true}
				}

				reasons := CheckProtocols(item, protocols)
				flagged := len(reasons) > 0

				status := "pending"
				if flagged {
					status = "needs_review"
				}

				var flagReasonsJSON []byte
				if len(reasons) > 0 {
					flagReasonsJSON, _ = json.Marshal(reasons)
				}

				// Parse order date from MM/DD/YYYY
				var orderDate pgtype.Date
				if order.OrderDate != "" {
					t, err := time.Parse("01/02/2006", order.OrderDate)
					if err == nil {
						orderDate = pgtype.Date{Time: t, Valid: true}
					}
				}

				err := h.queries.UpsertApprovalItem(r.Context(), database.UpsertApprovalItemParams{
					TenantID:      tenantUUID,
					EmrOrderID:    order.ID,
					PatientID:     order.PatientID,
					PatientName:   patientName,
					ProcedureName: order.ProcedureName,
					Dosage:        pgtype.Text{String: order.Dosage, Valid: order.Dosage != ""},
					StaffName:     pgtype.Text{String: order.StaffName, Valid: order.StaffName != ""},
					OrderDate:     orderDate,
					Flagged:       flagged,
					FlagReasons:   flagReasonsJSON,
					Status:        status,
					EncounterID:   pgtype.Text{String: order.EncounterID, Valid: order.EncounterID != ""},
					DepartmentID:  pgtype.Text{String: order.DepartmentID, Valid: order.DepartmentID != ""},
					OrderType:     pgtype.Text{String: order.OrderType, Valid: order.OrderType != ""},
				})
				if err != nil {
					log.Printf("sync: upsert order %s: %v", order.ID, err)
					continue
				}
				syncedCount++
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int{"synced_count": syncedCount})
}

func uuidToString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x", u.Bytes[0:4], u.Bytes[4:6], u.Bytes[6:8], u.Bytes[8:10], u.Bytes[10:16])
}
