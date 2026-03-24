# Athena Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the athenahealth sandbox API into the batch approvals dashboard so it displays real orders from the sandbox instead of seed data.

**Architecture:** The sync flow is triggered by a button click. The backend fetches pending PROCEDURE orders from Athena (per-patient, per-department), enriches with patient names, runs protocol-based flagging, and upserts into the local `approval_items` table. The frontend refreshes via TanStack Query invalidation.

**Tech Stack:** Go (chi, SQLC, pgx/v5), athenahealth REST API, Vite + React + TanStack Query

**Spec:** `docs/superpowers/specs/2026-03-24-athena-sync-design.md`

---

## File Structure

```
Modified:
  internal/emr/emr.go                    — new interface methods, updated Order type
  internal/emr/athena/orders.go          — correct API path, response parsing
  internal/emr/athena/patients.go        — GetPatientName implementation
  internal/emr/athena/client_test.go     — tests for orders + patients + departments
  internal/approval/flagger.go           — remove PatientContext dependency
  internal/approval/flagger_test.go      — update tests for simplified flagger
  internal/approval/handler.go           — add HandleSync, accept EMR client
  internal/server/server.go              — add /api/approvals/sync route
  cmd/emrai/main.go                      — wire Athena client into approval handler
  queries/approvals.sql                  — add new columns to upsert/list queries
  frontend/src/lib/queries.ts            — add useSync mutation
  frontend/src/pages/approvals.tsx       — add Sync button

Created:
  internal/emr/athena/departments.go     — ListDepartments implementation
  migrations/004_approval_metadata.up.sql
  migrations/004_approval_metadata.down.sql

Regenerated:
  internal/database/*                    — sqlc generate after query/migration changes
```

---

**IMPORTANT: Tasks 1-5 form an atomic group.** Implement all of them before expecting `go build` to pass. The migration (Task 1), EMR interface (Task 2), Athena client (Task 3), flagger (Task 4), and handler wiring (Task 5) all depend on each other. Commit after each task for progress tracking, but expect intermediate broken builds until Task 5 is complete.

### Task 1: Add Migration for New Columns

**Files:**
- Create: `migrations/004_approval_metadata.up.sql`
- Create: `migrations/004_approval_metadata.down.sql`

- [ ] **Step 1: Create up migration**

```sql
-- migrations/004_approval_metadata.up.sql
ALTER TABLE approval_items ADD COLUMN encounter_id TEXT;
ALTER TABLE approval_items ADD COLUMN department_id TEXT;
ALTER TABLE approval_items ADD COLUMN order_type TEXT;
```

- [ ] **Step 2: Create down migration**

```sql
-- migrations/004_approval_metadata.down.sql
ALTER TABLE approval_items DROP COLUMN IF EXISTS order_type;
ALTER TABLE approval_items DROP COLUMN IF EXISTS department_id;
ALTER TABLE approval_items DROP COLUMN IF EXISTS encounter_id;
```

- [ ] **Step 3: Update SQLC queries**

Replace `queries/approvals.sql` with:

