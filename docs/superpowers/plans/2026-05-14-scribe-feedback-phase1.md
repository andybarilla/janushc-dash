# Scribe Feedback — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-14-scribe-feedback-design.md`

**Goal:** Persist explicit feedback notes server-side and replace the React-only `notesBySession` state with a real API. No new UI surface — the existing `NotesDrawer` keeps working, just backed by the server.

**Architecture:** New `scribe_feedback` table + sqlc queries + two endpoints (`POST` / `GET /api/scribe/sessions/:id/feedback`) on the existing `scribe.Handler`. Frontend adds `useSessionFeedback` / `useAddFeedback` hooks and removes the local-state code path in `scribe.tsx`.

**Out of scope for Phase 1:** dataset export, snapshot audit (those are Phase 2 and 3). No anchored spans, no implicit-event rows, no admin endpoints.

---

### Task 1: Add the `scribe_feedback` migration

**Files:**
- Create: `migrations/010_scribe_feedback.up.sql`
- Create: `migrations/010_scribe_feedback.down.sql`

- [ ] **Step 1: Write the up migration**

Create `migrations/010_scribe_feedback.up.sql`:

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

- [ ] **Step 2: Write the down migration**

Create `migrations/010_scribe_feedback.down.sql`:

```sql
DROP TABLE IF EXISTS scribe_feedback;
```

- [ ] **Step 3: Apply the migration**

```bash
make migrate-up
```

Expected: migration `010_scribe_feedback` applies cleanly.

- [ ] **Step 4: Verify the down migration is reversible**

```bash
make migrate-down && make migrate-up
```

Expected: both succeed without error.

- [ ] **Step 5: Commit**

```bash
git add migrations/010_scribe_feedback.up.sql migrations/010_scribe_feedback.down.sql
git commit -m "feat: add scribe_feedback table"
```

---

### Task 2: Add sqlc queries and regenerate

**Files:**
- Create: `queries/scribe_feedback.sql`
- Modify: `internal/database/*.go` (regenerated)

- [ ] **Step 1: Write the queries**

Create `queries/scribe_feedback.sql`:

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
```

- [ ] **Step 2: Regenerate sqlc**

```bash
make sqlc
```

Expected: `internal/database/scribe_feedback.sql.go` is created with `CreateFeedback` and `GetSessionFeedback` methods on the `Queries` type.

- [ ] **Step 3: Verify the code compiles**

```bash
go build ./...
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add queries/scribe_feedback.sql internal/database/
git commit -m "feat: add scribe feedback queries"
```

---

### Task 3: Implement the feedback handlers

**Files:**
- Modify: `internal/scribe/handler.go`
- Create or modify: `internal/scribe/handler_test.go`

Add two methods (`HandleCreateFeedback`, `HandleListFeedback`) plus helpers (`isValidFeedbackSection`, `isValidFeedbackCategory`, `deriveInitials`, request/response types). Follow the existing handler style — claims check, UUID scan, tenant guard via `GetScribeSession`, JSON encode.

- [ ] **Step 1: Write failing tests for the validation helpers**

Append to `internal/scribe/handler_test.go`:

```go
func TestIsValidFeedbackSection(t *testing.T) {
	cases := map[string]bool{
		"overall":  true,
		"hpi":      true,
		"plan":     true,
		"exam":     true,
		"labs":     true,
		"":         false,
		"summary":  false,
		"HPI":      false,
	}
	for input, want := range cases {
		if got := isValidFeedbackSection(input); got != want {
			t.Errorf("isValidFeedbackSection(%q) = %v, want %v", input, got, want)
		}
	}
}

func TestIsValidFeedbackCategory(t *testing.T) {
	valid := []string{"missed_info", "incorrect", "hallucination", "formatting", "good", "comment"}
	for _, c := range valid {
		if !isValidFeedbackCategory(c) {
			t.Errorf("expected %q to be valid", c)
		}
	}
	invalid := []string{"", "missing", "bug", "Good"}
	for _, c := range invalid {
		if isValidFeedbackCategory(c) {
			t.Errorf("expected %q to be invalid", c)
		}
	}
}

