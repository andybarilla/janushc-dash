# Athena Sandbox Sync — Design Spec

## Goal

Wire the athenahealth sandbox API into the batch approvals POC so the dashboard shows real orders from the sandbox instead of seed data.

## Scope

- **In scope:** Read pending procedure orders from Athena, sync to local DB, display in dashboard
- **Out of scope:** Write-back to Athena (blocked by sandbox limitation — `clinicalproviderid` not available). Approvals remain local-only.

## Changes

### 1. Update EMR Interface (`internal/emr/emr.go`)

The current `ListPendingOrders(practiceID, procedureTypes)` signature doesn't work — Athena requires per-patient, per-department queries. Add a lower-level method:

```go
type EMR interface {
    // ListPatientOrders returns pending orders for a specific patient in a department.
    ListPatientOrders(ctx context.Context, practiceID, patientID, departmentID string, orderTypes []string) ([]Order, error)

    // ListDepartments returns all departments for the practice.
    ListDepartments(ctx context.Context, practiceID string) ([]Department, error)

    // GetPatientName returns the patient's display name.
    GetPatientName(ctx context.Context, practiceID, patientID string) (string, error)

    // ApproveOrders marks orders as approved (stubbed for now).
    ApproveOrders(ctx context.Context, practiceID string, orderIDs []string) ([]string, error)
}

type Department struct {
    ID   string
    Name string
}
```

Remove `ListPendingOrders` and `GetPatientContext` — they don't match the actual API. The sync handler orchestrates the iteration.

Add `PatientName` field to `emr.Order` and `EncounterID` field (needed for future write-back):

```go
type Order struct {
    ID            string            `json:"id"`
    PatientID     string            `json:"patient_id"`
    PatientName   string            `json:"patient_name"`
    ProcedureName string            `json:"procedure_name"`
    Dosage        string            `json:"dosage,omitempty"`
    StaffName     string            `json:"staff_name,omitempty"`
    OrderDate     string            `json:"order_date"`
    Status        string            `json:"status"`
    EncounterID   string            `json:"encounter_id,omitempty"`
    OrderType     string            `json:"order_type,omitempty"`
    DepartmentID  string            `json:"department_id,omitempty"`
}
```

Drop `Metadata` map — use explicit fields instead. Drop `PatientContext` — not needed for the sync flow.

### 2. Fix Athena Client (`internal/emr/athena/`)

**`orders.go`** — Implement `ListPatientOrders`:

```
GET /v1/{practiceId}/patients/{patientId}/documents/order?departmentid={deptId}&status=REVIEW
```

Response shape (note: `orderid` and `patientid` are **integers** in JSON, not strings):
```json
{
  "orders": [{
    "orderid": 162684,
    "patientid": 1,
    "ordertype": "PROCEDURE",
    "documentdescription": "colposcopy (PROC)",
    "status": "REVIEW",
    "departmentid": "102",
    "providerid": 26,
    "encounterid": "40754",
    "assignedto": "dfenick",
    "createddate": "05/04/2022"
  }]
}
```

Decode `orderid` and `patientid` as `int` (or `json.Number`), convert to string with `strconv.Itoa`. Map `documentdescription` (not `description`) and `createddate` (not `orderdate`).

Filter client-side: only return orders where `ordertype` matches the requested types (e.g., `["PROCEDURE"]`).

**`patients.go`** — Implement `GetPatientName`:

```
GET /v1/{practiceId}/patients/{patientId}
```

Returns array with one element. Extract `firstname` + `lastname`.

**`departments.go`** (new file) — Implement `ListDepartments`:

```
GET /v1/{practiceId}/departments
```

Returns `{"departments": [{"departmentid": "1", "name": "Cruickshank HEALTH CARE", ...}]}`. Only return departments where `clinicals` == `"ON"`.

### 3. Add Migration for encounter_id Column

The `approval_items` table needs to store the encounter ID for future write-back. Add migration 004:

```sql
ALTER TABLE approval_items ADD COLUMN encounter_id TEXT;
ALTER TABLE approval_items ADD COLUMN department_id TEXT;
ALTER TABLE approval_items ADD COLUMN order_type TEXT;
```

Update the SQLC queries to include these fields in upsert and list operations.

### 4. Add Sync Endpoint

**New handler:** `POST /api/approvals/sync`

Flow:
1. Look up practice ID from tenant config (or use `cfg.AthenaPracticeID` for POC)
2. List all clinical departments from Athena
3. For each department, iterate patient IDs that have pending orders
   - For POC: scan a fixed set of sandbox patient IDs (1-10) since the sandbox patient search endpoint requires filter fields
   - For production: would use appointment list or changed-orders subscription
4. For each patient+department, call `ListPatientOrders` filtered to PROCEDURE type
5. For each order, get patient name via `GetPatientName` (with caching — don't re-fetch for same patient)
6. Run flagging logic against configured protocols
7. Upsert into `approval_items` table
8. Return count of synced items

### 5. Wire Athena Client into Approval Handler

Update `approval.Handler` to accept `emr.EMR`:

```go
type Handler struct {
    queries *database.Queries
    emr     emr.EMR
    cfg     *config.Config
}
```

### 6. Frontend Sync Button

Add a "Sync from Athena" button to the approvals dashboard header. On click:
- POST `/api/approvals/sync`
- Show loading state
- On success, invalidate the approvals query (TanStack Query refetch)
- Display synced count

### 7. Config

`cmd/emrai/main.go` creates `athena.NewClient(cfg.AthenaBaseURL, cfg.AthenaClientID, cfg.AthenaClientSecret)` and passes it to `approval.NewHandler(queries, athenaClient, cfg)`.

Practice ID comes from `cfg.AthenaPracticeID` for the POC (single-tenant). In production, it would come from the tenant's `athena_practice_id` in the database.

## Files to Create

- `internal/emr/athena/departments.go` — department listing
- `migrations/004_approval_metadata.up.sql` — add encounter_id, department_id, order_type columns
- `migrations/004_approval_metadata.down.sql`

## Files to Modify

- `internal/emr/emr.go` — update interface (new methods, new Order fields, remove old methods)
- `internal/emr/athena/orders.go` — fix API paths, response parsing, integer ID handling
- `internal/emr/athena/patients.go` — implement GetPatientName
- `queries/approvals.sql` — update upsert and list queries for new columns
- `internal/database/` — regenerate with `sqlc generate`
- `internal/approval/handler.go` — add sync handler, accept EMR client + config
- `internal/approval/flagger.go` — adapt to new Order/interface types if needed
- `internal/server/server.go` — add sync route
- `cmd/emrai/main.go` — wire Athena client into approval handler
- `frontend/src/lib/queries.ts` — add sync mutation
- `frontend/src/pages/approvals.tsx` — add sync button

## Files NOT Modified

- Auth (unchanged)
- `internal/config/config.go` (Athena fields already exist)