```sql
-- name: ListPendingApprovalItems :many
SELECT id, batch_id, tenant_id, emr_order_id, patient_id, patient_name,
       procedure_name, dosage, staff_name, order_date, flagged, flag_reasons,
       status, reviewed_at, reviewed_by, created_at,
       encounter_id, department_id, order_type
FROM approval_items
WHERE tenant_id = $1 AND status IN ('pending', 'needs_review')
ORDER BY flagged DESC, order_date ASC;

-- name: UpsertApprovalItem :exec
INSERT INTO approval_items (tenant_id, emr_order_id, patient_id, patient_name, procedure_name, dosage, staff_name, order_date, flagged, flag_reasons, status, encounter_id, department_id, order_type)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
ON CONFLICT (tenant_id, emr_order_id) DO UPDATE SET
  patient_name = EXCLUDED.patient_name,
  dosage = EXCLUDED.dosage,
  staff_name = EXCLUDED.staff_name,
  flagged = EXCLUDED.flagged,
  flag_reasons = EXCLUDED.flag_reasons,
  status = EXCLUDED.status,
  encounter_id = EXCLUDED.encounter_id,
  department_id = EXCLUDED.department_id,
  order_type = EXCLUDED.order_type;

-- name: CreateApprovalBatch :one
INSERT INTO approval_batches (tenant_id, approved_by, order_count, flagged_count)
VALUES ($1, $2, $3, $4)
RETURNING id, tenant_id, approved_by, approved_at, order_count, flagged_count;

-- name: BatchApproveItems :exec
UPDATE approval_items
SET status = 'approved', batch_id = $1, reviewed_at = now(), reviewed_by = $2
WHERE tenant_id = $3 AND id = ANY($4::uuid[]) AND status IN ('pending', 'needs_review');

-- name: CountFlaggedInBatch :one
SELECT COUNT(*) FROM approval_items
WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND flagged = true;

-- name: ListProtocols :many
SELECT id, tenant_id, name, procedure_name, standard_dosage, max_lab_age_days,
       requires_established_patient, active, created_at, updated_at
FROM protocols
WHERE tenant_id = $1 AND active = true;

-- name: CreateProtocol :one
INSERT INTO protocols (tenant_id, name, procedure_name, standard_dosage, max_lab_age_days, requires_established_patient)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, tenant_id, name, procedure_name, standard_dosage, max_lab_age_days, requires_established_patient, active, created_at, updated_at;
```

- [ ] **Step 4: Regenerate SQLC**

```bash
make sqlc
```

- [ ] **Step 5: Run migration against dev DB to verify**

```bash
make migrate-up
```

- [ ] **Step 6: Verify build**

```bash
go build ./...
```

Note: Build may fail here if the flagger still references `PatientContext`. Continue to Task 2 (EMR interface), Task 3 (Athena client), and Task 4 (flagger simplification) before verifying the build — these tasks form an atomic group.

- [ ] **Step 7: Commit**

```bash
git add migrations/004_* queries/approvals.sql internal/database/
git commit -m "feat: add encounter_id, department_id, order_type columns to approval_items"
```

---

### Task 2: Update EMR Interface and Order Type

**Files:**
- Modify: `internal/emr/emr.go`

- [ ] **Step 1: Replace `internal/emr/emr.go`**

```go
package emr

import "context"

// Order represents a pending procedure order from any EMR.
type Order struct {
	ID            string `json:"id"`
	PatientID     string `json:"patient_id"`
	PatientName   string `json:"patient_name"`
	ProcedureName string `json:"procedure_name"`
	Dosage        string `json:"dosage,omitempty"`
	StaffName     string `json:"staff_name,omitempty"`
	OrderDate     string `json:"order_date"`
	Status        string `json:"status"`
	EncounterID   string `json:"encounter_id,omitempty"`
	OrderType     string `json:"order_type,omitempty"`
	DepartmentID  string `json:"department_id,omitempty"`
}

// Department represents a practice department/location.
type Department struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// EMR is the abstraction layer for interacting with any EMR system.
type EMR interface {
	// ListPatientOrders returns pending orders for a specific patient in a department.
	ListPatientOrders(ctx context.Context, practiceID, patientID, departmentID string, orderTypes []string) ([]Order, error)

	// ListDepartments returns all clinical departments for the practice.
	ListDepartments(ctx context.Context, practiceID string) ([]Department, error)

	// GetPatientName returns the patient's display name.
	GetPatientName(ctx context.Context, practiceID, patientID string) (string, error)

	// ApproveOrders marks orders as approved (stubbed for now).
	ApproveOrders(ctx context.Context, practiceID string, orderIDs []string) ([]string, error)
}
```

