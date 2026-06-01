# Athena Patient Dropdown for Audio Modal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scribe upload modal's free-text Patient ID / Encounter ID fields with athena-backed department + patient dropdowns; store the appointment ID and resolve the real athena encounter ID at send time.

**Architecture:** A new `Appointment` type and two EMR methods (`ListTodayAppointments`, `ResolveEncounterID`) implemented against athena's `/appointments/booked` and `/appointments/{id}` endpoints, exposed via two read endpoints on the scribe handler. Scribe sessions gain an `appointment_id` column; `encounter_id` becomes empty-by-default and is resolved from the appointment during send-to-EHR. The frontend modal drives a department `<select>` and a patient `<select>` from those endpoints.

**Tech Stack:** Go 1.25 (chi, SQLC, pgx/v5), PostgreSQL 16 (golang-migrate), React 19 (Vite, TypeScript, TanStack Query).

---

## Working agreements

- Run all commands from the worktree root: `/home/andy/dev/andybarilla/janushc-dash/.claude/worktrees/recordui`.
- Tools are managed by mise. If `migrate`, `sqlc`, `go`, or `npm` is missing, run `mise install`.
- Backend verification: `go test ./...`. Frontend verification: `cd frontend && npm run build`.
- Branch already created: `feat/athena-patient-dropdown`. Commit after every task.
- This plan keeps `encounter_id` `NOT NULL DEFAULT ''` (empty = unresolved) so the sqlc Go type stays `string` — do **not** make the column nullable.
- The mobile views (`scribe-mobile/record-view.tsx`, `scribe-mobile/paste-view.tsx`) still import `frontend/src/lib/departments.ts`. Leave that file in place; only the web upload modal switches to the live query.

---

## File Structure

**Create:**
- `migrations/016_scribe_appointment_id.up.sql` — add `appointment_id`, default `encounter_id` to `''`.
- `migrations/016_scribe_appointment_id.down.sql` — reverse.
- `internal/emr/athena/appointments.go` — `ListTodayAppointments`, `ResolveEncounterID`.
- `internal/emr/athena/appointments_test.go` — httptest coverage for both.

**Modify:**
- `internal/emr/emr.go` — add `Appointment` struct + two interface methods; remove `Encounter` + `ListTodayEncounters`.
- `internal/emr/athena/encounters.go` — remove `ListTodayEncounters` stub.
- `internal/scribe/processor.go` — delegator methods for the new EMR calls.
- `internal/scribe/processor_test.go` — update the fake EMR.
- `internal/scribe/handler.go` — read endpoints, create-request changes, send-time resolution.
- `internal/scribe/handler_test.go` (or the existing scribe test file) — handler tests.
- `internal/server/server.go` — two new routes.
- `queries/scribe.sql` — `appointment_id` in create/get; new update query for resolved encounter.
- `frontend/src/lib/scribe-queries.ts` — new hooks + types.
- `frontend/src/components/scribe/upload-modal.tsx` — dropdowns.

---

## Task 1: Migration + sqlc for `appointment_id`

**Files:**
- Create: `migrations/016_scribe_appointment_id.up.sql`, `migrations/016_scribe_appointment_id.down.sql`
- Modify: `queries/scribe.sql`

- [ ] **Step 1: Write the up migration**

`migrations/016_scribe_appointment_id.up.sql`:

```sql
-- migrations/016_scribe_appointment_id.up.sql
ALTER TABLE scribe_sessions ADD COLUMN appointment_id TEXT NOT NULL DEFAULT '';
ALTER TABLE scribe_sessions ALTER COLUMN encounter_id SET DEFAULT '';
```

- [ ] **Step 2: Write the down migration**

`migrations/016_scribe_appointment_id.down.sql`:

```sql
ALTER TABLE scribe_sessions ALTER COLUMN encounter_id DROP DEFAULT;
ALTER TABLE scribe_sessions DROP COLUMN appointment_id;
```

- [ ] **Step 3: Update `CreateScribeSession` and `GetScribeSession` queries**

In `queries/scribe.sql`, replace the `CreateScribeSession` and `GetScribeSession` blocks (top of file) with:

```sql
-- name: CreateScribeSession :one
INSERT INTO scribe_sessions (tenant_id, user_id, patient_id, encounter_id, appointment_id, department_id, status)
VALUES ($1, $2, $3, $4, $5, $6, 'processing')
RETURNING id, tenant_id, user_id, patient_id, encounter_id, appointment_id, department_id, status,
          transcript, ai_output, error_message, started_at, stopped_at, completed_at, created_at;

-- name: GetScribeSession :one
SELECT id, tenant_id, user_id, patient_id, encounter_id, appointment_id, department_id, status,
       transcript, ai_output, error_message, started_at, stopped_at, completed_at, created_at,
       sent_to_ehr_at, sent_to_ehr_by, rejected_at, rejected_by
FROM scribe_sessions
WHERE id = $1 AND tenant_id = $2;
```

- [ ] **Step 4: Add an update query to persist the resolved encounter ID**

Append to `queries/scribe.sql`:

```sql
-- name: SetScribeSessionEncounter :exec
UPDATE scribe_sessions
SET encounter_id = $3
WHERE id = $1 AND tenant_id = $2;
```

- [ ] **Step 5: Apply the migration and regenerate sqlc**

Run: `make migrate-up && make sqlc`
Expected: migration `016` applied; `internal/database` regenerated with `AppointmentID` on `ScribeSession`, `CreateScribeSessionParams`, `GetScribeSessionRow`, and a new `SetScribeSessionEncounter` method.

- [ ] **Step 6: Verify the build compiles**

Run: `go build ./...`
Expected: build fails in `internal/scribe/handler.go` at the `CreateScribeSession` call (now missing `AppointmentID`). This is expected — Task 5 fixes it. If it fails **anywhere else**, stop and investigate.

> Because the create-call signature changed, the tree does not compile until Task 5. To keep commits green, defer the commit: do **not** commit Task 1 alone. Tasks 1 → 5 land together at Task 5's commit. (Tasks 2–4 touch independent files and compile on their own, but the package `internal/scribe` won't build until Task 5.)

Note for the implementer: proceed through Tasks 2–5 before running a full `go test ./...`.

---

## Task 2: EMR `Appointment` type + athena methods (TDD)

**Files:**
- Modify: `internal/emr/emr.go`
- Create: `internal/emr/athena/appointments.go`, `internal/emr/athena/appointments_test.go`
- Modify: `internal/emr/athena/encounters.go` (remove stub), `internal/scribe/processor_test.go` (fake)

- [ ] **Step 1: Write the failing athena tests**

`internal/emr/athena/appointments_test.go`:

```go
package athena

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func tokenAwareServer(handler http.HandlerFunc) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/v1/token" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"access_token":"test-token","expires_in":3600}`))
			return
		}
		handler(w, r)
	}))
}

func TestListTodayAppointments(t *testing.T) {
	server := tokenAwareServer(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/195900/appointments/booked" {
			if got := r.URL.Query().Get("departmentid"); got != "dept1" {
				t.Errorf("departmentid = %q, want dept1", got)
			}
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"appointments":[
				{"appointmentid":"A1","patientid":"P1","patientfirstname":"Jane","patientlastname":"Doe","starttime":"09:30","appointmentstatus":"2 - Checked In","departmentid":"dept1"},
				{"appointmentid":"A2","patientid":"P2","patientfirstname":"John","patientlastname":"Smith","starttime":"10:00","appointmentstatus":"f - Future","departmentid":"dept1"}
			]}`))
			return
		}
		http.NotFound(w, r)
	})
	defer server.Close()

	client := NewClient(server.URL, "client-id", "client-secret")
	appts, err := client.ListTodayAppointments(context.Background(), "195900", "dept1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(appts) != 2 {
		t.Fatalf("len = %d, want 2", len(appts))
	}
	if appts[0].AppointmentID != "A1" || appts[0].PatientID != "P1" {
		t.Errorf("appt[0] ids = %q/%q", appts[0].AppointmentID, appts[0].PatientID)
	}
	if appts[0].PatientName != "Jane Doe" {
		t.Errorf("appt[0] name = %q, want Jane Doe", appts[0].PatientName)
	}
	if appts[1].Time != "10:00" {
		t.Errorf("appt[1] time = %q, want 10:00", appts[1].Time)
	}
}

func TestResolveEncounterID(t *testing.T) {
	server := tokenAwareServer(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/195900/appointments/A1" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"appointments":[{"appointmentid":"A1","encounterid":"E99"}]}`))
			return
		}
		http.NotFound(w, r)
	})
	defer server.Close()

	client := NewClient(server.URL, "client-id", "client-secret")
	enc, err := client.ResolveEncounterID(context.Background(), "195900", "A1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if enc != "E99" {
		t.Errorf("encounter = %q, want E99", enc)
	}
}

