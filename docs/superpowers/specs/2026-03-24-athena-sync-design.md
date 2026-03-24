# Athena Sandbox Sync — Design Spec

## Goal

Wire the athenahealth sandbox API into the batch approvals POC so the dashboard shows real orders from the sandbox instead of seed data.

## Scope

- **In scope:** Read pending procedure orders from Athena, sync to local DB, display in dashboard
- **Out of scope:** Write-back to Athena (blocked by sandbox limitation — `clinicalproviderid` not available). Approvals remain local-only.

## Changes

### 1. Fix Athena Client (`internal/emr/athena/`)

**`orders.go`** — Rewrite `ListPendingOrders` to use the correct API paths:

```
GET /v1/{practiceId}/patients/{patientId}/documents/order?departmentid={deptId}&status=REVIEW
```

The response shape is:
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

Map to `emr.Order`:
- `ID` = orderid (as string)
- `PatientID` = patientid (as string)
- `ProcedureName` = documentdescription
- `OrderDate` = createddate
- `Status` = status
- `Metadata["encounterid"]` = encounterid (needed for future write-back)
- `Metadata["departmentid"]` = departmentid
- `Metadata["ordertype"]` = ordertype

Filter: only return orders where `ordertype == "PROCEDURE"` (or accept a list of types from the caller).

**`patients.go`** — Add `ListPatients` method to iterate sandbox patients:

```
GET /v1/{practiceId}/patients/{patientId}
```

Since the sandbox patient search requires filter fields, we'll iterate known patient IDs or use an encounter-based approach. For the POC, we can scan a configurable range of patient IDs or list patients from recent encounters.

Alternative: use departments to find patients:
```
GET /v1/{practiceId}/appointments/open?departmentid={deptId}
```
This returns appointments with patient IDs we can then query for orders.

For the POC, simplest approach: accept a list of patient IDs to scan (configurable), or scan patients who have open encounters.

### 2. Add Sync Endpoint

**New handler:** `POST /api/approvals/sync`

Flow:
1. Get the practice's department list from Athena
2. For each department, get patients with pending PROCEDURE orders
3. Enrich with patient name from patient record
4. Run flagging logic against configured protocols
5. Upsert into `approval_items` table
6. Return count of synced items

The sync is triggered manually (button click) for the POC. Could become a scheduled job later.

### 3. Wire Athena Client into Approval Handler

The approval handler currently only has `*database.Queries`. It needs access to the Athena client (`emr.EMR`) for the sync operation.

Update `approval.Handler` to accept an `emr.EMR` and `*database.Queries`.

### 4. Frontend Sync Button

Add a "Sync from Athena" button to the approvals dashboard header. On click:
- POST `/api/approvals/sync`
- Show loading state
- On success, invalidate the approvals query (TanStack Query refetch)
- Show toast with count of synced items

### 5. Config

The Athena credentials are already in `.env.example`. The `cmd/emrai/main.go` needs to create the Athena client and pass it to the approval handler.

Currently main.go creates `server.New(cfg, pool, queries, authHandler, approvalHandler)` but the Athena client is not wired in. Add:
- Create `athena.NewClient(cfg.AthenaBaseURL, cfg.AthenaClientID, cfg.AthenaClientSecret)`
- Pass to `approval.NewHandler(queries, athenaClient)`

## Files to Modify

- `internal/emr/athena/orders.go` — fix API paths and response parsing
- `internal/emr/athena/patients.go` — add patient lookup for name enrichment
- `internal/approval/handler.go` — add sync handler, accept EMR client
- `internal/server/server.go` — add sync route
- `cmd/emrai/main.go` — wire Athena client into approval handler
- `frontend/src/lib/queries.ts` — add sync mutation
- `frontend/src/pages/approvals.tsx` — add sync button

## Files NOT Modified

- Database schema (existing `approval_items` table already has the right fields)
- `internal/approval/flagger.go` (flagging logic unchanged)
- `internal/emr/emr.go` (EMR interface unchanged)
- Auth (unchanged)