- [ ] **Step 2: Verify build fails (expected — Athena client doesn't implement new interface yet)**

```bash
go build ./...
```

Expected: compile errors in `internal/emr/athena/` — missing methods, removed types.

- [ ] **Step 3: Commit**

```bash
git add internal/emr/emr.go
git commit -m "feat: update EMR interface for per-patient order queries"
```

---

### Task 3: Implement Athena Client Methods

**Files:**
- Modify: `internal/emr/athena/orders.go`
- Modify: `internal/emr/athena/patients.go`
- Create: `internal/emr/athena/departments.go`
- Modify: `internal/emr/athena/client_test.go`

- [ ] **Step 1: Write test for ListPatientOrders**

Add to `internal/emr/athena/client_test.go`:

```go
func TestListPatientOrders(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/v1/token" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"access_token":"test-token","expires_in":3600}`))
			return
		}
		if r.URL.Path == "/v1/195900/patients/1/documents/order" {
			// Verify query params
			if r.URL.Query().Get("departmentid") != "102" {
				t.Errorf("expected departmentid=102, got %s", r.URL.Query().Get("departmentid"))
			}
			if r.URL.Query().Get("status") != "REVIEW" {
				t.Errorf("expected status=REVIEW, got %s", r.URL.Query().Get("status"))
			}
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"orders":[
				{"orderid":162684,"patientid":1,"ordertype":"PROCEDURE","documentdescription":"colposcopy (PROC)","status":"REVIEW","departmentid":"102","encounterid":"40754","assignedto":"dfenick","createddate":"05/04/2022"},
				{"orderid":11083,"patientid":1,"ordertype":"LAB","documentdescription":"lipid panel","status":"REVIEW","departmentid":"102","encounterid":"622","createddate":"09/17/2010"}
			]}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()

	client := NewClient(srv.URL, "id", "secret")
	orders, err := client.ListPatientOrders(context.Background(), "195900", "1", "102", []string{"PROCEDURE"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Should filter to only PROCEDURE orders
	if len(orders) != 1 {
		t.Fatalf("expected 1 order (filtered to PROCEDURE), got %d", len(orders))
	}
	if orders[0].ID != "162684" {
		t.Errorf("expected order ID 162684, got %s", orders[0].ID)
	}
	if orders[0].ProcedureName != "colposcopy (PROC)" {
		t.Errorf("expected colposcopy (PROC), got %s", orders[0].ProcedureName)
	}
	if orders[0].EncounterID != "40754" {
		t.Errorf("expected encounter 40754, got %s", orders[0].EncounterID)
	}
	if orders[0].OrderDate != "05/04/2022" {
		t.Errorf("expected date 05/04/2022, got %s", orders[0].OrderDate)
	}
}
```

- [ ] **Step 2: Write test for GetPatientName**

Add to `internal/emr/athena/client_test.go`:

```go
func TestGetPatientName(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/v1/token" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"access_token":"test-token","expires_in":3600}`))
			return
		}
		if r.URL.Path == "/v1/195900/patients/1" {
			w.Header().Set("Content-Type", "application/json")
			// Note: Athena returns an array, not an object
			w.Write([]byte(`[{"firstname":"John","lastname":"Smith","patientid":"1"}]`))
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()

	client := NewClient(srv.URL, "id", "secret")
	name, err := client.GetPatientName(context.Background(), "195900", "1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if name != "John Smith" {
		t.Errorf("expected 'John Smith', got '%s'", name)
	}
}
```

- [ ] **Step 3: Write test for ListDepartments**

Add to `internal/emr/athena/client_test.go`:

```go
func TestListDepartments(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/v1/token" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"access_token":"test-token","expires_in":3600}`))
			return
		}
		if r.URL.Path == "/v1/195900/departments" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"departments":[
				{"departmentid":"1","name":"Main Office","clinicals":"ON"},
				{"departmentid":"2","name":"Billing","clinicals":"OFF"},
				{"departmentid":"102","name":"Blick Health","clinicals":"ON"}
			]}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()

	client := NewClient(srv.URL, "id", "secret")
	depts, err := client.ListDepartments(context.Background(), "195900")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Should filter to only clinicals=ON
	if len(depts) != 2 {
		t.Fatalf("expected 2 clinical departments, got %d", len(depts))
	}
}
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
go test ./internal/emr/athena/ -v
```

Expected: FAIL — `ListPatientOrders`, `GetPatientName`, `ListDepartments` not defined.

- [ ] **Step 5: Implement ListPatientOrders**

Replace `internal/emr/athena/orders.go`:

```go
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
			OrderType           string `json:"ordertype"`
			DocumentDescription string `json:"documentdescription"`
			Status              string `json:"status"`
			DepartmentID        string `json:"departmentid"`
			EncounterID         string `json:"encounterid"`
			AssignedTo          string `json:"assignedto"`
			CreatedDate         string `json:"createddate"`
		} `json:"orders"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode orders: %w", err)
	}

	// Build lookup set for order type filtering
	typeFilter := make(map[string]bool)
	for _, t := range orderTypes {
		typeFilter[strings.ToUpper(t)] = true
	}

	var orders []emr.Order
	for _, o := range result.Orders {
		if len(typeFilter) > 0 && !typeFilter[strings.ToUpper(o.OrderType)] {
			continue
		}
		orders = append(orders, emr.Order{
			ID:            strconv.Itoa(o.OrderID),
			PatientID:     strconv.Itoa(o.PatientID),
			ProcedureName: o.DocumentDescription,
			OrderDate:     o.CreatedDate,
			Status:        o.Status,
			StaffName:     o.AssignedTo,
			EncounterID:   o.EncounterID,
			OrderType:     o.OrderType,
			DepartmentID:  o.DepartmentID,
		})
	}
	return orders, nil
}

func (c *Client) ApproveOrders(ctx context.Context, practiceID string, orderIDs []string) ([]string, error) {
	return nil, fmt.Errorf("ApproveOrders: not yet implemented — awaiting real practice access")
}
```