func TestDeriveInitials(t *testing.T) {
	cases := map[string]string{
		"Jane Smith":            "JS",
		"jane smith":            "JS",
		"Dr. Marie Curie":       "DC",
		"Cher":                  "CH",
		"  Madonna  ":           "MA",
		"X":                     "X",
		"":                      "",
		"Mary Jane Smith Doe":   "MD",
	}
	for in, want := range cases {
		if got := deriveInitials(in); got != want {
			t.Errorf("deriveInitials(%q) = %q, want %q", in, got, want)
		}
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
go test ./internal/scribe/ -run "TestIsValidFeedback|TestDeriveInitials" -v
```

Expected: FAIL — helpers not yet defined.

- [ ] **Step 3: Add the helpers and types in `handler.go`**

Near the other `isValid*` helpers (after `isValidSection`, around line 130):

```go
var feedbackSections = []string{"overall", "hpi", "plan", "exam", "labs"}
var feedbackCategories = []string{
	"missed_info", "incorrect", "hallucination", "formatting", "good", "comment",
}

func isValidFeedbackSection(s string) bool {
	for _, k := range feedbackSections {
		if k == s {
			return true
		}
	}
	return false
}

func isValidFeedbackCategory(c string) bool {
	for _, k := range feedbackCategories {
		if k == c {
			return true
		}
	}
	return false
}

// deriveInitials returns up to two uppercase letters from the user's display
// name. With two or more words, takes the first letter of the first and last
// word. With one word, takes the first two letters. Empty input yields "".
func deriveInitials(name string) string {
	fields := strings.Fields(strings.TrimSuffix(strings.TrimPrefix(name, "Dr. "), "."))
	switch {
	case len(fields) == 0:
		return ""
	case len(fields) == 1:
		w := fields[0]
		if len(w) == 1 {
			return strings.ToUpper(w)
		}
		return strings.ToUpper(w[:2])
	default:
		first := fields[0]
		last := fields[len(fields)-1]
		return strings.ToUpper(string(first[0]) + string(last[0]))
	}
}
```

Add `"strings"` to the import block if it isn't already there.

- [ ] **Step 4: Run the helper tests; they should pass**

```bash
go test ./internal/scribe/ -run "TestIsValidFeedback|TestDeriveInitials" -v
```

Expected: PASS.

- [ ] **Step 5: Add the request/response types**

Near the other request types (top of `handler.go`):

```go
type createFeedbackRequest struct {
	Section  string `json:"section"`
	Category string `json:"category"`
	Body     string `json:"body"`
}

func (r createFeedbackRequest) validate() error {
	if !isValidFeedbackSection(r.Section) {
		return fmt.Errorf("invalid section")
	}
	if !isValidFeedbackCategory(r.Category) {
		return fmt.Errorf("invalid category")
	}
	if strings.TrimSpace(r.Body) == "" {
		return fmt.Errorf("body is required")
	}
	return nil
}

type feedbackResponse struct {
	ID               string `json:"id"`
	Section          string `json:"section"`
	Category         string `json:"category"`
	Body             string `json:"body"`
	Author           string `json:"author"`
	AuthorInitials   string `json:"authorInitials"`
	At               string `json:"at"`
}
```

Add `"fmt"` to imports if it isn't already there.

- [ ] **Step 6: Implement `HandleCreateFeedback`**

Append to `handler.go` (after `HandleEditSection`):

```go
func (h *Handler) HandleCreateFeedback(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	sessionUUID := pgtype.UUID{}
	if err := sessionUUID.Scan(chi.URLParam(r, "id")); err != nil {
		http.Error(w, "invalid session ID", http.StatusBadRequest)
		return
	}
	tenantUUID := pgtype.UUID{}
	if err := tenantUUID.Scan(claims.TenantID); err != nil {
		http.Error(w, "invalid tenant context", http.StatusBadRequest)
		return
	}
	userUUID := pgtype.UUID{}
	if err := userUUID.Scan(claims.UserID); err != nil {
		http.Error(w, "invalid user context", http.StatusBadRequest)
		return
	}

	// Tenant scoping: session must belong to caller's tenant.
	if _, err := h.queries.GetScribeSession(r.Context(), database.GetScribeSessionParams{
		ID:       sessionUUID,
		TenantID: tenantUUID,
	}); err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	var req createFeedbackRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if err := req.validate(); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	row, err := h.queries.CreateFeedback(r.Context(), database.CreateFeedbackParams{
		SessionID: sessionUUID,
		Section:   req.Section,
		Category:  req.Category,
		Body:      strings.TrimSpace(req.Body),
		UserID:    userUUID,
	})
	if err != nil {
		http.Error(w, "failed to save feedback", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(feedbackResponse{
		ID:             uuidToString(row.ID),
		Section:        row.Section,
		Category:       row.Category,
		Body:           row.Body,
		Author:         claims.Name,
		AuthorInitials: deriveInitials(claims.Name),
		At:             row.At.Time.Format(time.RFC3339),
	})
}
```

If `auth.Claims` does not expose `Name`, fall back to fetching the user record by `userUUID` (one extra query) — but check `internal/auth/` first; recent code paths in this repo already attach the user's display name.

- [ ] **Step 7: Implement `HandleListFeedback`**

```go
func (h *Handler) HandleListFeedback(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())
	if claims == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	sessionUUID := pgtype.UUID{}
	if err := sessionUUID.Scan(chi.URLParam(r, "id")); err != nil {
		http.Error(w, "invalid session ID", http.StatusBadRequest)
		return
	}
	tenantUUID := pgtype.UUID{}
	if err := tenantUUID.Scan(claims.TenantID); err != nil {
		http.Error(w, "invalid tenant context", http.StatusBadRequest)
		return
	}

	if _, err := h.queries.GetScribeSession(r.Context(), database.GetScribeSessionParams{
		ID:       sessionUUID,
		TenantID: tenantUUID,
	}); err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}

	rows, err := h.queries.GetSessionFeedback(r.Context(), sessionUUID)
	if err != nil {
		http.Error(w, "failed to load feedback", http.StatusInternalServerError)
		return
	}

	out := make([]feedbackResponse, 0, len(rows))
	for _, row := range rows {
		out = append(out, feedbackResponse{
			ID:             uuidToString(row.ID),
			Section:        row.Section,
			Category:       row.Category,
			Body:           row.Body,
			Author:         row.AuthorName,
			AuthorInitials: deriveInitials(row.AuthorName),
			At:             row.At.Time.Format(time.RFC3339),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}
```

- [ ] **Step 8: Add request-validation tests**

Append to `handler_test.go`:

```go
func TestValidateCreateFeedbackRequest_Valid(t *testing.T) {
	req := createFeedbackRequest{Section: "hpi", Category: "missed_info", Body: "Missed allergy."}
	if err := req.validate(); err != nil {
		t.Errorf("expected valid, got %v", err)
	}
}

func TestValidateCreateFeedbackRequest_BadSection(t *testing.T) {
	req := createFeedbackRequest{Section: "summary", Category: "good", Body: "ok"}
	if err := req.validate(); err == nil {
		t.Error("expected error for invalid section")
	}
}

func TestValidateCreateFeedbackRequest_BadCategory(t *testing.T) {
	req := createFeedbackRequest{Section: "hpi", Category: "bug", Body: "ok"}
	if err := req.validate(); err == nil {
		t.Error("expected error for invalid category")
	}
}

func TestValidateCreateFeedbackRequest_EmptyBody(t *testing.T) {
	req := createFeedbackRequest{Section: "hpi", Category: "good", Body: "   "}
	if err := req.validate(); err == nil {
		t.Error("expected error for empty body")
	}
}
```

- [ ] **Step 9: Run the full scribe test suite**

```bash
go test ./internal/scribe/ -v
```

Expected: all tests pass, including the new ones.

- [ ] **Step 10: Commit**

```bash
git add internal/scribe/handler.go internal/scribe/handler_test.go
git commit -m "feat: add scribe feedback create/list handlers"
```

---

### Task 4: Register feedback routes

**Files:**
- Modify: `internal/server/routes.go` (or wherever `/api/scribe/sessions/{id}/sections/{section}/approve` is registered — confirmed around line 86 in current code)

- [ ] **Step 1: Add the routes**

Inside the authenticated route group, alongside the other scribe routes:

```go
r.Post("/api/scribe/sessions/{id}/feedback", s.scribeHandler.HandleCreateFeedback)
r.Get("/api/scribe/sessions/{id}/feedback", s.scribeHandler.HandleListFeedback)
```

- [ ] **Step 2: Verify the build and the test suite**

```bash
go build ./... && go test ./...
```

Expected: clean build and all tests pass.

- [ ] **Step 3: Smoke-test the endpoints manually**

Start the dev backend:

```bash
make dev-servers
```

In another terminal, after logging in to grab a JWT (or pulling one from the browser):

```bash
TOKEN=...   # paste a JWT
SESSION=... # an existing completed scribe session UUID

curl -sS -X POST "http://localhost:8080/api/scribe/sessions/$SESSION/feedback" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"section":"hpi","category":"missed_info","body":"Missed amoxicillin allergy."}'

curl -sS "http://localhost:8080/api/scribe/sessions/$SESSION/feedback" \
  -H "Authorization: Bearer $TOKEN"
```

Expected: POST returns 201 with the feedback row; GET returns an array with that row.

- [ ] **Step 4: Commit**

```bash
git add internal/server/
git commit -m "feat: register scribe feedback routes"
```

---

### Task 5: Frontend hooks

**Files:**
- Modify: `frontend/src/lib/scribe-queries.ts`

- [ ] **Step 1: Add the `FeedbackNote` API type and the two hooks**

At the bottom of `scribe-queries.ts`:

```ts
import type { FeedbackNote, NoteCategoryId, NoteTarget } from "@/components/scribe/types";

interface CreateFeedbackRequest {
  sessionId: string;
  section: NoteTarget;
  category: NoteCategoryId;
  body: string;
}

export function useSessionFeedback(sessionId: string) {
  return useQuery({
    queryKey: ["scribeSessions", sessionId, "feedback"],
    queryFn: () =>
      api.fetch<FeedbackNote[]>(`/api/scribe/sessions/${sessionId}/feedback`),
    enabled: !!sessionId,
  });
}

export function useAddFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, section, category, body }: CreateFeedbackRequest) =>
      api.fetch<FeedbackNote>(`/api/scribe/sessions/${sessionId}/feedback`, {
        method: "POST",
        body: JSON.stringify({ section, category, body }),
      }),
    onMutate: async (vars) => {
      const key = ["scribeSessions", vars.sessionId, "feedback"];
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<FeedbackNote[]>(key) ?? [];
      const optimistic: FeedbackNote = {
        id: `tmp_${Date.now()}`,
        author: "You",
        authorInitials: "YO",
        at: new Date().toISOString(),
        section: vars.section,
        category: vars.category,
        body: vars.body,
      };
      queryClient.setQueryData<FeedbackNote[]>(key, [...prev, optimistic]);
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) queryClient.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: (_data, _err, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["scribeSessions", vars.sessionId, "feedback"],
      });
    },
  });
}
```

If the existing `FeedbackNote` type in `frontend/src/components/scribe/types.ts` doesn't match the server response (it should — see Task 3 Step 5), reconcile by widening the type to make `author`/`authorInitials` strings (already strings in current code).

- [ ] **Step 2: Verify the build**

```bash
cd frontend && npm run build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/scribe-queries.ts
git commit -m "feat: add scribe feedback query hooks"
```

---

### Task 6: Wire `scribe.tsx` to the new hooks

**Files:**
- Modify: `frontend/src/pages/scribe.tsx`

- [ ] **Step 1: Replace local state with the hooks**

Remove the `notesBySession` state declaration (currently `scribe.tsx:57`), remove the local `handleAddNote` logic, and replace with:

```ts
import { useSessionFeedback, useAddFeedback /* ...existing imports */ } from "@/lib/scribe-queries";

