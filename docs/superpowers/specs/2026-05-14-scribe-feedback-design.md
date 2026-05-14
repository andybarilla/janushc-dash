# Scribe Feedback & Model-Improvement Dataset

Capture physician feedback on AI-extracted notes and produce a structured dataset for improving the extraction model. Feedback is a side product — it never gates or alters the operational flow (approval, send-to-EHR, reject).

The existing `NotesDrawer` UI already captures categorized notes locally but discards them on refresh. This spec persists those notes, formalizes a few invariants that are already true in the schema, and adds an export endpoint that pairs the AI's original output with the physician's final output plus the audit logs we already keep.

## Goals

1. Persist explicit feedback notes per session.
2. Preserve the data needed to reconstruct an `(ai_original → physician_final)` training pair for every completed session.
3. Expose a clean JSONL export combining the original AI output, the final output, the edit/approval history, and the explicit notes.

## Non-goals

- No feedback-gated workflow. The Send-to-EHR button never checks feedback presence; approvals don't change shape.
- No anchored span feedback ("highlight this sentence"). Free-text body only.
- No severity / suggested-text fields on feedback rows.
- No few-shot prompt enrichment loop. The dataset is the deliverable; downstream consumers are separate work.
- No backfill of historical sessions into `scribe_feedback`. Only forward-looking notes are persisted.

## Backend

### New table

```sql
CREATE TABLE scribe_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES scribe_sessions(id) ON DELETE CASCADE,
    section TEXT NOT NULL CHECK (section IN ('overall','hpi','plan','exam','labs')),
    category TEXT NOT NULL CHECK (category IN (
        'missed_info','incorrect','hallucination','formatting','good','comment'
    )),
    body TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),
    at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scribe_feedback_session ON scribe_feedback (session_id, at);
```

Migration: `010_scribe_feedback.up.sql` / `.down.sql`.

Targets and categories mirror the existing frontend types (`SectionKey | "overall"`, `NoteCategoryId`). If those values diverge later, change one source of truth (frontend `types.ts`) and update the CHECK constraint in a follow-up migration.

### New endpoints

`POST /api/scribe/sessions/:id/feedback`

Request:
```json
{ "section": "hpi", "category": "missed_info", "body": "Missed the patient's allergy to amoxicillin." }
```

- Auth: any authenticated tenant user (physician or otherwise — feedback is broader than approval).
- Validates session belongs to tenant, section/category are in the allowed enums, body is non-empty after trim.
- Inserts a row with `user_id` from the JWT and `at = now()`.
- Returns the created row.

`GET /api/scribe/sessions/:id/feedback`

- Auth: any authenticated tenant user.
- Returns all feedback rows for the session, ordered by `at ASC`, joined to `users` for `author_name` and `author_initials`.
- Response shape matches the frontend `FeedbackNote` type (id, section, category, body, author, authorInitials, at).

`GET /api/scribe/dataset` (admin-only)

- Auth: tenant admin role only. Reject everyone else with 403.
- Query params: `since` (ISO timestamp, optional), `limit` (default 1000, max 5000).
- Streams JSONL — one row per `complete` session, ordered by `completed_at ASC`.
- Each row:
  ```json
  {
    "session_id": "...",
    "tenant_id": "...",
    "patient_id": "...",
    "encounter_id": "...",
    "department_id": "...",
    "created_at": "...",
    "completed_at": "...",
    "transcript": "...",
    "ai_original": { "hpi": "...", "plan": "...", "exam": "...", "labs": [...] },
    "final": { "hpi": "...", "plan": "...", "exam": "...", "labs": [...] },
    "edits": [
      { "section": "hpi", "content": "...", "edited_by": "...", "at": "..." }
    ],
    "approvals": [
      { "section": "hpi", "action": "approved", "user_id": "...", "at": "..." }
    ],
    "rejected_at": null,
    "sent_to_ehr_at": "...",
    "notes": [
      { "section": "hpi", "category": "missed_info", "body": "...", "user_id": "...", "at": "..." }
    ]
  }
  ```
- `ai_original` is the unchanged `scribe_sessions.ai_output` JSONB.
- `final` is computed: for each of the four sections, take the latest `scribe_section_edits` row if present, otherwise fall back to the corresponding field of `ai_original`. The dataset must be self-describing — no "diff" type, just the resolved final.
- `edits` includes every edit, not just the latest per section — the timeline matters for training.

### Snapshot audit (verification, not new code)

Three invariants the dataset relies on. Verify each holds in the current code; fix if not:

1. `scribe_sessions.ai_output` is written exactly once, in `CompleteSession`, and never updated thereafter. (Looks correct from `queries/scribe.sql:57` — only `complete_session.sql` writes `ai_output`. Confirm there is no other `UPDATE scribe_sessions ... ai_output` in the codebase.)
2. `scribe_section_edits` is append-only. Every edit creates a new row; nothing UPDATEs or DELETEs prior edits. (`RecordSectionEdit` is an INSERT — looks correct.)
3. `scribe_section_approvals` is append-only with both `approved` and `revoked` actions captured. (Confirmed in `migrations/007_scribe_section_approvals.up.sql` — CHECK enforces both, table is INSERT-only.)

If any invariant is wrong, address it before shipping the export endpoint.

### sqlc queries

Add to `queries/scribe_feedback.sql`:

```sql
-- name: CreateFeedback :one
INSERT INTO scribe_feedback (session_id, section, category, body, user_id)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, session_id, section, category, body, user_id, at;

-- name: GetSessionFeedback :many
SELECT f.id, f.session_id, f.section, f.category, f.body, f.user_id, f.at,
       u.name AS author_name
FROM scribe_feedback f
JOIN users u ON u.id = f.user_id
WHERE f.session_id = $1
ORDER BY f.at ASC;

-- name: ListCompletedSessionsForExport :many
-- Used by the dataset export. Filtered to status='complete', optionally since a timestamp.
SELECT id, tenant_id, patient_id, encounter_id, department_id,
       transcript, ai_output, created_at, completed_at,
       sent_to_ehr_at, rejected_at
FROM scribe_sessions
WHERE status = 'complete'
  AND completed_at > COALESCE($1, '-infinity'::timestamptz)
ORDER BY completed_at ASC
LIMIT $2;
```

The export handler fans out per-session reads to the existing `GetSessionSectionEdits`, `GetSessionSectionStates`, and the new `GetSessionFeedback` queries. Per-session N+1 is acceptable for now — exports are admin-driven and low-frequency. Optimize later if it bites.

## Frontend

### Wire `NotesDrawer` to the API

`scribe.tsx`:

- Remove `notesBySession` state and `handleAddNote`'s local mutation.
- Replace with two new query hooks in `frontend/src/lib/scribe-queries.ts`:
  - `useSessionFeedback(sessionId)` — `GET /api/scribe/sessions/:id/feedback`, enabled only when `sessionId` is set.
  - `useAddFeedback()` — mutation that POSTs and invalidates the feedback query for that session.
- `handleAddNote` calls `addFeedbackMut.mutate({ sessionId, section, category, body })`.
- `notes` prop to `DetailView` / `NotesDrawer` comes from `useSessionFeedback`.

No UI changes inside `NotesDrawer` itself — the composer, category buttons, target selector, and list rendering all stay. The `FeedbackNote` type already matches the server response shape; the only adjustment is that `author`/`authorInitials` now come from the server instead of being hardcoded to "You" / "YO".

### Optimistic update

For composer responsiveness, the mutation should optimistically prepend a local note (using `user.name` + initials derived from name) and roll back on error. Failure mode: toast or inline error in the composer. Don't block the user.

### Author initials

`authorInitials` is derived server-side from `users.name`: first letter of first word + first letter of last word, uppercased. If only one word, use the first two letters. This logic lives in the feedback handler's row-to-DTO mapper.

## Auth & permissions

- Feedback create/read: any authenticated tenant user on a session belonging to their tenant. Mirrors approval read access.
- Dataset export: tenant admin only. Add a role check helper if one doesn't exist; reject with 403 for non-admins.
- The dataset endpoint must scope to the caller's `tenant_id`. Cross-tenant export is forbidden even for admins.

## Out of scope (explicitly)

- Anchored span feedback. The composer takes free text; we don't track which sentence it refers to. If categories prove insufficient later, revisit.
- Severity / "blocking" feedback. All notes are advisory.
- Surfacing feedback in stats strip, session list badges beyond the existing count, or any pre-send checklist. The drawer count badge on section cards is the only visible signal.
- Implicit-events-as-feedback-rows (e.g., synthesizing a "the physician edited HPI" row in `scribe_feedback`). The export joins the existing edit/approval tables instead.
- Backfill of past sessions into the new table.
- Multi-tenant dataset aggregation, cross-customer training. Each tenant's data stays in its own export.

## Phasing

The three pieces can ship independently, in this order:

1. **Phase 1 — Persist explicit notes.** Migration + endpoints + frontend wire-up + remove local state. Smallest unit; unblocks the UX claim that "notes are saved."
2. **Phase 2 — Snapshot audit.** Code reading + spot fixes if invariants are violated. May be zero-LOC if everything already holds.
3. **Phase 3 — Dataset export.** New admin endpoint, JSONL stream, the per-session fan-out. Lands once Phase 2 confirms the snapshot story.

Each phase is a separate plan doc when we get to implementation.
