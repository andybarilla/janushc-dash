# Label-only scribe recordings (Athena-bypass for the Android app)

## Problem

Athena API onboarding is still pending (prod uses `client_credentials`; the blocker
is onboarding, not code). Until it lands, the Android recorder's Athena
department/encounter picker returns nothing useful, so the doctor can't start a
recording.

## Goal

Let the doctor record on the Android app and identify each recording with a
freeform text label — a name, initials, patient ID, whatever she prefers. The
recording is transcribed and the AI generates the note exactly as today. On the
dashboard she reads the label to know which patient it is and copies the note
into Athena manually using the existing per-section copy buttons.

This is a temporary workaround. The Athena picker code stays in the repo,
unrouted, ready to re-enable when the API is approved.

## Scope

In scope:
- Android (Expo) app: replace the encounter picker with a freeform label entry.
- Backend: accept a label-only session alongside the existing Athena triple.
- Dashboard: display the label; hide Send-to-EHR for label-only sessions.

Out of scope:
- Desktop "Add encounter audio" modal (`upload-modal.tsx`) — stays on the Athena
  path, untouched.
- The Athena picker screen (`pick-encounter.tsx`) — kept in git, no longer routed
  to. Not deleted.

## Data model

Migration `018_scribe_session_label`:

```sql
-- up
ALTER TABLE scribe_sessions ADD COLUMN label TEXT NOT NULL DEFAULT '';
-- down
ALTER TABLE scribe_sessions DROP COLUMN label;
```

Label-only sessions leave `patient_id`, `appointment_id`, and `department_id`
empty. A dedicated `label` column (rather than overloading `patient_id`) keeps a
freeform string out of the Athena `GetActiveDiagnoses` call and avoids confusing
it with a real Athena patient ID once the API comes online.

Regenerate sqlc (`make sqlc`) after editing `queries/scribe.sql`:
- `CreateScribeSession` gains a `label` parameter.
- `ListScribeSessions` and `GetScribeSession` select `label`.

## Backend (`internal/scribe/handler.go`)

`createSessionRequest` gains `Label string`. Validation accepts **either** a
non-empty `label` **or** the full Athena triple
(`patient_id` + `appointment_id` + `department_id`):

```go
func (r createSessionRequest) validate() error {
    if strings.TrimSpace(r.Label) != "" {
        return nil // label-only session
    }
    if r.PatientID == "" { return fmt.Errorf("patient_id required") }
    if r.AppointmentID == "" { return fmt.Errorf("appointment_id required") }
    if r.DepartmentID == "" { return fmt.Errorf("department_id required") }
    return nil
}
```

`HandleCreate` passes `Label: req.Label` into `CreateScribeSessionParams`.
`sessionResponse` gains a `Label string` json field; `toSessionResponse` and
`toListSessionResponse` populate it.

The AI pipeline is unchanged. For a label-only session `patient_id` is empty, so
`GetActiveDiagnoses` fails — already non-fatal (`processor.go:121-124`), the note
is still produced without diagnosis pre-population.

`HandleSend` needs no server change: a label-only session has an empty
`appointment_id`, so `ResolveEncounterID` returns an error and send fails
gracefully. The dashboard hides the button so this path isn't hit.

## Android app (`mobile-recorder-spike/`)

- **New `src/screens/label-entry.tsx`**: a single text input
  ("Patient identifier — name, initials, or ID") plus a Continue button that
  fires `onSelect(label)` once the trimmed value is non-empty.
- **`App.tsx`**: the selected state becomes a `string | null` (the label) instead
  of `Encounter | null`. Route `!selected` → `LabelEntryScreen`, `selected` →
  `RecordScreen`.
- **`src/screens/record.tsx`**: `RecordScreen` takes `{ label, onDone }` instead
  of `{ encounter, onDone }`. Header shows the label. The `upload`/`retry`
  `createSession` calls send `{ label }`.
- **`src/api.ts`**: `createSession` body becomes `{ label: string }`. The
  `Encounter`/`Department`/`listDepartments`/`listEncounters` exports stay (used
  only by the now-unrouted picker).
- **`src/upload-queue.ts`**: `PendingItem` replaces
  `patientId`/`encounterId`/`departmentId` with a single `label: string`. The
  `id` field is a generated per-recording id (e.g. `String(Date.now())`) set when
  recording stops, since a label is not unique across recordings. Resume/retry
  semantics (`needs-session` → `needs-upload` → `done`) are preserved.
- **`src/upload-queue.test.ts`**: update fixtures to the new `PendingItem` shape.

`pick-encounter.tsx` is left in place, no longer imported by `App.tsx`.

## Dashboard (`frontend/`)

- **`src/lib/scribe-queries.ts`**: `ScribeSession` gains `label?: string`.
- **`src/components/scribe/inbox-table.tsx`** and
  **`src/components/scribe-mobile/session-row.tsx`**: display `label || patient_id`
  in the patient column.
- **`src/components/scribe/review-screen.tsx`**: treat a session with no
  `appointment_id` and no `encounter_id` as label-only. Hide (or disable) the
  "Send to EHR" button for these and show a short hint:
  "No EHR link — copy each section into Athena manually." The per-section copy
  buttons (`section-card.tsx`, `copySection` at `review-screen.tsx:143`) already
  provide the copy affordance.

## Testing

- **Backend** (`internal/scribe/handler_test.go`): label-only create succeeds;
  the Athena triple still validates; `label` appears in the list/get response.
  Run `go test ./...`.
- **Mobile**: `upload-queue.test.ts` passes with the new `PendingItem` shape.
- **Frontend**: `cd frontend && npm run build` (tsc + vite); inbox renders the
  label.

## Rollback

Re-route `App.tsx` back to `PickEncounterScreen` and re-enable Send-to-EHR once
the Athena API is approved. The `label` column and label-only validation branch
can stay — they're harmless and useful as a manual fallback.