func TestResolveEncounterIDNotCheckedIn(t *testing.T) {
	server := tokenAwareServer(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/195900/appointments/A2" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"appointments":[{"appointmentid":"A2"}]}`))
			return
		}
		http.NotFound(w, r)
	})
	defer server.Close()

	client := NewClient(server.URL, "client-id", "client-secret")
	enc, err := client.ResolveEncounterID(context.Background(), "195900", "A2")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if enc != "" {
		t.Errorf("encounter = %q, want empty", enc)
	}
}
```

- [ ] **Step 2: Add the `Appointment` type and interface methods; remove the stub**

In `internal/emr/emr.go`, delete the `Encounter` struct and the `ListTodayEncounters` interface line. Add the `Appointment` struct (place it near `Patient`):

```go
type Appointment struct {
	AppointmentID string `json:"appointment_id"`
	PatientID     string `json:"patient_id"`
	PatientName   string `json:"patient_name"`
	Time          string `json:"time"`
	DepartmentID  string `json:"department_id"`
	Status        string `json:"status"`
}
```

In the `EMR` interface, replace the `ListTodayEncounters(...)` line with:

```go
	ListTodayAppointments(ctx context.Context, practiceID, departmentID string) ([]Appointment, error)
	ResolveEncounterID(ctx context.Context, practiceID, appointmentID string) (string, error)
```

- [ ] **Step 3: Remove the `ListTodayEncounters` stub from athena**

In `internal/emr/athena/encounters.go`, delete the `ListTodayEncounters` method (lines 18–21, the stub returning `"not yet implemented"`).

- [ ] **Step 4: Implement the athena methods**

Create `internal/emr/athena/appointments.go`:

```go
package athena

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"time"

	"github.com/andybarilla/janushc-dash/internal/emr"
)

// ListTodayAppointments returns today's booked appointments for a department,
// regardless of check-in status. Mirrors ListDepartmentPatients but keeps every
// appointment (no patient dedup) and surfaces appointmentid, time, and status.
func (c *Client) ListTodayAppointments(ctx context.Context, practiceID, departmentID string) ([]emr.Appointment, error) {
	today := time.Now().Format("01/02/2006")
	path := fmt.Sprintf("/v1/%s/appointments/booked?departmentid=%s&startdate=%s&enddate=%s",
		practiceID, url.QueryEscape(departmentID), today, today)

	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, fmt.Errorf("list booked appointments: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("list booked appointments failed (%d): %s", resp.StatusCode, body)
	}

	var result struct {
		Appointments []struct {
			AppointmentID string `json:"appointmentid"`
			PatientID     string `json:"patientid"`
			FirstName     string `json:"patientfirstname"`
			LastName      string `json:"patientlastname"`
			StartTime     string `json:"starttime"`
			Status        string `json:"appointmentstatus"`
			DepartmentID  string `json:"departmentid"`
		} `json:"appointments"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode booked appointments: %w", err)
	}

	appointments := make([]emr.Appointment, 0, len(result.Appointments))
	for _, a := range result.Appointments {
		appointments = append(appointments, emr.Appointment{
			AppointmentID: a.AppointmentID,
			PatientID:     a.PatientID,
			PatientName:   a.FirstName + " " + a.LastName,
			Time:          a.StartTime,
			DepartmentID:  a.DepartmentID,
			Status:        a.Status,
		})
	}
	return appointments, nil
}

// ResolveEncounterID returns the athena encounterid for an appointment, or an
// empty string when no encounter exists yet (patient not checked in).
//
// NOTE: the exact response shape for GET /appointments/{id} is unverified
// against live athena (sandbox access is gated on onboarding — see the
// athena-production-auth memory). Implemented against the documented
// `encounterid` field; revisit during onboarding.
func (c *Client) ResolveEncounterID(ctx context.Context, practiceID, appointmentID string) (string, error) {
	path := fmt.Sprintf("/v1/%s/appointments/%s", practiceID, url.PathEscape(appointmentID))

	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return "", fmt.Errorf("get appointment: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("get appointment failed (%d): %s", resp.StatusCode, body)
	}

	var result struct {
		Appointments []struct {
			EncounterID string `json:"encounterid"`
		} `json:"appointments"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode appointment: %w", err)
	}
	if len(result.Appointments) == 0 {
		return "", nil
	}
	return result.Appointments[0].EncounterID, nil
}
```

- [ ] **Step 5: Update the fake EMR in `processor_test.go`**

In `internal/scribe/processor_test.go`, delete the `fakeProcessorEMR.ListTodayEncounters` method and add:

```go
func (fakeProcessorEMR) ListTodayAppointments(ctx context.Context, practiceID, departmentID string) ([]emr.Appointment, error) {
	return nil, nil
}