- [ ] **Step 6: Implement GetPatientName**

Replace `internal/emr/athena/patients.go`:

```go
package athena

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
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

	// Athena returns an array with one element, not an object
	var patients []struct {
		FirstName string `json:"firstname"`
		LastName  string `json:"lastname"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&patients); err != nil {
		return "", fmt.Errorf("decode patient: %w", err)
	}
	if len(patients) == 0 {
		return "", fmt.Errorf("patient %s not found", patientID)
	}

	name := strings.TrimSpace(patients[0].FirstName + " " + patients[0].LastName)
	return name, nil
}
```

- [ ] **Step 7: Implement ListDepartments**

Create `internal/emr/athena/departments.go`:

```go
package athena

import (
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/andybarilla/emrai/internal/emr"
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

	var depts []emr.Department
	for _, d := range result.Departments {
		if d.Clinicals != "ON" {
			continue
		}
		depts = append(depts, emr.Department{
			ID:   d.DepartmentID,
			Name: d.Name,
		})
	}
	return depts, nil
}
```

- [ ] **Step 8: Run tests**

```bash
go test ./internal/emr/athena/ -v
```

Expected: all 4 tests PASS (getToken + 3 new).

- [ ] **Step 9: Verify full build**

```bash
go build ./...
```

May still fail due to flagger using removed `PatientContext`. That's Task 4.

- [ ] **Step 10: Commit**

```bash
git add internal/emr/athena/
git commit -m "feat: implement Athena client for orders, patients, and departments"
```

---

### Task 4: Simplify Flagger (Remove PatientContext Dependency)

**Files:**
- Modify: `internal/approval/flagger.go`
- Modify: `internal/approval/flagger_test.go`

- [ ] **Step 1: Update flagger — remove PatientContext parameter**

For the POC, only flag on "no matching protocol" and "dosage mismatch". Remove new-patient and lab-age checks (we don't have that data from the Athena sync).

Replace `internal/approval/flagger.go`:

```go
package approval

