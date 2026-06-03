# Label-only Scribe Recordings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the doctor record on the Android app identifying each recording with a freeform text label (instead of an Athena encounter); the dashboard shows the label so she can copy the AI-generated note into Athena manually.

**Architecture:** Add a nullable `label` column to `scribe_sessions`. The backend accepts a session created with either a `label` or the existing Athena triple. The Android app's encounter picker is replaced by a label-entry screen. The dashboard shows the label and hides Send-to-EHR for label-only sessions. The AI transcription/note pipeline is unchanged.

**Tech Stack:** Go (chi, sqlc, pgx/v5), PostgreSQL (golang-migrate), React 19 + TypeScript (Vite, TanStack Query), Expo/React Native.

---

## File Structure

**Backend / DB:**
- Create: `migrations/018_scribe_session_label.up.sql`, `migrations/018_scribe_session_label.down.sql`
- Modify: `queries/scribe.sql` (Create/Get/List add `label`)
- Regenerate: `internal/database/scribe.sql.go`, `internal/database/models.go` (via `make sqlc`)
- Modify: `internal/scribe/handler.go` (request, validation, create, responses)
- Modify: `internal/scribe/handler_test.go` (validation tests)

**Android app (`mobile-recorder-spike/`):**
- Create: `src/screens/label-entry.tsx`
- Modify: `App.tsx`, `src/screens/record.tsx`, `src/api.ts`, `src/upload-queue.ts`, `src/upload-queue.test.ts`

**Dashboard (`frontend/`):**
- Modify: `src/lib/scribe-queries.ts` (type), `src/components/scribe/inbox-table.tsx`, `src/components/scribe-mobile/session-row.tsx`, `src/components/scribe/review-screen.tsx`

---

## Task 1: Database migration for `label` column

**Files:**
- Create: `migrations/018_scribe_session_label.up.sql`
- Create: `migrations/018_scribe_session_label.down.sql`

- [ ] **Step 1: Write the up migration**

`migrations/018_scribe_session_label.up.sql`:

```sql
-- migrations/018_scribe_session_label.up.sql
ALTER TABLE scribe_sessions ADD COLUMN label TEXT NOT NULL DEFAULT '';
```

- [ ] **Step 2: Write the down migration**

`migrations/018_scribe_session_label.down.sql`:

```sql
-- migrations/018_scribe_session_label.down.sql
ALTER TABLE scribe_sessions DROP COLUMN label;
```

- [ ] **Step 3: Apply the migration**

Run: `make migrate-up`
Expected: migration 018 applies with no error.

- [ ] **Step 4: Verify rollback works, then re-apply**

Run: `make migrate-down && make migrate-up`
Expected: down then up both succeed.

- [ ] **Step 5: Commit**

```bash
git add migrations/018_scribe_session_label.up.sql migrations/018_scribe_session_label.down.sql
git commit -m "Add label column to scribe_sessions"
```

---

## Task 2: Add `label` to sqlc queries and regenerate

**Files:**
- Modify: `queries/scribe.sql`
- Regenerate: `internal/database/scribe.sql.go`, `internal/database/models.go`

- [ ] **Step 1: Add `label` to CreateScribeSession**

In `queries/scribe.sql`, replace the `CreateScribeSession` query (lines 1-5) with:

```sql
-- name: CreateScribeSession :one
INSERT INTO scribe_sessions (tenant_id, user_id, patient_id, encounter_id, appointment_id, department_id, label, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing')
RETURNING id, tenant_id, user_id, patient_id, encounter_id, appointment_id, department_id, label, status,
          transcript, ai_output, error_message, started_at, stopped_at, completed_at, created_at;
```

- [ ] **Step 2: Add `label` to GetScribeSession**

Replace the `GetScribeSession` SELECT column list (the line beginning `SELECT id, tenant_id, ...`) so it includes `label`:

```sql
-- name: GetScribeSession :one
SELECT id, tenant_id, user_id, patient_id, encounter_id, department_id, label, status,
       transcript, ai_output, error_message, started_at, stopped_at, completed_at, created_at,
       sent_to_ehr_at, sent_to_ehr_by, rejected_at, rejected_by, appointment_id
FROM scribe_sessions
WHERE id = $1 AND tenant_id = $2;
```