func (fakeProcessorEMR) ResolveEncounterID(ctx context.Context, practiceID, appointmentID string) (string, error) {
	return "", nil
}
```

- [ ] **Step 6: Run the athena tests**

Run: `go test ./internal/emr/...`
Expected: PASS (`TestListTodayAppointments`, `TestResolveEncounterID`, `TestResolveEncounterIDNotCheckedIn`).

- [ ] **Step 7: Commit (EMR layer compiles independently)**

```bash
git add internal/emr queries/scribe.sql migrations/016_scribe_appointment_id.up.sql migrations/016_scribe_appointment_id.down.sql internal/scribe/processor_test.go internal/database
git commit -m "feat(emr): athena appointments + encounter resolution, drop encounter stub"
```

> The `internal/scribe` package still won't build until Task 5; that's fine — its test file (`processor_test.go`) is updated but the package's non-test code compiles only after the create-call fix. Continue to Task 3.

---

## Task 3: Processor delegators

**Files:**
- Modify: `internal/scribe/processor.go`

The handler talks to the EMR through `h.processor` (the `emr` field is unexported). Add thin delegators.

- [ ] **Step 1: Add delegator methods**

Append to `internal/scribe/processor.go`:

```go
func (p *Processor) ListDepartments(ctx context.Context, practiceID string) ([]emr.Department, error) {
	return p.emr.ListDepartments(ctx, practiceID)
}

func (p *Processor) ListTodayAppointments(ctx context.Context, practiceID, departmentID string) ([]emr.Appointment, error) {
	return p.emr.ListTodayAppointments(ctx, practiceID, departmentID)
}

