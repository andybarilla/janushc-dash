# Scribe screen split — design

**Date:** 2026-05-21
**Status:** Approved
**Scope:** Frontend only (desktop). Mobile (`MobileScribe`) and the backend are untouched.

## Problem

On the desktop Scribe screen the doctor reviews and edits four AI-extracted
sections (HPI, Assessment & Plan, Physical Exam, Diagnoses & Labs). All four
content cards live inside a single scrollable `.janus-detail-body` that is pushed
down by the page header, a five-card stats strip, the detail header, the Usage &
Cost card, and the approval bar. The actual read/edit area — the HPI section in
particular — is too small for comfortable reading and editing.

## Goal

Give the doctor substantially more vertical and horizontal room to read and edit
section content by splitting the desktop Scribe experience into two screens.

## Approach

Replace the two-pane (list + detail) desktop layout with two screens:

- **Inbox** (`/scribe`) — a full-width table of encounters.
- **Review** (`/scribe/sessions/:sessionId`) — a dedicated, full-width screen for
  one encounter's sections.

Routing is already internal to `ScribePage` (the route is `/scribe/*` and
`DesktopScribe` reads `useMatch("/scribe/sessions/:sessionId")`). `DesktopScribe`
becomes a switch: no `sessionId` match → render the inbox; match → render the
review screen. `ScribePage`'s `isMobile` check and `MobileScribe` stay as-is.

## Screen 1 — Inbox (`/scribe`)

Keeps, from top to bottom:

- Page header (`Scribe` title, subtitle, Record / Paste transcript buttons).
- `StatsStrip` (the five stat cards) — unchanged.
- Filter bar — search input, status filter chips, date-range select, sort.

Replaces the 400px `SessionList` card list **and** the detail pane with a single
full-width table. Columns:

| Patient / Transcript | Encounter | Dept | Status | Words | Created |

- Status renders via the existing `StatusPill`.
- A row click navigates to `/scribe/sessions/:id` (carrying filter state — see
  Filter state below).
- Empty state: "No encounters match your filters." (as today).
- Loading state: while `useScribeSessions` loads with no data, show a simple
  loading row/placeholder.

The filter/search/sort logic (`matchesFilter`, the query substring match,
`countFor`) is reused unchanged — it moves into the inbox component or a shared
helper. Sort remains "Newest first" (the existing sort control is non-functional
today and stays that way; out of scope to make it work).

## Screen 2 — Review (`/scribe/sessions/:sessionId`)

Top to bottom:

1. **Top bar** (sticky): `‹ Back to inbox` · encounter identity (`patient_id`,
   `Encounter X · Dept Y`) · `StatusPill` · `‹ Prev` / `Next ›` · `Delete`.
2. **Meta line** (one thin row): provider, created-relative, word count,
   feedback-note count — plus the demoted chrome as expandable pills:
   - **Audio** — a small pill that expands to the existing `AudioStrip`.
   - **Usage & Cost** — a small pill (showing the total, e.g. `$0.02`) that
     expands to the existing `UsageCostCard` content.
3. **Approval bar** (sticky): approval pips + `N of 4`, Feedback, Approve all,
   Reject, Send to EHR. Same controls and gating as today.
4. **Body** — one tall shared scroll: the four `SectionCard`s stacked, then
   `TranscriptCard`. This is the freed space; HPI now gets the full screen width
   and the full body height.

Failure/rejected banners and the pipeline-progress / no-sections placeholder
keep their current behavior, rendered above the body.

### Edit mode

Today `TextEditor` uses a fixed `rows={6}` textarea. On the review screen the
editing textarea grows to fill the available height (e.g. `flex: 1` within a
tall section, or a large `min-height`) so editing HPI is not cramped. `LabsEditor`
is unchanged.

## Filter state sharing (prev/next ordering)

`‹ Prev` / `Next ›` must walk the **same filtered, sorted order the inbox
showed**. To share that order across the two screens without a global store,
the inbox's filter state moves into URL search params:

