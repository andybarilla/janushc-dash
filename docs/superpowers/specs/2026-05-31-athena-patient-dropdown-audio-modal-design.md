# Athena-backed patient dropdown for "Add encounter audio"

## Goal

Replace the free-text *Patient ID* and *Encounter ID* fields in the scribe
upload modal (`frontend/src/components/scribe/upload-modal.tsx`) with two
athena-backed dropdowns: pick a department, then pick a patient from today's
booked appointments (regardless of check-in status). No encounter ID is ever
typed. The real athena `encounterid` is resolved from the appointment at
send time.

## Background

- The modal currently collects `patientId`, `encounterId`, and `departmentId`
  as free text / a hardcoded department list (`frontend/src/lib/departments.ts`
  is placeholder data).
- `practiceID` is a single config value (`cfg.AthenaPracticeID`); this is a
  single-practice deployment.
- EHR write-back (HPI / A&P / PE → `/chart/encounter/{encounterid}/…`) happens
  at **send** time (`internal/scribe/handler.go:1270`, via
  `session.EncounterID`), not at record/upload time. By send time the patient
  has almost always been checked in, so the encounter exists.
- In athena an encounter generally does not exist until check-in. A booked
  appointment has an `appointmentid` but no `encounterid` yet.
- Known latent bug (memory `athena-appointment-vs-encounter-id`): the
  unimplemented `ListTodayEncounters` stub was intended to map athena
  **appointmentid** into `encounter_id`, but write-back keys on the real
  **encounterid**, which generally differs. This design fixes that by storing
  the appointment id explicitly and resolving the encounter id at send.

## Decisions (from brainstorming)

1. Source patients from `/appointments/booked` (today); show all booked
   appointments regardless of check-in status.
2. No encounter field in the modal. Store `appointment_id`; resolve the real
   `encounterid` from the appointment at send time.
3. Department scope: pick a department first (real athena departments), then a
   patient within that department.
4. Dropdown only — no manual free-text fallback. (Trade-off: a walk-in not
   booked in athena cannot be recorded from this modal.)

## Components

### 1. EMR layer (`internal/emr`)

New struct:

```go
type Appointment struct {
    AppointmentID string `json:"appointment_id"`
    PatientID     string `json:"patient_id"`
    PatientName   string `json:"patient_name"`
    Time          string `json:"time"`          // display, e.g. "09:30"
    DepartmentID  string `json:"department_id"`
    Status        string `json:"status"`        // athena appointment status
}
```

Interface changes (`internal/emr/emr.go`):

- Add `ListTodayAppointments(ctx, practiceID, departmentID string) ([]Appointment, error)`.
- Add `ResolveEncounterID(ctx, practiceID, appointmentID string) (string, error)`.
- Remove `ListTodayEncounters` and the `Encounter` struct (the misleading
  stub). Update the `processor_test` fake EMR.

athena impl (`internal/emr/athena/`):

- `ListTodayAppointments` mirrors `ListDepartmentPatients`
  (`GET /v1/{practiceID}/appointments/booked?departmentid=…&startdate=today&enddate=today`)
  but returns appointment-level rows: no patient dedup, includes
  `appointmentid`, appointment time, and status.
- `ResolveEncounterID`: `GET /v1/{practiceID}/appointments/{appointmentID}`,
  read the `encounterid` field. Returns empty string when not yet checked in.
  - Note: exact response field unverifiable until athena onboarding (see
    memory `athena-production-auth`). Implement against the documented
    `encounterid` field; cover with a fake/httptest.

### 2. HTTP routes (authenticated, scribe group in `internal/server/server.go`)

- `GET /api/scribe/departments` → athena `ListDepartments` (already
  implemented, currently unexposed).
- `GET /api/scribe/appointments?department_id=…` → `ListTodayAppointments`.

Both use `cfg.AthenaPracticeID`. The scribe handler needs an `emr.EMR`
dependency for these reads (the processor already wraps one; expose as needed).

### 3. Data model

Migration `016_scribe_appointment_id`:

- `ALTER TABLE scribe_sessions ADD COLUMN appointment_id TEXT;`
- Make `encounter_id` nullable (`DROP NOT NULL`); empty/null until resolved at
  send.
- Down migration reverses both.

Regenerate sqlc (`make sqlc`). Update `CreateScribeSession`
(`queries/scribe.sql`) to insert `appointment_id` and allow empty
`encounter_id`. Add an update query to persist the resolved `encounter_id` at
send (or reuse an existing update path).

### 4. Scribe create + send handlers (`internal/scribe/handler.go`)

- **Create** (`HandleCreate`): `createSessionRequest` takes `patient_id`,
  `appointment_id`, `department_id`. Drop the required `encounter_id`.
  `validate()` requires `patient_id`, `appointment_id`, `department_id`. Store
  `appointment_id`; `encounter_id` left empty. `sessionResponse` includes
  `appointment_id`.
- **Send** (`HandleSend`, around line 1270): before `WriteToAthena`, if
  `session.EncounterID` is empty, call
  `ResolveEncounterID(practiceID, session.AppointmentID)`. On empty result or
  error, return `400 "patient not checked in yet — encounter not available,
  retry after check-in"`. On success, persist the resolved `encounter_id` to
  the session, then `WriteToAthena` (unchanged; idempotent/retryable).

### 5. Frontend (`frontend/src/`)

- New query hooks (`lib/scribe-queries.ts`):
  - `useScribeDepartments()` → `GET /api/scribe/departments`.
  - `useTodayAppointments(departmentId)` → `GET /api/scribe/appointments?department_id=…`,
    enabled when a department is selected.
- `upload-modal.tsx`:
  - **Department** `<select>` populated from `useScribeDepartments`, default to
    the first department.
  - **Patient** `<select>` populated from `useTodayAppointments`, options
    labeled `"{time} · {patient_name}"`, value = `appointmentId`. Selecting
    sets both `patientId` (looked up from the appointment) and `appointmentId`.
  - Remove the Patient ID and Encounter ID text inputs.
  - Record / Paste source tabs and all recording logic unchanged.
  - `createSession` payload → `{ patient_id, appointment_id, department_id }`.
  - Submit-enabled requires a selected appointment (plus existing
    file/transcript checks).
- Remove the hardcoded `frontend/src/lib/departments.ts` placeholder list in
  favor of the live query (update any other importers).
- Dropdown states: loading (disabled), empty (`"No appointments booked
  today"`), athena error (message + submit disabled). Modal still opens on
  fetch failure.

## Error handling

- Department / appointment fetch failures are non-fatal: the modal opens, shows
  the error, and disables submit. No session is created without a valid
  appointment.
- The only hard EHR dependency is at send. A missing/unresolvable encounter
  produces a retryable `400`; the session stays unsent and can be retried after
  check-in.

## Testing

- Go:
  - athena `httptest` tests for `ListTodayAppointments` (booked response →
    appointments) and `ResolveEncounterID` (appointment response →
    encounterid; not-checked-in → empty).
  - Send-handler test for the resolve-at-send path using a fake EMR (resolves
    encounter, persists it, writes back; empty-resolution → 400).
  - Create-handler test: accepts `appointment_id`, stores it, `encounter_id`
    empty.
  - `go test ./...`.
- Frontend:
  - Modal renders department + patient dropdowns from mocked queries; submit
    sends `appointment_id`.
  - `cd frontend && npm run build` (tsc + vite).

## Out of scope

- Manual / walk-in entry path (explicitly dropped).
- Multi-practice support (single `AthenaPracticeID`).
- Caching appointment lists beyond TanStack Query defaults.
