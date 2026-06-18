# Edit patient ID on scribe session detail

## Goal

Allow users to correct `scribe_sessions.patient_id` from the scribe session detail
page (`/scribe/sessions/:id`) with a temporary free-text edit until Athena patient
matching is available.

## Non-goals

- No Athena lookup, validation, or patient search.
- No changes to `appointment_id`, `department_id`, `encounter_id`, or `label`.
- No broad scribe metadata editor or route refactor.
- No schema change; `patient_id` is already `TEXT NOT NULL`.

## UX

Desktop:

- In `ReviewTopBar`, show an inline edit affordance beside the existing
  `session.patient_id` heading.
- Edit mode replaces the heading text with a compact text input plus Save and
  Cancel controls.
- Save trims the value and requires a non-empty result before sending the
  request. Cancel restores the current session value.
- Disable the edit affordance and input while saving, and for sent or rejected
  sessions.

Mobile:

- Provide the same behavior in the detail header path (`MDetailView`,
  `MDetailTopBar`, `MEncounterHeader`) without changing navigation.
- Keep the edit controls compact enough for the mobile detail header; the
  correction should not require leaving `/scribe/sessions/:id`.

## API/backend

- Add a focused endpoint:

  `PUT /api/scribe/sessions/:id/patient-id`

  Request body:

  ```json
  { "patient_id": "corrected-id" }
  ```

  Response body:

  ```json
  {}
  ```

- Register the route in `internal/server/server.go` next to the existing scribe
  session routes.
- Add a handler in `internal/scribe/handler.go` that mirrors the tenant/session
  lookup and sent/rejected guards used by section editing.
- Add a sqlc query in `queries/scribe.sql`:

  ```sql
  UPDATE scribe_sessions
  SET patient_id = ?3
  WHERE id = ?1 AND tenant_id = ?2;
  ```

- Regenerate `internal/database/scribe.sql.go` after editing the query file.

## Data validation/permissions

- Authenticate and authorize exactly like the existing scribe session detail and
  section edit endpoints: the session id must belong to the caller's tenant.
- Trim `patient_id` server-side before saving.
- Reject an empty trimmed value with `400 Bad Request`.
- Reject sent sessions and rejected sessions with the same policy as section
  editing.
- Do not require `status = 'complete'`; the user may correct an identifier while
  a recording is still processing. The sent/rejected guards are the durable lock.

## Frontend data flow

- Add a mutation hook in `frontend/src/lib/scribe-queries.ts`, e.g.
  `useUpdateScribePatientId`, that calls the new endpoint.
- Trim before calling the mutation so the UI and API submit the same value; keep
  server-side trimming as the authority.
- On success, invalidate both `['scribeSessions', sessionId]` and
  `['scribeSessions']` so detail and list views refresh.
- Keep the editable value local to the header component while editing. The source
  of truth remains the refreshed `ScribeSessionDetail`.
- Desktop route flow stays unchanged:
  `/scribe/*` -> `ScribePage` -> `DesktopScribe` -> `ReviewScreen` ->
  `ReviewTopBar`.
- Mobile route flow stays unchanged:
  `/scribe/sessions/:sessionId` -> `MobileScribe` -> `MDetailView` ->
  `MDetailTopBar`/`MEncounterHeader`.

## Tests

- Backend handler tests in `internal/scribe/handler_test.go`:
  - successful update trims and persists `patient_id` only;
  - empty or whitespace-only `patient_id` returns `400`;
  - another tenant's session is not updated;
  - sent and rejected sessions cannot be updated;
  - `appointment_id`, `department_id`, and `encounter_id` remain unchanged.
- SQL/sqlc coverage through the handler tests is sufficient; no migration test is
  needed because there is no schema change.
- Frontend tests:
  - desktop header enters edit mode, saves a trimmed value, and cancels without a
    request;
  - sent/rejected sessions disable editing;
  - mobile detail header exposes the same edit/save/cancel behavior;
  - mutation success invalidates both detail and list query keys.

## Risks

- Existing list rows that display `label || patient_id` will continue showing the
  label when one exists; this feature intentionally edits only `patient_id`.
- Free-text corrections can store a value that is not a real Athena patient ID.
  This is acceptable for the temporary manual workflow and should be revisited
  when Athena integration lands.
- Concurrent edits are last-write-wins. That matches the current lightweight
  scribe editing model.