- [ ] **Step 3: Add `label` to ListScribeSessions**

In the final `SELECT` of `ListScribeSessions`, add `s.label` to the column list:

```sql
SELECT
    s.id, s.tenant_id, s.user_id, s.patient_id, s.encounter_id, s.appointment_id, s.department_id, s.label,
    s.status, s.error_message, s.started_at, s.stopped_at, s.completed_at, s.created_at,
    s.sent_to_ehr_at, s.rejected_at,
    COALESCE(ac.approved_count, 0)::int AS approved_count
FROM scribe_sessions s
LEFT JOIN approved_counts ac ON ac.session_id = s.id
WHERE s.tenant_id = $1
ORDER BY s.created_at DESC
LIMIT 50;
```

- [ ] **Step 4: Regenerate sqlc**

Run: `make sqlc`
Expected: `internal/database/scribe.sql.go` and `models.go` regenerate. `CreateScribeSessionParams` now has a `Label string` field; `ScribeSession`, `GetScribeSessionRow`, and `ListScribeSessionsRow` have a `Label string` field.

- [ ] **Step 5: Verify it compiles**

Run: `go build ./...`
Expected: build fails in `internal/scribe/handler.go` because `CreateScribeSessionParams` now requires `Label` (or compiles if Go zero-values it — either way the next task wires it). If it compiles, that's fine; proceed.

- [ ] **Step 6: Commit**

```bash
git add queries/scribe.sql internal/database/scribe.sql.go internal/database/models.go
git commit -m "sqlc: carry label through scribe session create/get/list"
```

---

## Task 3: Backend request, validation, and response wiring

**Files:**
- Modify: `internal/scribe/handler.go`
- Test: `internal/scribe/handler_test.go`

- [ ] **Step 1: Write failing validation tests**

In `internal/scribe/handler_test.go`, add after `TestValidateCreateRequest_MissingAppointmentID` (around line 58):

```go
func TestValidateCreateRequest_LabelOnly(t *testing.T) {
	req := createSessionRequest{Label: "Jane D."}
	if err := req.validate(); err != nil {
		t.Errorf("expected label-only request to be valid, got error: %v", err)
	}
}

func TestValidateCreateRequest_EmptyLabelAndNoTriple(t *testing.T) {
	req := createSessionRequest{Label: "   "}
	if err := req.validate(); err == nil {
		t.Error("expected error for blank label with no Athena triple")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/scribe/ -run TestValidateCreateRequest -v`
Expected: `TestValidateCreateRequest_LabelOnly` FAILS (label-only currently errors on missing patient_id). Compilation fails first because `createSessionRequest` has no `Label` field — that is the expected failing state.

- [ ] **Step 3: Add `Label` field and relax validation**

In `internal/scribe/handler.go`, change `createSessionRequest` (lines 60-64) to add the field:

```go
type createSessionRequest struct {
	PatientID     string `json:"patient_id"`
	AppointmentID string `json:"appointment_id"`
	DepartmentID  string `json:"department_id"`
	Label         string `json:"label"`
}
```

Replace `validate` (lines 66-77) with:

```go
func (r createSessionRequest) validate() error {
	if strings.TrimSpace(r.Label) != "" {
		return nil // label-only session: no Athena linkage required
	}
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

- [ ] **Step 4: Run validation tests to verify they pass**

Run: `go test ./internal/scribe/ -run TestValidateCreateRequest -v`
Expected: all `TestValidateCreateRequest_*` PASS.

- [ ] **Step 5: Add `Label` to response struct and converters**

In `internal/scribe/handler.go`, add to `sessionResponse` (after `DepartmentID string` at line 102):

```go
	Label         string `json:"label"`
