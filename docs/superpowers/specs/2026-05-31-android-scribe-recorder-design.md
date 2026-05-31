# Android Scribe Recorder — Design

Promote the mobile recorder spike into a focused Android app: a physician logs
in, picks one of the day's real athena encounters, and records the visit. The
audio lands as a real scribe session in the existing web inbox, where review,
approval, and send-to-EHR continue to happen. The app deliberately does **not**
replicate the web UI's review workflow.

## Scope

In scope:

- Backend: implement athena `ListTodayEncounters`; expose authenticated
  `GET /api/scribe/encounters` and `GET /api/scribe/departments`.
- App: native Google Sign-In, department + encounter picker, record, and upload
  into a real scribe session with local persistence and upload retry.
- Retire the unauthenticated `/api/mobile/recordings` spike endpoint.

Out of scope: transcript review, section approval, send-to-EHR, feedback,
auto-transcription on upload (sessions land as `recording` for the web flow).

## Backend

### EMR: ListTodayEncounters

Implement `(*Client).ListTodayEncounters(ctx, practiceID, departmentID)` in
`internal/emr/athena/encounters.go` against
`GET /v1/{practiceID}/appointments/booked?departmentid=…&startdate=…&enddate=…`
(athena dates are `MM/DD/YYYY`; today for both bounds). The booked-appointments
payload carries `appointmentid`, `patientid`, and `date`/`starttime`. Patient
names are filled by calling the existing `GetPatientName` once per unique
patient id (a single department's daily list is small, so the extra calls are
cheap and more robust than depending on name fields in the booked payload).

`emr.Encounter` gains a `PatientName string` field. The encounter identifier is
the appointment id, which matches the id the existing write-back path keys on
downstream.

### Endpoints

Both mounted inside the JWT-protected route group in `internal/server/server.go`:

- `GET /api/scribe/departments` — thin wrapper over the existing
  `ListDepartments`. Returns `[{id, name}]`.
- `GET /api/scribe/encounters?department_id=…` — calls `ListTodayEncounters`
  with `practiceID` from `h.cfg.AthenaPracticeID` (same source the approvals
  handler uses). Returns `[{encounter_id, patient_id, patient_name,
  department_id, date}]`. `400` if `department_id` is missing.

Handlers live in `internal/scribe/handler.go` alongside the existing scribe
endpoints.

### Retire the spike endpoint

Remove `internal/mobile/`, the `/api/mobile/recordings` route, and the
`MOBILE_SPIKE_TOKEN` / `MOBILE_RECORDINGS_DIR` config now that authenticated
scribe endpoints replace it.

## Android app

Evolve `mobile-recorder-spike/` (the background-recording core is already
proven). Replace the spike's editable endpoint + shared-token fields with a
single persisted API base URL.

### Authentication

- Add `@react-native-google-signin/google-signin`, configured with
  `webClientId = GOOGLE_CLIENT_ID` (the existing web OAuth client). The returned
  `idToken`'s `aud` then matches what the backend `GoogleVerifier` already
  accepts — no backend auth change.
- On launch: read the stored JWT from AsyncStorage; if absent or rejected, show
  a sign-in screen with a single Google button.
- On sign-in: `POST /api/auth/google` with the `idToken`, store the returned JWT
  under `janushc:jwt`, attach it as `Authorization: Bearer <jwt>` on all API
  calls. Any `401` clears the stored JWT and returns to sign-in.
- Requires a dev/standalone build (already used: EAS preview APK).

**External prerequisite (not code):** an OAuth **Android client** in Google
Cloud registered with the app's package name + signing-certificate SHA-1. The
required values will be documented; the Google Cloud entry must be created
out of band before a build can authenticate.

### Screens

Two screens after login:

1. **Pick encounter.** Department dropdown (`GET /api/scribe/departments`) and
   below it the day's encounters (`GET /api/scribe/encounters?department_id=…`),
   each row showing patient name + appointment time. Pull-to-refresh; loading
   and empty states. Tapping a row selects it and advances to record.
2. **Record.** Selected patient/encounter shown at top. Recording core carried
   over from the spike: expo-av, background audio mode, keep-awake fallback,
   duration timer. A consent toggle gates Start. Start → record → Stop produces
   a local `.m4a`.

### Get the recording into a session

On stop:

1. `POST /api/scribe/sessions` with `{patient_id, encounter_id, department_id}`
   → returns the session id (now visible in the web inbox).
2. `POST /api/scribe/sessions/{id}/upload` (multipart, no auto-transcribe) →
   session marked `recording`.

On success the app returns to the encounter list.

### Resilience

- The finished recording stays on disk (its file URI) and is not discarded
  until upload succeeds.
- Session-create and upload are tracked per item so a retry resumes at the
  correct step (no duplicate session on a failed-after-create upload).
- On failure the user gets an in-session Retry prompt. v1 does not persist a
  pending-upload queue across an app restart; resume-on-relaunch is a deliberate
  follow-up.

## Error handling

- Missing/invalid `department_id` → `400`.
- athena failures in `ListTodayEncounters` surface as `502`/`500` with a logged
  cause; the app shows a retryable error state.
- `401` on any authenticated call → clear JWT, return to sign-in.
- Upload failures → local pending list + manual retry (see Resilience).

## Testing

- Backend: unit tests for `ListTodayEncounters` (mapping + patient-name fields)
  following the existing athena client test pattern; handler tests for the two
  new endpoints (auth required, `department_id` validation, response shape).
- App: keep/extend the existing recorder tests; add coverage for the
  create-then-upload sequence and the pending-upload retry path.
- Manual: real-device sign-in → pick encounter → record → confirm the session
  appears in the web inbox as `recording` with correct patient/encounter.
