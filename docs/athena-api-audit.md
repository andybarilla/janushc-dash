# athenahealth API Audit

Sandbox: `api.preview.platform.athenahealth.com`, Practice ID: `195900`
Auth: 2-legged OAuth (client_credentials), App: "Janus-Healthcare-Dash"

## Working Endpoints

### GET /v1/{practiceId}/patients/{patientId}
Returns full patient record. No department filter needed.

### GET /v1/{practiceId}/patients/{patientId}/documents/order?departmentid={deptId}
Lists all orders for a patient as documents. Key fields:
- `orderid` — unique order identifier
- `ordertype` — LAB, IMAGING, CONSULT, PROCEDURE, SURGERY, OTHER
- `status` — REVIEW, CLOSED, NOTIFY
- `documentdescription` — human-readable name (e.g., "colposcopy (PROC)")
- `documentclass` — always "ORDER"
- `encounterid` — links to the encounter
- `departmentid`, `providerid`, `assignedto`

Can filter: `?status=REVIEW` returns only pending-review orders.

Sandbox patient 1 has: 37 LAB, 16 IMAGING, 14 CONSULT, 3 OTHER, 2 PROCEDURE, 2 SURGERY orders.

### GET /v1/{practiceId}/patients/{patientId}/documents/order/{orderId}
Returns single order detail. Must match correct patient — returns "Could not find" error on mismatch. Note: order's departmentid may differ from the departmentid used in the list query.

### GET /v1/{practiceId}/chart/{patientId}/encounters?departmentid={deptId}
Lists encounters with full detail: stage, status, diagnoses, provider info, appointment data.

### GET /v1/{practiceId}/chart/encounter/{encounterId}/orders
Lists orders within a specific encounter. Response is grouped by diagnosis:
```json
[{
  "diagnosisicd": [{"code": "I38", "codeset": "ICD10"}],
  "orders": [{
    "orderid": 162684,
    "ordertype": "Procedure",
    "description": "colposcopy (PROC)",
    "status": "REVIEW",
    "class": "ORDER"
  }]
}]
```

### PUT /v1/{practiceId}/chart/encounter/{encounterId}/orders/{orderId}
**Order update endpoint — exists but requires `clinicalproviderid`.**

Required field: `clinicalproviderid` — NOT the same as `providerid` from the providers list. No valid clinical provider ID found in the public sandbox (tested 1-2360+). This is likely a sandbox limitation — real practice environments should have clinical providers populated.

Returns `"Additional fields are required"` without `clinicalproviderid`.
Returns `"The clinical provider provided does not exist"` with any providerid we've tried.

### GET /v1/{practiceId}/departments
Lists all departments with full detail.

### GET /v1/{practiceId}/providers
Lists all providers. Supports pagination and type filtering (`?providertype=MD`).

### GET /v1/{practiceId}/patients/{patientId}/documents?departmentid={deptId}
Lists all documents (not just orders). Each doc has `documentclass` (ADMIN, ORDER, etc.), `status`, routing info.

## Endpoints That DON'T Exist
- `GET /v1/{practiceId}/patients/{patientId}/orders` — "unknown API path"
- `GET /v1/{practiceId}/orders` — "unknown API path"
- `PUT /v1/{practiceId}/documents/order/{orderId}` — "unknown API path"
- `PUT /v1/{practiceId}/patients/{patientId}/documents/{docId}` — "unknown API path"
- Any `/actions/close` or `/actions/CLOSE` path variant — "unknown API path"
- `DELETE /v1/{practiceId}/patients/{patientId}/documents/order/{orderId}` — returns "could not find" (recognized path but wrong scope)
- `GET /v1/{practiceId}/reference/ordertypes` — "unknown API path"
- `GET /v1/{practiceId}/clinicalproviders` — "unknown API path"

## Key Findings

1. **Orders live under the documents API**, not a separate orders endpoint. The path is `/patients/{id}/documents/order`.

2. **Orders can be filtered by status** — `?status=REVIEW` returns pending orders.

3. **Order updates go through the encounter path** — `PUT /chart/encounter/{encounterId}/orders/{orderId}`. This is NOT the document path.

4. **The PUT endpoint requires `clinicalproviderid`** which appears to be unavailable in the public sandbox. This means we cannot test the full approval write-back in the sandbox.

5. **Each order has an `encounterid`** linking it to an encounter. To update an order, you need both the encounter ID and order ID.

## Decision: Batch Approvals Architecture

Since we can't confirm order write-back works in the sandbox (due to missing clinical providers), the POC should:

1. **Read orders from Athena** — this works fully. Pull pending PROCEDURE orders via `/patients/{id}/documents/order?status=REVIEW`.
2. **Display for review in emrai** — with flagging logic.
3. **Record approval locally** — mark as approved in emrai's database.
4. **Attempt write-back to Athena** — via `PUT /chart/encounter/{encounterId}/orders/{orderId}` with the practice's real clinical provider ID. If it fails, log it and surface to the user.
5. **Fallback** — if write-back isn't possible with the current API access level, emrai becomes a "preparation + tracking" tool and the physician does the final click in athenaOne.

## Next Steps

- Test with a real practice environment (wife's athenaOne) to verify `clinicalproviderid` works
- Determine if Platform Services subscription is needed for write access
- Wire up the read path (list pending orders) into the existing emrai approval handler