```

In `HandleCreate`, add `Label: strings.TrimSpace(req.Label),` to the `CreateScribeSessionParams` literal (after `DepartmentID: req.DepartmentID,` around line 464), and add `Label: session.Label,` to the `sessionResponse` literal it returns (after `DepartmentID: session.DepartmentID,`).

In `toSessionResponse` (around line 1580), add `Label: s.Label,` to the `sessionResponse` literal.

In `toListSessionResponse` (around line 1605), add `Label: s.Label,` to the `sessionResponse` literal.

- [ ] **Step 6: Run the full backend test suite**

Run: `go test ./...`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add internal/scribe/handler.go internal/scribe/handler_test.go
git commit -m "Backend: accept label-only scribe session, carry label in responses"
```

---

## Task 4: Android upload queue carries a label

**Files:**
- Modify: `mobile-recorder-spike/src/upload-queue.ts`
- Test: `mobile-recorder-spike/src/upload-queue.test.ts`

- [ ] **Step 1: Update the failing test fixtures**

In `mobile-recorder-spike/src/upload-queue.test.ts`, replace every `PendingItem` fixture's identity fields (`patientId`, `encounterId`, `departmentId`) with a single `label`. For example a fixture that was:

```ts
const item: PendingItem = {
  id: 'enc-1', fileUri: 'file://a.m4a',
  patientId: 'p1', encounterId: 'enc-1', departmentId: 'd1',
  sessionId: null, status: 'needs-session',
};
```

becomes:

```ts
const item: PendingItem = {
  id: 'rec-1', fileUri: 'file://a.m4a',
  label: 'Jane D.',
  sessionId: null, status: 'needs-session',
};
```

Apply the same change to all fixtures in the file.

- [ ] **Step 2: Run the test to verify it fails to compile**

Run: `cd mobile-recorder-spike && npx tsc --noEmit`
Expected: type errors — `PendingItem` still declares `patientId`/`encounterId`/`departmentId` and lacks `label`.

- [ ] **Step 3: Update the `PendingItem` type**

In `mobile-recorder-spike/src/upload-queue.ts`, replace the `PendingItem` type (lines 3-12) with:

```ts
export type PendingItem = {
  id: string;
  fileUri: string;
  label: string;
  sessionId: string | null;
  status: PendingStatus;
};
```

`processItem` and `ProcessDeps` need no change — they reference only `id`, `fileUri`, `sessionId`, and `status`.

- [ ] **Step 4: Run the upload-queue tests**

Run: `cd mobile-recorder-spike && npm test -- upload-queue`
Expected: PASS. (If the project uses a different test runner, run `npx jest upload-queue` or the script defined in `package.json`.)

- [ ] **Step 5: Commit**

```bash
git add mobile-recorder-spike/src/upload-queue.ts mobile-recorder-spike/src/upload-queue.test.ts
git commit -m "Mobile: upload queue carries a freeform label"
```

---

## Task 5: Android API client sends a label

**Files:**
- Modify: `mobile-recorder-spike/src/api.ts`

- [ ] **Step 1: Change `createSession` to send a label**

In `mobile-recorder-spike/src/api.ts`, replace `createSession` (lines 83-92) with:

```ts
export function createSession(
  opts: ApiOptions,
  body: { label: string },
): Promise<Session> {
  return request<Session>(opts, '/api/scribe/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
```

Leave `Encounter`, `Department`, `listDepartments`, and `listEncounters` in place — they are still imported by the unrouted `pick-encounter.tsx`.

- [ ] **Step 2: Verify it compiles**

Run: `cd mobile-recorder-spike && npx tsc --noEmit`
Expected: errors only in `record.tsx` (still calls `createSession` with the old object shape) — fixed in Task 6.

- [ ] **Step 3: Commit**

```bash
git add mobile-recorder-spike/src/api.ts
git commit -m "Mobile: createSession sends label"
```

---

## Task 6: Android label-entry screen and record-screen wiring

**Files:**
- Create: `mobile-recorder-spike/src/screens/label-entry.tsx`
- Modify: `mobile-recorder-spike/src/screens/record.tsx`
- Modify: `mobile-recorder-spike/App.tsx`

- [ ] **Step 1: Create the label-entry screen**

`mobile-recorder-spike/src/screens/label-entry.tsx`:

```tsx
import { useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';

export function LabelEntryScreen({ onSelect }: { onSelect: (label: string) => void }) {
  const [label, setLabel] = useState('');
  const trimmed = label.trim();

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Identify this recording</Text>
      <Text style={styles.help}>
        Type a name, initials, or patient ID — whatever lets you match it in Athena later.
      </Text>
      <TextInput
        style={styles.input}
        value={label}
        onChangeText={setLabel}
        placeholder="e.g. Jane D. or 12345"
        placeholderTextColor="#94a3b8"
        autoFocus
        autoCapitalize="words"
        returnKeyType="done"
        onSubmitEditing={() => trimmed && onSelect(trimmed)}
      />
      <Button
        title="Continue"
        color="#166534"
        onPress={() => trimmed && onSelect(trimmed)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 16, backgroundColor: '#ffffff' },
  title: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  help: { color: '#64748b' },
  input: {
    borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 18, color: '#0f172a',
  },
});
```

- [ ] **Step 2: Rewire RecordScreen to take a label**

In `mobile-recorder-spike/src/screens/record.tsx`:

Change the import on line 5 from:

```ts
import { createSession, Encounter, uploadAudio } from '../api';
```

to:

```ts
import { createSession, uploadAudio } from '../api';
```

Change the component signature (line 17) from:

```tsx
export function RecordScreen({ encounter, onDone }: { encounter: Encounter; onDone: () => void }) {
```

to:

```tsx
export function RecordScreen({ label, onDone }: { label: string; onDone: () => void }) {
```

Replace the `upload` function's `PendingItem` construction and `createSession` call (lines 96-113) with:

```tsx
  async function upload(fileUri: string) {
    setUploading(true);
    const item: PendingItem = {
      id: String(Date.now()),
      fileUri,
      label,
      sessionId: null,
      status: 'needs-session',
    };
    const result = await processItem(item, {
      createSession: async (it) => (await createSession(opts, { label: it.label })).id,
      uploadAudio: async (sessionId) => uploadAudio(opts, sessionId, fileUri),
    });
    setUploading(false);
```

In the `retry` function, replace its `createSession` dep (lines 135-140) with:

```tsx
      createSession: async (it) => (await createSession(opts, { label: it.label })).id,
```

Replace the header block (lines 157-158) from:

```tsx
      <Text style={styles.patient}>{encounter.patient_name || encounter.patient_id}</Text>
      <Text style={styles.meta}>Encounter {encounter.encounter_id}</Text>
```

to:

```tsx
      <Text style={styles.patient}>{label}</Text>
```

- [ ] **Step 3: Rewire App.tsx routing**

In `mobile-recorder-spike/App.tsx`:

Change the imports (lines 4, 6) — remove the `Encounter` import and swap the picker for the label screen:

```tsx
import { AuthProvider, useAuth } from './src/auth';
import { LabelEntryScreen } from './src/screens/label-entry';
import { RecordScreen } from './src/screens/record';
import { SignInScreen } from './src/screens/sign-in';
```

(Delete the `import { Encounter } from './src/api';` line and the `import { PickEncounterScreen } ...` line.)

Replace the `Root` body (lines 11-24) with:

```tsx
  const { ready, token } = useAuth();
  const [label, setLabel] = useState<string | null>(null);

  if (!ready) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!token) return <SignInScreen />;
  if (label) return <RecordScreen label={label} onDone={() => setLabel(null)} />;
  return <LabelEntryScreen onSelect={setLabel} />;
```

- [ ] **Step 4: Verify the app type-checks**

Run: `cd mobile-recorder-spike && npx tsc --noEmit`
Expected: PASS. (`pick-encounter.tsx` still type-checks since the API exports it uses remain.)

- [ ] **Step 5: Commit**

```bash
git add mobile-recorder-spike/src/screens/label-entry.tsx mobile-recorder-spike/src/screens/record.tsx mobile-recorder-spike/App.tsx
git commit -m "Mobile: replace encounter picker with freeform label entry"
```

---

## Task 7: Dashboard type and inbox/list display

**Files:**
- Modify: `frontend/src/lib/scribe-queries.ts`
- Modify: `frontend/src/components/scribe/inbox-table.tsx`
- Modify: `frontend/src/components/scribe-mobile/session-row.tsx`