import (
	"fmt"
	"strings"

	"github.com/andybarilla/emrai/internal/database"
)

// CheckProtocols runs rule-based flagging against configured protocols.
// Returns a list of flag reasons (empty = standard/routine).
// POC: only checks protocol match and dosage. Clinical checks (new patient, lab age)
// will be re-enabled when richer patient data is available from Athena.
func CheckProtocols(item database.ApprovalItem, protocols []database.Protocol) []string {
	var reasons []string

	procedureName := item.ProcedureName
	dosage := ""
	if item.Dosage.Valid {
		dosage = item.Dosage.String
	}

	var matchedProtocol *database.Protocol
	for i, p := range protocols {
		if strings.EqualFold(p.ProcedureName, procedureName) {
			matchedProtocol = &protocols[i]
			break
		}
	}

	if matchedProtocol == nil {
		return []string{"no matching protocol — requires individual review"}
	}

	// Check dosage
	stdDosage := ""
	if matchedProtocol.StandardDosage.Valid {
		stdDosage = matchedProtocol.StandardDosage.String
	}
	if stdDosage != "" && dosage != stdDosage {
		reasons = append(reasons, fmt.Sprintf("dosage differs from standard (%s vs %s)", dosage, stdDosage))
	}

	return reasons
}
```

- [ ] **Step 2: Update flagger tests**

Replace `internal/approval/flagger_test.go`:

```go
package approval

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andybarilla/emrai/internal/database"
)

func makeProtocol(procedureName, stdDosage string) database.Protocol {
	p := database.Protocol{
		ProcedureName: procedureName,
	}
	if stdDosage != "" {
		p.StandardDosage = pgtype.Text{String: stdDosage, Valid: true}
	}
	return p
}

func makeItem(procedureName, dosage string) database.ApprovalItem {
	item := database.ApprovalItem{
		ProcedureName: procedureName,
	}
	if dosage != "" {
		item.Dosage = pgtype.Text{String: dosage, Valid: true}
	}
	return item
}

func TestCheckProtocols_NoMatch(t *testing.T) {
	item := makeItem("Unknown Procedure", "")
	protocols := []database.Protocol{makeProtocol("Testosterone Injection", "200mg")}

	reasons := CheckProtocols(item, protocols)
	if len(reasons) != 1 || reasons[0] != "no matching protocol — requires individual review" {
		t.Errorf("expected no-match reason, got %v", reasons)
	}
}

func TestCheckProtocols_StandardOrder(t *testing.T) {
	item := makeItem("Testosterone Injection", "200mg")
	protocols := []database.Protocol{makeProtocol("Testosterone Injection", "200mg")}

	reasons := CheckProtocols(item, protocols)
	if len(reasons) != 0 {
		t.Errorf("expected no flags for standard order, got %v", reasons)
	}
}

func TestCheckProtocols_DosageDiffers(t *testing.T) {
	item := makeItem("Testosterone Injection", "300mg")
	protocols := []database.Protocol{makeProtocol("Testosterone Injection", "200mg")}

	reasons := CheckProtocols(item, protocols)
	if len(reasons) != 1 || reasons[0] != "dosage differs from standard (300mg vs 200mg)" {
		t.Errorf("expected dosage-differs flag, got %v", reasons)
	}
}

func TestCheckProtocols_NoDosageProtocol(t *testing.T) {
	item := makeItem("Testosterone Injection", "300mg")
	protocols := []database.Protocol{makeProtocol("Testosterone Injection", "")}

	reasons := CheckProtocols(item, protocols)
	if len(reasons) != 0 {
		t.Errorf("expected no flags when protocol has no standard dosage, got %v", reasons)
	}
}
```

- [ ] **Step 3: Run tests**

```bash
go test ./internal/approval/ -v
```

Expected: all 4 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add internal/approval/flagger.go internal/approval/flagger_test.go
git commit -m "refactor: simplify flagger for POC (protocol match + dosage only)"
```