func (p *Processor) ResolveEncounterID(ctx context.Context, practiceID, appointmentID string) (string, error) {
	return p.emr.ResolveEncounterID(ctx, practiceID, appointmentID)
}
```

Confirm `internal/emr` is already imported in `processor.go` (it is — `emr.EMR` is the field type).

- [ ] **Step 2: Defer build check**

No commit yet (package still needs Task 5). Continue.

---

## Task 4: Read endpoints — departments + appointments

**Files:**
- Modify: `internal/scribe/handler.go`, `internal/server/server.go`
- Test: `internal/scribe/handler_test.go` (or the existing scribe handler test file)

- [ ] **Step 1: Add the handlers**

Add to `internal/scribe/handler.go` (near `HandleList`):

```go
func (h *Handler) HandleListDepartments(w http.ResponseWriter, r *http.Request) {
	departments, err := h.processor.ListDepartments(r.Context(), h.cfg.AthenaPracticeID)
	if err != nil {
		log.Printf("scribe: list departments: %v", err)
		http.Error(w, "failed to load departments", http.StatusBadGateway)
		return
	}
	if departments == nil {
		departments = []emr.Department{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(departments)
}

func (h *Handler) HandleListAppointments(w http.ResponseWriter, r *http.Request) {
	departmentID := r.URL.Query().Get("department_id")
	if departmentID == "" {
		http.Error(w, "department_id required", http.StatusBadRequest)
		return
	}
	appointments, err := h.processor.ListTodayAppointments(r.Context(), h.cfg.AthenaPracticeID, departmentID)
	if err != nil {
		log.Printf("scribe: list appointments: %v", err)
		http.Error(w, "failed to load appointments", http.StatusBadGateway)
		return
	}
	if appointments == nil {
		appointments = []emr.Appointment{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(appointments)
}
```

Add `"github.com/andybarilla/janushc-dash/internal/emr"` to the imports of `handler.go` if not already present.

- [ ] **Step 2: Register routes**

In `internal/server/server.go`, inside the protected group (after the `r.Get("/api/scribe/sessions", ...)` line), add:

```go
		r.Get("/api/scribe/departments", s.scribeHandler.HandleListDepartments)
		r.Get("/api/scribe/appointments", s.scribeHandler.HandleListAppointments)
```

- [ ] **Step 3: Write a handler test for the appointments endpoint**

Find the existing scribe handler test file (e.g. `internal/scribe/handler_test.go`) and follow its setup pattern for building a `Handler` with a fake processor/EMR. Add a test that asserts `HandleListAppointments` returns `400` when `department_id` is missing and `200` with the JSON array when present. If the existing tests construct a `Processor` with a fake EMR, configure that fake's `ListTodayAppointments` to return one appointment and assert the response body contains its `appointment_id`. (Reuse the existing fake EMR rather than defining a new one.)

Minimal shape (adapt to the file's existing helpers):

```go
func TestHandleListAppointmentsRequiresDepartment(t *testing.T) {
	h := newTestHandler(t) // existing helper; build per the file's pattern
	req := httptest.NewRequest("GET", "/api/scribe/appointments", nil)
	req = req.WithContext(auth.ContextWithClaims(req.Context(), testClaims()))
	w := httptest.NewRecorder()
	h.HandleListAppointments(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}
```

If no handler test scaffolding exists, skip the HTTP-level test here and rely on the athena unit tests (Task 2) plus the create/send tests (Tasks 5–6); note the skip in the commit message.

- [ ] **Step 4: Defer build check**

No commit yet. Continue to Task 5, which makes the package compile.

---

## Task 5: Create handler — capture `appointment_id`

**Files:**
- Modify: `internal/scribe/handler.go`
- Test: existing scribe handler test file

- [ ] **Step 1: Update the request struct and validation**

In `internal/scribe/handler.go`, change `createSessionRequest` (lines ~58–62) to:

```go
type createSessionRequest struct {
	PatientID     string `json:"patient_id"`
	AppointmentID string `json:"appointment_id"`
	DepartmentID  string `json:"department_id"`
}
```

Change `validate()` (lines ~64–75) to:

```go
func (r createSessionRequest) validate() error {
	if r.PatientID == "" {
		return fmt.Errorf("patient_id required")
	}
	if r.AppointmentID == "" {
		return fmt.Errorf("appointment_id required")
	}
	if r.DepartmentID == "" {
		return fmt.Errorf("department_id required")
	}
	return nil
}
```

- [ ] **Step 2: Pass `AppointmentID` to the create query and leave encounter empty**

In `HandleCreate`, update the `CreateScribeSession` params (around line 393):

```go
	session, err := h.queries.CreateScribeSession(r.Context(), database.CreateScribeSessionParams{
		TenantID:      tenantUUID,
		UserID:        userUUID,
		PatientID:     req.PatientID,
		EncounterID:   "",
		AppointmentID: req.AppointmentID,
		DepartmentID:  req.DepartmentID,
	})
```

- [ ] **Step 3: Surface `appointment_id` in responses**

Add `AppointmentID string` to the `sessionResponse` struct:

```go
type sessionResponse struct {
	ID            string `json:"id"`
	PatientID     string `json:"patient_id"`
	EncounterID   string `json:"encounter_id"`
	AppointmentID string `json:"appointment_id"`
	DepartmentID  string `json:"department_id"`
	// ... rest unchanged
}
```

In `HandleCreate`'s inline `sessionResponse{...}` literal (around line 408), add `AppointmentID: session.AppointmentID,`. In `toSessionResponse` (line ~1471) add `AppointmentID: s.AppointmentID,`. In `toListSessionResponse` (line ~1495) add `AppointmentID: s.AppointmentID,` (the `ListScribeSessions` row includes it only if the list query selects it — if `ListScribeSessionsRow` lacks `AppointmentID`, omit this line and leave list responses without it).

> Check: does `queries/scribe.sql`'s `ListScribeSessions` select `appointment_id`? If not and you want it in list responses, add `s.appointment_id` to that SELECT and re-run `make sqlc`. Otherwise leave list responses unchanged — the modal only needs it on create.

- [ ] **Step 4: Build the whole tree**

Run: `go build ./...`
Expected: PASS (the `CreateScribeSession` call now matches the regenerated params; `internal/scribe` compiles).

- [ ] **Step 5: Update the create-handler test**

In the existing scribe handler test that posts to create a session, change the request body to send `appointment_id` instead of `encounter_id`, and assert the response includes the `appointment_id` and an empty `encounter_id`. If a test asserts `encounter_id required`, update it to `appointment_id required`. Run the full suite:

Run: `go test ./...`
Expected: PASS.

- [ ] **Step 6: Commit (Tasks 1–5 land together)**

```bash
git add migrations internal/scribe internal/server internal/database queries/scribe.sql
git commit -m "feat(scribe): capture appointment_id on create; departments/appointments endpoints"
```

---

## Task 6: Resolve encounter at send time (TDD)

**Files:**
- Modify: `internal/scribe/handler.go`
- Test: existing scribe handler test file

- [ ] **Step 1: Write the failing send-resolution test**

Add a test that drives `HandleSend` for a `complete`, fully-approved session whose `encounter_id` is empty but `appointment_id` is set, with a fake EMR whose `ResolveEncounterID` returns `"E99"`. Assert that `WriteToAthena` is invoked with `"E99"` (capture it in the fake) and the session is marked sent. Add a second case where `ResolveEncounterID` returns `""` and assert `HandleSend` responds `400` and does **not** mark sent.

Follow the existing send-handler test setup. The fake EMR must record the encounter ID passed to `WriteEncounterHPI`/`WriteEncounterAssessmentPlan`/`WriteEncounterPhysicalExam`. Shape:

```go
func TestHandleSendResolvesEncounterFromAppointment(t *testing.T) {
	// ... build a complete, all-approved session with appointment_id="A1", encounter_id=""
	// fake EMR: ResolveEncounterID -> "E99"; Write* methods record their encounterID arg
	// call h.HandleSend; assert recorded encounterID == "E99" and status 200
}

func TestHandleSendBlocksWhenEncounterUnresolved(t *testing.T) {
	// fake EMR: ResolveEncounterID -> ""
	// call h.HandleSend; assert status 400 and session not marked sent
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/scribe/ -run TestHandleSend -v`
Expected: FAIL (current send path writes with the empty `encounter_id` and does not resolve).

- [ ] **Step 3: Implement resolution in `HandleSend`**

In `internal/scribe/handler.go`, just before the `if session.AiOutput != nil {` block (line ~1268), insert:

```go
	encounterID := session.EncounterID
	if encounterID == "" {
		resolved, err := h.processor.ResolveEncounterID(r.Context(), h.cfg.AthenaPracticeID, session.AppointmentID)
		if err != nil {
			log.Printf("scribe send: resolve encounter for session %s (appt %s): %v", uuidToString(sessionUUID), session.AppointmentID, err)
			http.Error(w, "could not resolve encounter from appointment — contact support", http.StatusInternalServerError)
			return
		}
		if resolved == "" {
			http.Error(w, "patient not checked in yet — encounter not available, retry after check-in", http.StatusBadRequest)
			return
		}
		if err := h.queries.SetScribeSessionEncounter(r.Context(), database.SetScribeSessionEncounterParams{
			ID:          sessionUUID,
			TenantID:    tenantUUID,
			EncounterID: resolved,
		}); err != nil {
			log.Printf("scribe send: persist resolved encounter for session %s: %v", uuidToString(sessionUUID), err)
			http.Error(w, "could not save resolved encounter — contact support", http.StatusInternalServerError)
			return
		}
		encounterID = resolved
	}
```

Then change the `WriteToAthena` call (line ~1270) to use the local `encounterID`:

```go
		if writeErr := h.processor.WriteToAthena(r.Context(), h.cfg.AthenaPracticeID, encounterID, output); writeErr != nil {
```

> `SetScribeSessionEncounterParams` field names come from sqlc — verify the generated names (`ID`, `TenantID`, `EncounterID`) match; adjust if sqlc named them differently.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./internal/scribe/ -run TestHandleSend -v`
Expected: PASS (both cases).

- [ ] **Step 5: Run the full backend suite**

Run: `go test ./...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/scribe
git commit -m "feat(scribe): resolve athena encounter from appointment at send time"
```

---

## Task 7: Frontend query hooks + types

**Files:**
- Modify: `frontend/src/lib/scribe-queries.ts`

- [ ] **Step 1: Add types and hooks**

In `frontend/src/lib/scribe-queries.ts`, add near the other interfaces:

```ts
export interface ScribeDepartment {
  id: string;
  name: string;
}

export interface ScribeAppointment {
  appointment_id: string;
  patient_id: string;
  patient_name: string;
  time: string;
  department_id: string;
  status: string;
}
```

Change `CreateSessionRequest` to:

```ts
interface CreateSessionRequest {
  patient_id: string;
  appointment_id: string;
  department_id: string;
}
```

Add the query hooks (near `useScribeSessions`):

```ts
export function useScribeDepartments() {
  return useQuery({
    queryKey: ["scribeDepartments"],
    queryFn: () => api.fetch<ScribeDepartment[]>("/api/scribe/departments"),
    staleTime: 5 * 60 * 1000,
  });
}

export function useTodayAppointments(departmentId: string) {
  return useQuery({
    queryKey: ["scribeAppointments", departmentId],
    queryFn: () =>
      api.fetch<ScribeAppointment[]>(
        `/api/scribe/appointments?department_id=${encodeURIComponent(departmentId)}`,
      ),
    enabled: !!departmentId,
  });
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: PASS (no usages broken yet; `CreateSessionRequest` is internal to this file and only consumed by the modal, fixed in Task 8 — if tsc reports the modal passing `encounter_id`, that is fixed in Task 8; run Task 8 before the final build).

- [ ] **Step 3: Defer commit until Task 8**

The modal currently passes `encounter_id`; committing now would leave the frontend uncompilable. Continue to Task 8, then commit both together.

---

## Task 8: Modal dropdowns

**Files:**
- Modify: `frontend/src/components/scribe/upload-modal.tsx`

- [ ] **Step 1: Swap imports and state**

In `frontend/src/components/scribe/upload-modal.tsx`, remove the import of `defaultDepartmentId, departments` from `@/lib/departments` and add the new hooks:

```ts
import {
  useCreateScribeSession,
  useScribeDepartments,
  useSubmitTranscript,
  useTodayAppointments,
  useUploadScribeAudio,
} from "@/lib/scribe-queries";
```

Replace the `patientId` / `encounterId` / `departmentId` state declarations (lines ~58–60) with:

```ts
  const [departmentId, setDepartmentId] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
```

Add data hooks (after the mutation hooks, ~line 76):

```ts
  const departmentsQuery = useScribeDepartments();
  const appointmentsQuery = useTodayAppointments(departmentId);
```

Default the department to the first result once loaded — add an effect:

```ts
  useEffect(() => {
    if (!departmentId && departmentsQuery.data?.length) {
      setDepartmentId(departmentsQuery.data[0].id);
    }
  }, [departmentId, departmentsQuery.data]);
```

Reset the appointment whenever the department changes — extend the existing `setDepartmentId` usage by resetting in `reset()` and on department change (see Step 4).

- [ ] **Step 2: Derive the selected patient ID**

Add near the top of the component body (after the hooks):

```ts
  const appointments = appointmentsQuery.data ?? [];
  const selectedAppointment = appointments.find((a) => a.appointment_id === appointmentId);
  const patientId = selectedAppointment?.patient_id ?? "";
```

- [ ] **Step 3: Replace the Patient/Encounter/Department inputs**

Replace the three field blocks (the Patient ID input, Encounter ID input, and Department select — lines ~270–308) with:

```tsx
          <div>
            <label className="janus-label" htmlFor="upload-department">
              Department
            </label>
            <select
              id="upload-department"
              className="janus-input"
              value={departmentId}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                setAppointmentId("");
              }}
              disabled={busy || departmentsQuery.isLoading}
            >
              {departmentsQuery.isLoading ? (
                <option value="">Loading…</option>
              ) : (
                departmentsQuery.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))
              )}
            </select>
            {departmentsQuery.isError ? (
              <div className="janus-error-text">Could not load departments.</div>
            ) : null}
          </div>
          <div>
            <label className="janus-label" htmlFor="upload-patient">
              Patient
            </label>
            <select
              id="upload-patient"
              className="janus-input"
              value={appointmentId}
              onChange={(e) => setAppointmentId(e.target.value)}
              disabled={busy || !departmentId || appointmentsQuery.isLoading}
            >
              <option value="">
                {appointmentsQuery.isLoading
                  ? "Loading…"
                  : appointments.length === 0
                    ? "No appointments booked today"
                    : "Select patient…"}
              </option>
              {appointments.map((a) => (
                <option key={a.appointment_id} value={a.appointment_id}>
                  {a.time} · {a.patient_name}
                </option>
              ))}
            </select>
            {appointmentsQuery.isError ? (
              <div className="janus-error-text">Could not load appointments.</div>
            ) : null}
          </div>
```

- [ ] **Step 4: Update `reset`, submit guard, and submit payload**

In `reset()` (lines ~124–133), replace the patient/encounter/department resets with:

```ts
    setAppointmentId("");
    // departmentId intentionally retained so the next recording defaults to the
    // same department; the default effect re-seeds it if cleared.
```

In `handleSubmit` (lines ~200–225), replace the guard and both `createSession.mutateAsync` payloads:

```ts
  const handleSubmit = async () => {
    if (!appointmentId || !patientId) return;
```

and each `createSession.mutateAsync({...})` becomes:

```ts
      const session = await createSession.mutateAsync({
        patient_id: patientId,
        appointment_id: appointmentId,
        department_id: departmentId,
      });
```

In the footer submit button `disabled` expression (lines ~444–450), replace `!patientId || !encounterId` with `!appointmentId`:

```tsx
            disabled={
              busy ||
              recordingState === "recording" ||
              !appointmentId ||
              (audioSource === "paste" ? !transcript.trim() : !file)
            }
```

- [ ] **Step 5: Build the frontend**

Run: `cd frontend && npm run build`
Expected: PASS (`tsc -b` then `vite build`). Fix any remaining references to the removed `encounterId`/`departments` symbols.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/scribe-queries.ts frontend/src/components/scribe/upload-modal.tsx
git commit -m "feat(scribe): athena department + patient dropdowns in upload modal"
```

---

## Final verification

- [ ] **Backend:** `go test ./...` → PASS
- [ ] **Frontend:** `cd frontend && npm run build` → PASS
- [ ] **Manual smoke (optional, needs athena creds + running stack):** `make dev-servers`, open the scribe page, open "Add encounter audio", confirm the Department dropdown loads, selecting one populates the Patient dropdown with today's appointments, recording + save creates a session, and send-to-EHR resolves the encounter.

---

## Spec coverage check

- Dropdown source = today's booked appointments, any check-in status → Task 2 (`ListTodayAppointments` over `/appointments/booked`), Task 8 (patient dropdown).
- No encounter field; store appointment, resolve at send → Tasks 1, 5 (store), Task 6 (resolve).
- Department picked first (real athena departments) → Task 4 (`/api/scribe/departments`), Task 7/8 (department dropdown).
- Dropdown only, no manual fallback → Task 8 (text inputs removed).
- Remove misleading `ListTodayEncounters`/`Encounter` → Task 2.
- Migration + nullable-equivalent encounter → Task 1 (`DEFAULT ''`).
- Read endpoints exposed → Task 4.
- Error/loading/empty states → Task 8.
- Tests (athena, send resolution, create) → Tasks 2, 5, 6.
- `departments.ts` retained for mobile views (refinement of spec's "remove") → Working agreements + Task 8 note.