- [ ] **Step 1: Add `label` to the ScribeSession type**

In `frontend/src/lib/scribe-queries.ts`, add to the `ScribeSession` interface (after `department_id: string;`):

```ts
  label?: string;
```

(`ScribeSessionDetail extends ScribeSession`, so it inherits the field.)

- [ ] **Step 2: Show label in the inbox table**

In `frontend/src/components/scribe/inbox-table.tsx`, replace the patient cell (lines 145-147):

```tsx
                  <td className="janus-inbox-patient">
                    {entry.session.label || entry.session.patient_id}
                  </td>
```

- [ ] **Step 3: Show label in the mobile session row**

In `frontend/src/components/scribe-mobile/session-row.tsx`, replace line 24:

```tsx
        <div className="m-row-patient">{session.label || session.patient_id}</div>
```

- [ ] **Step 4: Verify the build**

Run: `cd frontend && npm run build`
Expected: PASS (tsc + vite).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/scribe-queries.ts frontend/src/components/scribe/inbox-table.tsx frontend/src/components/scribe-mobile/session-row.tsx
git commit -m "Dashboard: show scribe session label when present"
```

---

## Task 8: Hide Send-to-EHR for label-only sessions

**Files:**
- Modify: `frontend/src/components/scribe/review-screen.tsx`

- [ ] **Step 1: Derive label-only and gate the Send button**

In `frontend/src/components/scribe/review-screen.tsx`, after the existing `hasSections` derivation (around line 134), add:

```tsx
  const isLabelOnly = !!session.label?.trim();
```

Wrap the Send-to-EHR button block (lines 244-261, the `{canApprove ? ( ... ) : null}` that renders the Send button) so it only renders when not label-only:

```tsx
            {canApprove && !isLabelOnly ? (
              <button
                type="button"
                className="janus-btn janus-btn-primary"
                disabled={!readyToSend || isSent}
                onClick={!isSent && readyToSend ? onSend : undefined}
                title={
                  isSent
                    ? "Already sent"
                    : readyToSend
                      ? "Send to EHR"
                      : "Approve HPI, Assessment & Plan, and Physical Exam first"
                }
              >
                {isSent ? <Check /> : <Send />}
                {isSent ? "Sent to EHR" : "Send to EHR"}
              </button>
            ) : null}
            {isLabelOnly ? (
              <span className="janus-review-hint">
                No EHR link — copy each section into Athena manually.
              </span>
            ) : null}
```

- [ ] **Step 2: Verify the build**

Run: `cd frontend && npm run build`
Expected: PASS. Existing `review-screen.test.tsx` send-button tests stay green because their fixtures have no `label` (so `isLabelOnly` is false and the button still renders).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/scribe/review-screen.tsx
git commit -m "Dashboard: hide Send-to-EHR for label-only sessions, show manual-copy hint"
```

---

## Task 9: Final verification

- [ ] **Step 1: Backend tests**

Run: `go test ./...`
Expected: PASS.

- [ ] **Step 2: Frontend build**

Run: `cd frontend && npm run build`
Expected: PASS.

- [ ] **Step 3: Mobile type-check and tests**

Run: `cd mobile-recorder-spike && npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 4: Manual smoke (optional, requires running stack)**

With `make dev-servers` running and the Expo app pointed at it: sign in on the app, type a label, record a short clip, stop & upload. Confirm a session appears in the dashboard inbox showing the label, the note generates, and the review screen shows the per-section copy buttons with no Send-to-EHR button.
```
```

---

## Notes for the implementer

- The AI pipeline is intentionally untouched: a label-only session has an empty `patient_id`, so `GetActiveDiagnoses` fails, which is already non-fatal (`internal/scribe/processor.go:121-124`) — the note is still produced.
- `pick-encounter.tsx` and the `listEncounters`/`listDepartments` API helpers are deliberately left in the repo, unrouted, to re-enable when Athena API onboarding completes.
- The desktop `upload-modal.tsx` is out of scope and keeps using the Athena triple; the relaxed backend validation is additive and does not affect it.