---

### Task 5: Add Sync Handler and Wire Everything

**Files:**
- Modify: `internal/approval/handler.go`
- Modify: `internal/server/server.go`
- Modify: `cmd/emrai/main.go`

- [ ] **Step 1: Update approval handler — add EMR and config, add HandleSync**

Replace `internal/approval/handler.go`:

```go
package approval

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/andybarilla/emrai/internal/auth"
	"github.com/andybarilla/emrai/internal/config"
	"github.com/andybarilla/emrai/internal/database"
	"github.com/andybarilla/emrai/internal/emr"
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

type syncResponse struct {
	SyncedCount int `json:"synced_count"`
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

	ctx := r.Context()
	practiceID := h.cfg.AthenaPracticeID

	// 1. List clinical departments
	departments, err := h.emr.ListDepartments(ctx, practiceID)
	if err != nil {
		log.Printf("sync: list departments failed: %v", err)
		http.Error(w, "failed to list departments from Athena", http.StatusBadGateway)
		return
	}

	// 2. Get protocols for flagging
	protocols, err := h.queries.ListProtocols(ctx, tenantUUID)
	if err != nil {
		http.Error(w, "failed to list protocols", http.StatusInternalServerError)
		return
	}

	// 3. Cache patient names to avoid redundant API calls
	nameCache := make(map[string]string)

	// 4. Scan patients across departments
	// POC: scan patient IDs 1-10 in the sandbox
	maxPatientID := 10
	syncedCount := 0

	for _, dept := range departments {
		for pid := 1; pid <= maxPatientID; pid++ {
			patientID := strconv.Itoa(pid)

			orders, err := h.emr.ListPatientOrders(ctx, practiceID, patientID, dept.ID, []string{"PROCEDURE"})
			if err != nil {
				log.Printf("sync: list orders for patient %s dept %s failed: %v", patientID, dept.ID, err)
				continue
			}

			for _, order := range orders {
				// Get patient name (cached)
				if _, ok := nameCache[order.PatientID]; !ok {
					name, err := h.emr.GetPatientName(ctx, practiceID, order.PatientID)
					if err != nil {
						log.Printf("sync: get patient name %s failed: %v", order.PatientID, err)
						nameCache[order.PatientID] = "Unknown"
					} else {
						nameCache[order.PatientID] = name
					}
				}
				order.PatientName = nameCache[order.PatientID]

				// Parse date from Athena MM/DD/YYYY to YYYY-MM-DD
				orderDate := parseAthenaDate(order.OrderDate)

				// Build a temporary ApprovalItem for flagging
				tempItem := database.ApprovalItem{
					ProcedureName: order.ProcedureName,
				}

				// Run flagging
				reasons := CheckProtocols(tempItem, protocols)
				flagged := len(reasons) > 0
				var flagReasonsJSON []byte
				if flagged {
					flagReasonsJSON, _ = json.Marshal(reasons)
				}

				status := "pending"
				if flagged {
					status = "needs_review"
				}

				// Upsert
				err = h.queries.UpsertApprovalItem(ctx, database.UpsertApprovalItemParams{
					TenantID:     tenantUUID,
					EmrOrderID:   order.ID,
					PatientID:    order.PatientID,
					PatientName:  order.PatientName,
					ProcedureName: order.ProcedureName,
					Dosage:       pgtype.Text{String: order.Dosage, Valid: order.Dosage != ""},
					StaffName:    pgtype.Text{String: order.StaffName, Valid: order.StaffName != ""},
					OrderDate:    orderDate,
					Flagged:      flagged,
					FlagReasons:  flagReasonsJSON,
					Status:       status,
					EncounterID:  pgtype.Text{String: order.EncounterID, Valid: order.EncounterID != ""},
					DepartmentID: pgtype.Text{String: order.DepartmentID, Valid: order.DepartmentID != ""},
					OrderType:    pgtype.Text{String: order.OrderType, Valid: order.OrderType != ""},
				})
				if err != nil {
					log.Printf("sync: upsert order %s failed: %v", order.ID, err)
					continue
				}
				syncedCount++
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(syncResponse{SyncedCount: syncedCount})
}

// parseAthenaDate converts Athena's MM/DD/YYYY to a pgtype.Date.
// Falls back to today if parsing fails.
func parseAthenaDate(s string) pgtype.Date {
	t, err := time.Parse("01/02/2006", s)
	if err != nil {
		t = time.Now()
	}
	return pgtype.Date{Time: t, Valid: true}
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

	itemUUIDs := make([]pgtype.UUID, len(req.ItemIDs))
	for i, id := range req.ItemIDs {
		if err := itemUUIDs[i].Scan(id); err != nil {
			http.Error(w, fmt.Sprintf("invalid item ID: %s", id), http.StatusBadRequest)
			return
		}
	}

	flaggedCount, err := h.queries.CountFlaggedInBatch(r.Context(), database.CountFlaggedInBatchParams{
		TenantID: tenantUUID,
		Column2:  itemUUIDs,
	})
	if err != nil {
		http.Error(w, "failed to count flagged items", http.StatusInternalServerError)
		return
	}

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
```