// Inside the component, near the other mutations:
const addFeedbackMut = useAddFeedback();
const { data: notes = [] } = useSessionFeedback(selectedId ?? "");

const handleAddNote = (
  note: Omit<FeedbackNote, "id" | "at" | "author" | "authorInitials">,
) => {
  if (!selectedId) return;
  addFeedbackMut.mutate({
    sessionId: selectedId,
    section: note.section,
    category: note.category,
    body: note.body,
  });
};
```

Delete the `notesBySession` state and the `setNotesBySession` calls.

- [ ] **Step 2: Verify the build**

```bash
cd frontend && npm run build
```

Expected: clean build, no unused imports.

- [ ] **Step 3: Smoke-test the UI**

Start the dev servers and exercise the drawer end-to-end:

```bash
make dev-servers
```

Manual checklist:
- Open a completed encounter, open the feedback drawer.
- Post a note with each category at least once; confirm it appears with your own initials (not "YO" once the server response lands).
- Refresh the page; notes persist.
- Switch to a different encounter and back; notes are scoped to the session.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/scribe.tsx
git commit -m "feat: persist scribe feedback via API"
```

---

### Task 7: Pre-merge verification

- [ ] **Step 1: Backend tests**

```bash
go test ./...
```

Expected: PASS.

- [ ] **Step 2: Frontend build**

```bash
cd frontend && npm run build
```

Expected: PASS.

- [ ] **Step 3: Confirm the migration round-trips one more time**

```bash
make migrate-down && make migrate-up
```

Expected: clean.

- [ ] **Step 4: Confirm no leftover local-only state in scribe.tsx**

```bash
grep -n "notesBySession\|setNotesBySession" frontend/src/pages/scribe.tsx
```

Expected: no matches.

---

## Done criteria

- Feedback notes survive page refresh and are scoped per session and per tenant.
- All four sections plus "overall" accept all six categories; bodies must be non-empty.
- A cross-tenant request to `GET /api/scribe/sessions/:id/feedback` returns 404 (handled by `GetScribeSession` tenant guard).
- The Send-to-EHR, approve, edit, reject paths are unchanged — none of them read or react to feedback.
- `notesBySession` and all local-only fallback paths are gone from `scribe.tsx`.