- `?q=` — search query
- `?filter=` — status filter (`all` | `ready` | `in_pipeline` | `sent` |
  `attention` | `rejected`)
- `?range=` — date range select value

Both screens use `useSearchParams`. The inbox reads/writes them; row clicks
preserve them in the target URL. The review screen reads `useScribeSessions()`,
applies the same `matchesFilter` + query filter, finds the current session's
index, and Prev/Next navigate to the neighboring id (preserving the search
params). Prev is disabled at index 0, Next at the last index.

## Components & files

**New:**

- `frontend/src/components/scribe/inbox-table.tsx` — the full-width encounter
  table (rows, columns, click-to-open).
- `frontend/src/components/scribe/review-screen.tsx` — the review screen layout
  (top bar, meta line, approval bar, body). Reuses `SectionCard`,
  `section-bodies`, `TranscriptCard`, `AudioStrip`, `UsageCostCard`,
  `PipelineProgress`, `StatusPill`.

**Modified:**

- `frontend/src/pages/scribe.tsx` — `DesktopScribe` becomes the inbox/review
  switch; lift filter state to `useSearchParams`; wire prev/next.
- `frontend/src/components/scribe/detail-view.tsx` — its content is reorganized
  into `review-screen.tsx`. The `TextEditor` / `LabsEditor` helpers move with it;
  `TextEditor` gains the taller textarea. `detail-view.tsx` is removed once the
  review screen replaces it.
- `frontend/src/components/scribe/session-list.tsx` — the card-list `SessionList`
  is replaced by `inbox-table.tsx`. The reusable filter helpers (`matchesFilter`,
  `countFor`, `ListFilter`, `buildEntries`) are kept (moved into the table file
  or a small shared module).
- `frontend/src/styles/janus-scribe.css` — new styles for the inbox table, the
  review screen layout, the collapsible audio/cost pills, and the taller editor;
  remove now-dead `.janus-workspace` / two-pane rules.

**Unchanged:** `MobileScribe` and everything under `scribe-mobile/`,
`scribe-queries.ts` and all backend code, `UploadModal`, `NotesDrawer`,
`StatsStrip`, `StatusPill`, `PipelineProgress`, `section-bodies.tsx`,
`transcript-card.tsx`, `audio-strip.tsx`.

## Data flow

No new queries or mutations. The existing hooks
(`useScribeSessions`, `useScribeSession`, `useApproveSection`,
`useRevokeSection`, `useEditSection`, `useSendToEHR`, `useRejectSession`,
`useDeleteScribeSession`, `useAddFeedback`, `useSessionFeedback`) carry over.
The handlers in `DesktopScribe` (`handleApprove`, `handleApproveAll`,
`handleSaveSection`, `handleReject`, `handleDelete`, `handleAddNote`, etc.) move
to the review screen unchanged, except `handleDelete`'s post-delete navigation:
on the review screen, deleting navigates back to the inbox (`/scribe`,
preserving filter params) instead of selecting a neighbor.

## Error & loading states

- Inbox: loading placeholder while sessions load; existing empty state.
- Review: a `sessionId` with no/loading detail shows "Loading encounter…"; an
  unknown `sessionId` shows a not-found state with a Back-to-inbox action.
- Mutation errors keep current behavior (no change).

## Testing

- Reuse the existing Vitest + Testing Library setup (see
  `usage-cost-card.test.tsx`).
- `inbox-table.test.tsx` — rows render from sessions; filter/search narrows
  rows; row click navigates with filter params preserved.
- `review-screen.test.tsx` — sections render; Prev/Next disabled at list ends
  and navigate to the correct neighbor; Back returns to `/scribe`; edit mode
  shows the enlarged textarea.
- `cd frontend && npm run build` must pass (tsc + vite build).

## Out of scope

- Backend changes.
- Mobile Scribe.
- Making the "Newest first" sort control functional.
- Wiring the date-range select into actual filtering (it is not filtered today).