Note: The `UpsertApprovalItemParams` struct will be generated by SQLC with the new columns. The exact field names depend on what SQLC generates — check `internal/database/approvals.sql.go` after `make sqlc`. The fields for the new columns will likely be `EncounterID`, `DepartmentID`, `OrderType` typed as `pgtype.Text`.

- [ ] **Step 2: Add sync route to server**

In `internal/server/server.go`, add to the protected routes group:

```go
r.Post("/api/approvals/sync", s.approvalHandler.HandleSync)
```

- [ ] **Step 3: Wire Athena client in main.go**

Replace `cmd/emrai/main.go`:

```go
package main

import (
	"context"
	"log"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/andybarilla/emrai/internal/approval"
	"github.com/andybarilla/emrai/internal/auth"
	"github.com/andybarilla/emrai/internal/config"
	"github.com/andybarilla/emrai/internal/database"
	"github.com/andybarilla/emrai/internal/emr/athena"
	"github.com/andybarilla/emrai/internal/server"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load config: %v", err)
	}

	// Run migrations
	migrateURL := cfg.DatabaseURL
	if strings.HasPrefix(migrateURL, "pgx://") {
		migrateURL = strings.Replace(migrateURL, "pgx://", "postgres://", 1)
	}
	m, err := migrate.New("file://migrations", migrateURL)
	if err != nil {
		log.Fatalf("failed to create migrator: %v", err)
	}
	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		log.Fatalf("failed to run migrations: %v", err)
	}
	log.Println("migrations complete")

	// Connect to database
	pool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer pool.Close()

	// Create dependencies
	queries := database.New(pool)
	authHandler := auth.NewHandler(queries, cfg.JWTSecret, cfg.JWTExpiry)
	athenaClient := athena.NewClient(cfg.AthenaBaseURL, cfg.AthenaClientID, cfg.AthenaClientSecret)
	approvalHandler := approval.NewHandler(queries, athenaClient, cfg)

	// Start server
	srv := server.New(cfg, pool, queries, authHandler, approvalHandler)
	log.Fatal(srv.Start())
}
```

- [ ] **Step 4: Verify build and tests**

```bash
go build ./...
go test ./... -v
```

Expected: all tests PASS, build succeeds. If `UpsertApprovalItemParams` field names don't match, check `internal/database/approvals.sql.go` and adjust the field names in `HandleSync` accordingly.

- [ ] **Step 5: Commit**

```bash
git add internal/approval/handler.go internal/server/server.go cmd/emrai/main.go
git commit -m "feat: add Athena sync endpoint with department/patient/order iteration"
```

---

### Task 6: Frontend Sync Button

**Files:**
- Modify: `frontend/src/lib/queries.ts`
- Modify: `frontend/src/pages/approvals.tsx`

- [ ] **Step 1: Add sync mutation to queries.ts**

Add to `frontend/src/lib/queries.ts`:

```typescript
interface SyncResponse {
  synced_count: number;
}

export function useSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.fetch<SyncResponse>("/api/approvals/sync", {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
    },
  });
}
```

- [ ] **Step 2: Add sync button to approvals page**

In `frontend/src/pages/approvals.tsx`, import `useSync` and add a button to the header:

```tsx
import { useApprovals, useBatchApprove, useSync } from "@/lib/queries";
```

Add the hook inside the component:

```tsx
const sync = useSync();
```

Add the sync button in the header, next to the "Sign out" button:

```tsx
<header className="bg-white border-b px-6 py-4 flex items-center justify-between">
  <h1 className="text-xl font-bold">emrai — Approvals</h1>
  <div className="flex items-center gap-3">
    <button
      onClick={() => sync.mutate()}
      disabled={sync.isPending}
      className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50"
    >
      {sync.isPending ? "Syncing..." : "Sync from Athena"}
    </button>
    <button
      onClick={logout}
      className="text-sm text-gray-500 hover:text-gray-700"
    >
      Sign out
    </button>
  </div>
</header>
```

Optionally, show the synced count after a successful sync. Add state:

```tsx
const [syncMessage, setSyncMessage] = useState("");
```

Update the sync button onClick:

```tsx
onClick={() => sync.mutate(undefined, {
  onSuccess: (data) => {
    setSyncMessage(`Synced ${data.synced_count} orders`);
    setTimeout(() => setSyncMessage(""), 3000);
  }
})}
```

Add below the header:

```tsx
{syncMessage && (
  <div className="bg-green-50 text-green-700 p-3 rounded text-sm">
    {syncMessage}
  </div>
)}
```

- [ ] **Step 3: Build frontend**

```bash
cd frontend && npm run build
```

Expected: builds successfully.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/queries.ts frontend/src/pages/approvals.tsx
git commit -m "feat: add Sync from Athena button to approvals dashboard"
```

---

### Task 7: Update .env and End-to-End Test

**Files:**
- Modify: `.env` (local, not committed)

- [ ] **Step 1: Set Athena credentials in .env**

Ensure `.env` has the sandbox credentials:

```
ATHENA_CLIENT_ID=<from 1Password: "Athena Janus-Healthcare-Dash Client IDs" → username>
ATHENA_CLIENT_SECRET=<from 1Password: "Athena Janus-Healthcare-Dash Client IDs" → password>
ATHENA_BASE_URL=https://api.preview.platform.athenahealth.com
ATHENA_PRACTICE_ID=195900
```

- [ ] **Step 2: Rebuild devcontainer**

```bash
make dc-nuke
devcontainer up
```

- [ ] **Step 3: Test E2E**

1. Open the frontend in browser
2. Log in with `doctor@example.com` / `password123`
3. Click "Sync from Athena"
4. Should see real procedure orders from the Athena sandbox appear in the dashboard
5. Orders with no matching protocol should be flagged

- [ ] **Step 4: Verify via API**

```bash
# Get token
TOKEN=$(curl -s -X POST http://localhost:8095/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"doctor@example.com","password":"password123","tenant_id":"TENANT_ID"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Trigger sync
curl -s -X POST http://localhost:8095/api/approvals/sync \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# List approvals
curl -s http://localhost:8095/api/approvals \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

Expected: sync returns a count > 0, approvals list shows Athena orders with patient names and procedure descriptions.
