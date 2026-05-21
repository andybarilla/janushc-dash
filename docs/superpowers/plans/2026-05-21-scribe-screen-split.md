# Scribe Screen Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the desktop Scribe experience into a full-width inbox screen and a dedicated full-width review screen so the doctor has substantially more room to read and edit the four AI-extracted sections.

**Architecture:** Routing already lives inside `ScribePage` (`/scribe/*`, with `DesktopScribe` reading `useMatch("/scribe/sessions/:sessionId")`). `DesktopScribe` becomes a switch: no match → inbox (`StatsStrip` + `InboxTable`), match → `ReviewScreen`. Filter/search state moves to URL search params so the review screen's Prev/Next walk the same order the inbox showed. The two new screens are presentational components; `DesktopScribe` keeps all query/mutation/navigation logic.

**Tech Stack:** React 19 + TypeScript, react-router-dom, TanStack Query, Vitest + Testing Library, plain CSS in `janus-scribe.css`.

**Spec deviations (decided during planning):**
- The inbox table drops the **Words** column from the spec — word count requires the transcript, which is not in the `/api/scribe/sessions` list payload (only in the per-session detail). Columns: Patient/Transcript, Encounter, Dept, Status, Created.
- Dead-CSS removal is limited to the two-pane shell rules (`.janus-workspace`, `.janus-list-pane`, `.janus-detail-pane` and the `.janus-workspace` responsive overrides). Other desktop `.janus-detail-*` / `.janus-session-*` rules are left in place — many classes (`.janus-detail-empty`, `.janus-approval-bar`, `.janus-section-*`, `.janus-failure-banner`, `.janus-editor-*`) are still reused by the new screens, so a full sweep is risky and out of scope here.

---

## File Structure

**New files:**
- `frontend/src/components/scribe/scribe-filters.ts` — `ListFilter` type, `SessionListEntry` type, `buildEntries`, `matchesFilter`, `countFor`, `filterEntries`. Pure functions extracted from `session-list.tsx`.
- `frontend/src/components/scribe/session-neighbors.ts` — `findNeighbors` pure helper for Prev/Next.
- `frontend/src/components/scribe/section-editors.tsx` — `TextEditor`, `LabsEditor` (moved out of `detail-view.tsx`; `TextEditor` gets a taller textarea).
- `frontend/src/components/scribe/inbox-table.tsx` — `InboxTable`: filter bar + full-width encounter table.
- `frontend/src/components/scribe/review-top-bar.tsx` — `ReviewTopBar`: back / identity / status / prev-next / delete.
- `frontend/src/components/scribe/review-meta-bar.tsx` — `ReviewMetaBar`: meta line + collapsible Audio / Usage & Cost pills.
- `frontend/src/components/scribe/review-screen.tsx` — `ReviewScreen`: composes the review screen (top bar, meta bar, approval bar, sections body).

**New test files:**
- `frontend/src/components/scribe/scribe-filters.test.ts`
- `frontend/src/components/scribe/session-neighbors.test.ts`
- `frontend/src/components/scribe/inbox-table.test.tsx`
- `frontend/src/components/scribe/review-screen.test.tsx`

**Modified files:**
- `frontend/src/pages/scribe.tsx` — `DesktopScribe` becomes the inbox/review switch; filter state in `useSearchParams`; Prev/Next wiring.
- `frontend/src/styles/janus-scribe.css` — new styles; remove two-pane shell rules.

**Deleted files (final task):**
- `frontend/src/components/scribe/detail-view.tsx`
- `frontend/src/components/scribe/session-list.tsx`

All commands run from `frontend/`. Verify build with `npm run build` (tsc -b + vite build). Run a single test file with `npx vitest run <path>`.

---

## Task 1: Shared filter helpers (`scribe-filters.ts`)

**Files:**
- Create: `frontend/src/components/scribe/scribe-filters.ts`
- Test: `frontend/src/components/scribe/scribe-filters.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/scribe/scribe-filters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  matchesFilter,
  countFor,
  filterEntries,
  type SessionListEntry,
} from "./scribe-filters";
import type { ScribeSession } from "@/lib/scribe-queries";
import type { StatusId } from "./types";

function entry(id: string, patient: string, statusId: StatusId): SessionListEntry {
  const session: ScribeSession = {
    id,
    patient_id: patient,
    encounter_id: `enc-${id}`,
    department_id: "1",
    status: "x",
    created_at: "2026-05-21T10:00:00Z",
    approved_count: 0,
  };
  return { session, statusId, wordCount: 0 };
}

const entries: SessionListEntry[] = [
  entry("1", "alice", "ready"),
  entry("2", "bob", "sent"),
  entry("3", "carol", "rejected"),
];

describe("matchesFilter", () => {
  it("excludes rejected from 'all'", () => {
    expect(matchesFilter("ready", "all")).toBe(true);
    expect(matchesFilter("rejected", "all")).toBe(false);
  });

  it("matches a specific status filter", () => {
    expect(matchesFilter("sent", "sent")).toBe(true);
    expect(matchesFilter("ready", "sent")).toBe(false);
  });
});

describe("countFor", () => {
  it("counts entries matching a filter", () => {
    expect(countFor(entries, "all")).toBe(2);
    expect(countFor(entries, "ready")).toBe(1);
    expect(countFor(entries, "rejected")).toBe(1);
  });
});

describe("filterEntries", () => {
  it("applies the status filter", () => {
    const result = filterEntries(entries, "ready", "");
    expect(result.map((e) => e.session.id)).toEqual(["1"]);
  });

  it("applies a case-insensitive query against patient/encounter/dept", () => {
    const result = filterEntries(entries, "all", "BOB");
    expect(result.map((e) => e.session.id)).toEqual(["2"]);
  });

  it("returns 'all' minus rejected when no query", () => {
    const result = filterEntries(entries, "all", "");
    expect(result.map((e) => e.session.id)).toEqual(["1", "2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/scribe/scribe-filters.test.ts`
Expected: FAIL — cannot resolve `./scribe-filters`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/scribe/scribe-filters.ts`:

```ts
import type { ScribeSession } from "@/lib/scribe-queries";
import { deriveStatusId, isInPipeline } from "./status";
import type { StatusId } from "./types";

export type ListFilter =
  | "all"
  | "ready"
  | "in_pipeline"
  | "sent"
  | "attention"
  | "rejected";

export interface SessionListEntry {
  session: ScribeSession;
  statusId: StatusId;
  wordCount: number;
}

export function buildEntries(sessions: ScribeSession[]): SessionListEntry[] {
  return sessions.map((s) => ({
    session: s,
    statusId: deriveStatusId(s),
    wordCount: 0,
  }));
}

export function matchesFilter(statusId: StatusId, filter: ListFilter): boolean {
  if (filter === "all") return statusId !== "rejected";
  if (filter === "ready") return statusId === "ready";
  if (filter === "in_pipeline") return isInPipeline(statusId);
  if (filter === "sent") return statusId === "sent";
  if (filter === "attention") return statusId === "failed";
  if (filter === "rejected") return statusId === "rejected";
  return true;
}

export function countFor(
  entries: SessionListEntry[],
  filter: ListFilter,
): number {
  return entries.filter((e) => matchesFilter(e.statusId, filter)).length;
}

export function filterEntries(
  entries: SessionListEntry[],
  filter: ListFilter,
  query: string,
): SessionListEntry[] {
  return entries.filter((e) => {
    if (!matchesFilter(e.statusId, filter)) return false;
    if (query) {
      const q = query.toLowerCase();
      const hay =
        `${e.session.patient_id} ${e.session.encounter_id} ${e.session.department_id}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/scribe/scribe-filters.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/scribe/scribe-filters.ts frontend/src/components/scribe/scribe-filters.test.ts
git commit -m "Add shared scribe filter helpers"
```

---

## Task 2: Prev/Next neighbor helper (`session-neighbors.ts`)

**Files:**
- Create: `frontend/src/components/scribe/session-neighbors.ts`
- Test: `frontend/src/components/scribe/session-neighbors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/scribe/session-neighbors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { findNeighbors } from "./session-neighbors";

describe("findNeighbors", () => {
  it("returns prev and next for a middle item", () => {
    expect(findNeighbors(["a", "b", "c"], "b")).toEqual({ prev: "a", next: "c" });
  });

  it("returns null prev at the start", () => {
    expect(findNeighbors(["a", "b", "c"], "a")).toEqual({ prev: null, next: "b" });
  });

  it("returns null next at the end", () => {
    expect(findNeighbors(["a", "b", "c"], "c")).toEqual({ prev: "b", next: null });
  });

  it("returns both null when the id is not in the list", () => {
    expect(findNeighbors(["a", "b"], "z")).toEqual({ prev: null, next: null });
  });

  it("returns both null for a single-item list", () => {
    expect(findNeighbors(["only"], "only")).toEqual({ prev: null, next: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/scribe/session-neighbors.test.ts`
Expected: FAIL — cannot resolve `./session-neighbors`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/scribe/session-neighbors.ts`:

```ts
export interface Neighbors {
  prev: string | null;
  next: string | null;
}

export function findNeighbors(
  orderedIds: string[],
  currentId: string,
): Neighbors {
  const i = orderedIds.indexOf(currentId);
  if (i === -1) return { prev: null, next: null };
  return {
    prev: i > 0 ? orderedIds[i - 1] : null,
    next: i < orderedIds.length - 1 ? orderedIds[i + 1] : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/scribe/session-neighbors.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/scribe/session-neighbors.ts frontend/src/components/scribe/session-neighbors.test.ts
git commit -m "Add prev/next neighbor helper"
```

---

## Task 3: Section editors (`section-editors.tsx`)

Moves `TextEditor` and `LabsEditor` out of `detail-view.tsx` into their own file. `TextEditor` gets a taller textarea (`rows={18}` instead of `rows={6}`) so editing HPI is not cramped; the existing `.janus-editor-textarea` CSS class is kept and given a larger `min-height` in Task 8.

**Files:**
- Create: `frontend/src/components/scribe/section-editors.tsx`

- [ ] **Step 1: Write the file**

Create `frontend/src/components/scribe/section-editors.tsx`:

```tsx
import { X } from "lucide-react";
import type { DiagnosisLab } from "./types";

export function TextEditor({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="janus-section-editor">
      <textarea
        className="janus-editor-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={18}
        autoFocus
      />
      <div className="janus-editor-actions">
        <button
          type="button"
          className="janus-btn janus-btn-primary janus-btn-sm"
          onClick={onSave}
        >
          Save
        </button>
        <button
          type="button"
          className="janus-btn janus-btn-ghost janus-btn-sm"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function LabsEditor({
  rows,
  onChange,
  onSave,
  onCancel,
}: {
  rows: DiagnosisLab[];
  onChange: (rows: DiagnosisLab[]) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const update = (i: number, field: keyof DiagnosisLab, value: string) => {
    const next = rows.map((r, idx) =>
      idx === i ? { ...r, [field]: value } : r,
    );
    onChange(next);
  };
  const addRow = () => onChange([...rows, { diagnosis: "", lab: "" }]);
  const removeRow = (i: number) => onChange(rows.filter((_, idx) => idx !== i));

  return (
    <div className="janus-section-editor">
      <table className="janus-labs-table janus-labs-editor-table">
        <thead>
          <tr>
            <th>Diagnosis</th>
            <th>Lab / Test</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                <input
                  className="janus-editor-input"
                  value={row.diagnosis}
                  onChange={(e) => update(i, "diagnosis", e.target.value)}
                  placeholder="Diagnosis (ICD code)"
                />
              </td>
              <td>
                <input
                  className="janus-editor-input"
                  value={row.lab}
                  onChange={(e) => update(i, "lab", e.target.value)}
                  placeholder="Lab or test"
                />
              </td>
              <td>
                <button
                  type="button"
                  className="janus-section-action"
                  title="Remove row"
                  onClick={() => removeRow(i)}
                >
                  <X />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="janus-editor-actions">
        <button
          type="button"
          className="janus-btn janus-btn-ghost janus-btn-sm"
          onClick={addRow}
        >
          + Add row
        </button>
        <button
          type="button"
          className="janus-btn janus-btn-primary janus-btn-sm"
          onClick={onSave}
        >
          Save
        </button>
        <button
          type="button"
          className="janus-btn janus-btn-ghost janus-btn-sm"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: PASS — `section-editors.tsx` compiles (unused for now; that is fine).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/scribe/section-editors.tsx
git commit -m "Extract section editors into their own module"
```

---

## Task 4: Inbox table (`inbox-table.tsx`)

Presentational component: the filter bar (search, status chips, date select) plus a full-width encounter table. Fully controlled — `DesktopScribe` owns the filter state and passes it in.

**Files:**
- Create: `frontend/src/components/scribe/inbox-table.tsx`
- Test: `frontend/src/components/scribe/inbox-table.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/scribe/inbox-table.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InboxTable } from "./inbox-table";
import type { SessionListEntry } from "./scribe-filters";
import type { ScribeSession } from "@/lib/scribe-queries";
import type { StatusId } from "./types";

function entry(id: string, patient: string, statusId: StatusId): SessionListEntry {
  const session: ScribeSession = {
    id,
    patient_id: patient,
    encounter_id: `enc-${id}`,
    department_id: "1",
    status: "x",
    created_at: "2026-05-21T10:00:00Z",
    approved_count: 0,
  };
  return { session, statusId, wordCount: 0 };
}

const entries: SessionListEntry[] = [
  entry("1", "alice", "ready"),
  entry("2", "bob", "sent"),
];

afterEach(() => cleanup());

function noop() {}

describe("InboxTable", () => {
  it("renders a row per entry", () => {
    render(
      <InboxTable
        entries={entries}
        query=""
        onQuery={noop}
        filter="all"
        onFilter={noop}
        dateRange="today"
        onDateRange={noop}
        onOpen={noop}
        loading={false}
      />,
    );
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
  });

  it("narrows rows by the active filter", () => {
    render(
      <InboxTable
        entries={entries}
        query=""
        onQuery={noop}
        filter="ready"
        onFilter={noop}
        dateRange="today"
        onDateRange={noop}
        onOpen={noop}
        loading={false}
      />,
    );
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.queryByText("bob")).not.toBeInTheDocument();
  });

  it("calls onOpen with the session id when a row is clicked", () => {
    const onOpen = vi.fn();
    render(
      <InboxTable
        entries={entries}
        query=""
        onQuery={noop}
        filter="all"
        onFilter={noop}
        dateRange="today"
        onDateRange={noop}
        onOpen={onOpen}
        loading={false}
      />,
    );
    fireEvent.click(screen.getByText("alice"));
    expect(onOpen).toHaveBeenCalledWith("1");
  });

  it("calls onQuery as the user types in search", () => {
    const onQuery = vi.fn();
    render(
      <InboxTable
        entries={entries}
        query=""
        onQuery={onQuery}
        filter="all"
        onFilter={noop}
        dateRange="today"
        onDateRange={noop}
        onOpen={noop}
        loading={false}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Search this list…"), {
      target: { value: "ali" },
    });
    expect(onQuery).toHaveBeenCalledWith("ali");
  });

  it("shows the empty state when nothing matches", () => {
    render(
      <InboxTable
        entries={[]}
        query=""
        onQuery={noop}
        filter="all"
        onFilter={noop}
        dateRange="today"
        onDateRange={noop}
        onOpen={noop}
        loading={false}
      />,
    );
    expect(
      screen.getByText("No encounters match your filters."),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/scribe/inbox-table.test.tsx`
Expected: FAIL — cannot resolve `./inbox-table`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/scribe/inbox-table.tsx`:

```tsx
import {
  Ban,
  Check,
  CircleDot,
  Loader,
  Search,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { fmtRelative } from "./format";
import { StatusPill } from "./status-pill";
import { STATUS } from "./status";
import {
  countFor,
  filterEntries,
  type ListFilter,
  type SessionListEntry,
} from "./scribe-filters";

interface Props {
  entries: SessionListEntry[];
  query: string;
  onQuery: (q: string) => void;
  filter: ListFilter;
  onFilter: (f: ListFilter) => void;
  dateRange: string;
  onDateRange: (range: string) => void;
  onOpen: (id: string) => void;
  loading: boolean;
}

const FILTERS: { id: ListFilter; label: string; icon?: LucideIcon }[] = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready", icon: CircleDot },
  { id: "in_pipeline", label: "In pipeline", icon: Loader },
  { id: "sent", label: "Sent", icon: Check },
  { id: "attention", label: "Needs attn", icon: TriangleAlert },
  { id: "rejected", label: "Rejected", icon: Ban },
];

export function InboxTable({
  entries,
  query,
  onQuery,
  filter,
  onFilter,
  dateRange,
  onDateRange,
  onOpen,
  loading,
}: Props) {
  const filtered = filterEntries(entries, filter, query);

  return (
    <div className="janus-inbox">
      <div className="janus-filter-bar">
        <div className="janus-filter-search">
          <Search />
          <input
            type="text"
            placeholder="Search this list…"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
        </div>
        <div className="janus-filter-chips">
          {FILTERS.map((f) => {
            const Icon = f.icon;
            return (
              <button
                key={f.id}
                type="button"
                className={`janus-chip ${filter === f.id ? "active" : ""}`}
                onClick={() => onFilter(f.id)}
              >
                {Icon ? <Icon /> : null}
                <span>{f.label}</span>
                <span className="janus-chip-count">{countFor(entries, f.id)}</span>
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select
            value={dateRange}
            onChange={(e) => onDateRange(e.target.value)}
            style={{
              border: "1.5px solid var(--janus-border)",
              borderRadius: "var(--janus-radius-input)",
              padding: "5px 8px",
              fontSize: 12,
              fontFamily: "inherit",
              color: "var(--janus-text-light)",
              background: "var(--janus-white)",
              cursor: "pointer",
            }}
          >
            <option value="today">Today</option>
            <option value="week">Last 7 days</option>
            <option value="month">Last 30 days</option>
            <option value="all">All time</option>
          </select>
        </div>
      </div>

      <div className="janus-inbox-table-wrap">
        <table className="janus-inbox-table">
          <thead>
            <tr>
              <th>Patient / Transcript</th>
              <th>Encounter</th>
              <th>Dept</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="janus-inbox-empty">
                  Loading encounters…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="janus-inbox-empty">
                  No encounters match your filters.
                </td>
              </tr>
            ) : (
              filtered.map((entry) => (
                <tr
                  key={entry.session.id}
                  className="janus-inbox-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(entry.session.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(entry.session.id);
                    }
                  }}
                >
                  <td className="janus-inbox-patient">
                    {entry.session.patient_id}
                  </td>
                  <td>{entry.session.encounter_id}</td>
                  <td>{entry.session.department_id || "—"}</td>
                  <td>
                    <StatusPill status={STATUS[entry.statusId]} />
                  </td>
                  <td
                    title={new Date(
                      entry.session.created_at,
                    ).toLocaleString()}
                  >
                    {fmtRelative(entry.session.created_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/scribe/inbox-table.test.tsx`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/scribe/inbox-table.tsx frontend/src/components/scribe/inbox-table.test.tsx
git commit -m "Add inbox table component"
```

---

## Task 5: Review top bar (`review-top-bar.tsx`)

**Files:**
- Create: `frontend/src/components/scribe/review-top-bar.tsx`

- [ ] **Step 1: Write the file**

Create `frontend/src/components/scribe/review-top-bar.tsx`:

```tsx
import { ArrowLeft, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import type { ScribeSessionDetail } from "@/lib/scribe-queries";
import type { StatusDef } from "./types";
import { StatusPill } from "./status-pill";

interface Props {
  session: ScribeSessionDetail;
  status: StatusDef;
  onBack: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onDelete: () => void;
}

export function ReviewTopBar({
  session,
  status,
  onBack,
  onPrev,
  onNext,
  onDelete,
}: Props) {
  return (
    <div className="janus-review-topbar">
      <button
        type="button"
        className="janus-btn janus-btn-ghost janus-btn-sm"
        onClick={onBack}
      >
        <ArrowLeft />
        Back to inbox
      </button>
      <div className="janus-review-identity">
        <h2>{session.patient_id}</h2>
        <span>
          Encounter {session.encounter_id} · Dept {session.department_id}
        </span>
      </div>
      <StatusPill status={status} large />
      <div className="janus-review-nav">
        <button
          type="button"
          className="janus-btn janus-btn-ghost janus-btn-sm"
          disabled={!onPrev}
          onClick={onPrev ?? undefined}
        >
          <ChevronLeft />
          Prev
        </button>
        <button
          type="button"
          className="janus-btn janus-btn-ghost janus-btn-sm"
          disabled={!onNext}
          onClick={onNext ?? undefined}
        >
          Next
          <ChevronRight />
        </button>
      </div>
      <button
        type="button"
        className="janus-btn janus-btn-danger-ghost janus-btn-sm"
        onClick={onDelete}
      >
        <Trash2 />
        Delete
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: PASS (component unused for now; that is fine).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/scribe/review-top-bar.tsx
git commit -m "Add review screen top bar"
```

---

## Task 6: Review meta bar (`review-meta-bar.tsx`)

The thin meta line plus the demoted Audio and Usage & Cost controls as collapsible pills. Owns its own expand/collapse state.

**Files:**
- Create: `frontend/src/components/scribe/review-meta-bar.tsx`

- [ ] **Step 1: Write the file**

Create `frontend/src/components/scribe/review-meta-bar.tsx`:

```tsx
import { useState } from "react";
import {
  Clock,
  DollarSign,
  FileText,
  Inbox,
  MessageSquare,
  Play,
  UserRound,
} from "lucide-react";
import type {
  ScribeSessionDetail,
  ScribeUsageSummary,
} from "@/lib/scribe-queries";
import type { StatusDef, StatusId } from "./types";
import { AudioStrip } from "./audio-strip";
import { UsageCostCard } from "./usage-cost-card";
import { fmtRelative } from "./format";

interface Props {
  session: ScribeSessionDetail;
  status: StatusDef;
  statusId: StatusId;
  inPipeline: boolean;
  words: number;
  totalNotes: number;
  hasSections: boolean;
}

type Panel = "audio" | "cost" | null;

function shortCost(usage?: ScribeUsageSummary): string | null {
  if (!usage) return null;
  const micros = usage.total_actual_cost_micros ?? usage.total_estimated_cost_micros;
  if (typeof micros !== "number") return null;
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

export function ReviewMetaBar({
  session,
  status,
  statusId,
  inPipeline,
  words,
  totalNotes,
  hasSections,
}: Props) {
  const [panel, setPanel] = useState<Panel>(null);
  const audioAvailable = hasSections || session.audio_available;
  const cost = shortCost(session.usage);

  const toggle = (next: Panel) =>
    setPanel((current) => (current === next ? null : next));

  return (
    <div className="janus-review-meta">
      <div className="janus-review-meta-row">
        <span className="janus-meta-item">
          <UserRound />
          Provider not on file
        </span>
        <span className="janus-meta-item">
          <Clock />
          Created {fmtRelative(session.created_at)}
        </span>
        {words > 0 ? (
          <span className="janus-meta-item">
            <FileText />
            {words.toLocaleString()} words
          </span>
        ) : null}
        <span className="janus-meta-item">
          <Inbox />
          Status: {status.label.toLowerCase()}
        </span>
        {totalNotes > 0 ? (
          <span
            className="janus-meta-item"
            style={{ color: "var(--janus-warning-text)" }}
          >
            <MessageSquare />
            {totalNotes} feedback note{totalNotes === 1 ? "" : "s"}
          </span>
        ) : null}
        <div className="janus-review-pills">
          {audioAvailable ? (
            <button
              type="button"
              className={`janus-meta-pill ${panel === "audio" ? "active" : ""}`}
              onClick={() => toggle("audio")}
            >
              <Play />
              Audio
            </button>
          ) : null}
          <button
            type="button"
            className={`janus-meta-pill ${panel === "cost" ? "active" : ""}`}
            onClick={() => toggle("cost")}
          >
            <DollarSign />
            Usage &amp; Cost{cost ? ` · ${cost}` : ""}
          </button>
        </div>
      </div>
      {panel === "audio" && audioAvailable ? (
        <AudioStrip sessionId={session.id} available={session.audio_available} />
      ) : null}
      {panel === "cost" ? (
        <UsageCostCard
          usage={session.usage}
          statusId={statusId}
          inPipeline={inPipeline}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: PASS (component unused for now; that is fine).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/scribe/review-meta-bar.tsx
git commit -m "Add review screen meta bar with collapsible audio/cost pills"
```

---

## Task 7: Review screen (`review-screen.tsx`)

Composes the dedicated review screen: top bar, meta bar, pipeline progress, failure/rejected banners, sticky approval bar, and the sections body (four `SectionCard`s + transcript) — the freed scroll area. Ports the section-rendering and edit logic from `detail-view.tsx`.

**Files:**
- Create: `frontend/src/components/scribe/review-screen.tsx`
- Test: `frontend/src/components/scribe/review-screen.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/scribe/review-screen.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewScreen } from "./review-screen";
import type { ScribeSessionDetail } from "@/lib/scribe-queries";
import type { Approvals } from "./types";

function makeSession(): ScribeSessionDetail {
  return {
    id: "s1",
    patient_id: "patient-a",
    encounter_id: "enc-1",
    department_id: "1",
    status: "ready",
    created_at: "2026-05-21T10:00:00Z",
    approved_count: 0,
    transcript: "transcript text here",
    ai_output: {
      hpi: "HPI body text",
      assessment_plan: "Plan body text",
      physical_exam: "Exam body text",
      diagnoses_labs: [],
    },
    sections: {
      hpi: { state: "pending", content: "HPI body text" },
      plan: { state: "pending", content: "Plan body text" },
      exam: { state: "pending", content: "Exam body text" },
      labs: { state: "pending", content: [] },
    },
    audio_available: false,
  };
}

const approvals: Approvals = { hpi: false, plan: false, exam: false, labs: false };

function noop() {}

function baseProps() {
  return {
    session: makeSession(),
    statusId: "ready" as const,
    approvals,
    notes: [],
    loading: false,
    notFound: false,
    canApprove: true,
    onBack: noop,
    onPrev: null,
    onNext: noop,
    onApprove: noop,
    onApproveAll: noop,
    onReject: noop,
    onDelete: noop,
    onSend: noop,
    onSaveSection: noop,
    onOpenNotes: noop,
    onAddNoteForSection: noop,
    onRetry: noop,
  };
}

afterEach(() => cleanup());

describe("ReviewScreen", () => {
  it("renders the encounter identity and section content", () => {
    render(<ReviewScreen {...baseProps()} />);
    expect(screen.getByText("patient-a")).toBeInTheDocument();
    expect(screen.getByText("HPI")).toBeInTheDocument();
    expect(screen.getByText("HPI body text")).toBeInTheDocument();
  });

  it("disables Prev when onPrev is null", () => {
    render(<ReviewScreen {...baseProps()} />);
    expect(screen.getByRole("button", { name: /Prev/ })).toBeDisabled();
  });

  it("calls onNext when Next is clicked", () => {
    const onNext = vi.fn();
    render(<ReviewScreen {...baseProps()} onNext={onNext} />);
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(onNext).toHaveBeenCalled();
  });

  it("calls onBack when Back to inbox is clicked", () => {
    const onBack = vi.fn();
    render(<ReviewScreen {...baseProps()} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /Back to inbox/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it("shows a not-found state with a back action", () => {
    const onBack = vi.fn();
    render(
      <ReviewScreen
        {...baseProps()}
        session={null}
        statusId={null}
        notFound={true}
        onBack={onBack}
      />,
    );
    expect(
      screen.getByText("This encounter could not be found."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Back to inbox/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it("opens an enlarged textarea when a section is edited", () => {
    render(<ReviewScreen {...baseProps()} />);
    fireEvent.click(screen.getAllByTitle("Edit this section")[0]);
    const textarea = screen.getByDisplayValue("HPI body text");
    expect(textarea).toBeInTheDocument();
    expect((textarea as HTMLTextAreaElement).rows).toBe(18);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/scribe/review-screen.test.tsx`
Expected: FAIL — cannot resolve `./review-screen`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/scribe/review-screen.tsx`:

```tsx
import { useState } from "react";
import {
  Ban,
  Check,
  CheckCheck,
  Clock,
  FileText,
  MessageSquare,
  RefreshCcw,
  Send,
  TriangleAlert,
  X,
} from "lucide-react";
import type { ScribeSessionDetail } from "@/lib/scribe-queries";
import type {
  Approvals,
  DiagnosisLab,
  FeedbackNote,
  SectionContent,
  SectionKey,
  StatusId,
} from "./types";
import { STATUS, isInPipeline, wordCount } from "./status";
import { PipelineProgress } from "./pipeline-progress";
import { SectionCard } from "./section-card";
import { LabsTable, PlanBody } from "./section-bodies";
import { TranscriptCard } from "./transcript-card";
import { TextEditor, LabsEditor } from "./section-editors";
import { ReviewTopBar } from "./review-top-bar";
import { ReviewMetaBar } from "./review-meta-bar";

const SECTION_KEYS: SectionKey[] = ["hpi", "plan", "exam", "labs"];

interface Props {
  session: ScribeSessionDetail | null;
  statusId: StatusId | null;
  approvals: Approvals;
  notes: FeedbackNote[];
  loading: boolean;
  notFound: boolean;
  canApprove: boolean;
  onBack: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onApprove: (section: SectionKey) => void;
  onApproveAll: () => void;
  onReject: () => void;
  onDelete: () => void;
  onSend: () => void;
  onSaveSection: (section: SectionKey, content: SectionContent) => void;
  onOpenNotes: () => void;
  onAddNoteForSection: (section: SectionKey) => void;
  onRetry: () => void;
}

function notesForSection(notes: FeedbackNote[], section: SectionKey): number {
  return notes.filter((n) => n.section === section).length;
}

export function ReviewScreen({
  session,
  statusId,
  approvals,
  notes,
  loading,
  notFound,
  canApprove,
  onBack,
  onPrev,
  onNext,
  onApprove,
  onApproveAll,
  onReject,
  onDelete,
  onSend,
  onSaveSection,
  onOpenNotes,
  onAddNoteForSection,
  onRetry,
}: Props) {
  const [editingSection, setEditingSection] = useState<SectionKey | null>(null);
  const [draftContent, setDraftContent] = useState<SectionContent>("");

  const startEdit = (section: SectionKey) => {
    const current = session?.sections?.[section]?.content;
    setDraftContent(current ?? (section === "labs" ? [] : ""));
    setEditingSection(section);
  };

  const saveEdit = () => {
    if (!editingSection) return;
    onSaveSection(editingSection, draftContent);
    setEditingSection(null);
  };

  const cancelEdit = () => setEditingSection(null);

  if (loading) {
    return (
      <div className="janus-review-screen">
        <div className="janus-detail-empty">
          <FileText />
          <div>Loading encounter…</div>
        </div>
      </div>
    );
  }

  if (notFound || !session || !statusId) {
    return (
      <div className="janus-review-screen">
        <div className="janus-detail-empty">
          <FileText />
          <div>This encounter could not be found.</div>
          <button
            type="button"
            className="janus-btn janus-btn-secondary janus-btn-sm"
            onClick={onBack}
          >
            Back to inbox
          </button>
        </div>
      </div>
    );
  }

  const status = STATUS[statusId];
  const isReady = statusId === "ready";
  const isSent = statusId === "sent";
  const isFailed = statusId === "failed";
  const isRejected = statusId === "rejected";
  const inPipeline = isInPipeline(statusId);

  const hasSections = !!session.ai_output;
  const approvedCount = (Object.keys(approvals) as SectionKey[]).filter(
    (k) => approvals[k],
  ).length;
  const allApproved = approvedCount === 4;
  const totalNotes = notes.length;
  const words = wordCount(session.transcript);

  const copySection = (text: string | undefined) => {
    if (!text) return;
    void navigator.clipboard.writeText(text);
  };

  return (
    <div className="janus-review-screen">
      <ReviewTopBar
        session={session}
        status={status}
        onBack={onBack}
        onPrev={onPrev}
        onNext={onNext}
        onDelete={onDelete}
      />
      <ReviewMetaBar
        session={session}
        status={status}
        statusId={statusId}
        inPipeline={inPipeline}
        words={words}
        totalNotes={totalNotes}
        hasSections={hasSections}
      />
      {inPipeline ? <PipelineProgress status={status} /> : null}

      {isRejected ? (
        <div className="janus-failure-banner">
          <Ban />
          <div>
            <strong>Encounter rejected</strong>
            This encounter was rejected and will not be sent to the EHR.
          </div>
        </div>
      ) : null}

      {isFailed ? (
        <div className="janus-failure-banner">
          <TriangleAlert />
          <div>
            <strong>Transcription failed</strong>
            {session.error_message ?? "Pipeline could not complete."}
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="janus-btn janus-btn-secondary janus-btn-sm"
                onClick={onRetry}
              >
                <RefreshCcw />
                Retry pipeline
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {hasSections && !isRejected ? (
        <div className="janus-approval-bar">
          <div className="janus-approval-progress">
            <span>Sections approved</span>
            <div className="janus-approval-pips">
              {SECTION_KEYS.map((k) => (
                <div
                  key={k}
                  className={`janus-approval-pip ${approvals[k] ? "done" : ""}`}
                />
              ))}
            </div>
            <span>
              <strong>{approvedCount}</strong> of 4
            </span>
          </div>
          <div className="janus-action-cluster">
            <button
              type="button"
              className="janus-btn janus-btn-ghost janus-btn-sm"
              onClick={onOpenNotes}
            >
              <MessageSquare />
              Feedback{totalNotes > 0 ? ` (${totalNotes})` : ""}
            </button>
            {canApprove && !isSent && !allApproved ? (
              <button
                type="button"
                className="janus-btn janus-btn-secondary janus-btn-sm"
                onClick={onApproveAll}
              >
                <CheckCheck />
                Approve all
              </button>
            ) : null}
            {canApprove && !isSent ? (
              <button
                type="button"
                className="janus-btn janus-btn-danger-ghost janus-btn-sm"
                onClick={onReject}
              >
                <X />
                Reject
              </button>
            ) : null}
            {canApprove ? (
              <button
                type="button"
                className="janus-btn janus-btn-primary"
                disabled={!allApproved || isSent}
                onClick={!isSent && allApproved ? onSend : undefined}
                title={
                  isSent
                    ? "Already sent"
                    : allApproved
                      ? "Send to EHR"
                      : "Approve all sections first"
                }
              >
                {isSent ? <Check /> : <Send />}
                {isSent ? "Sent to EHR" : "Send to EHR"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="janus-review-body">
        {hasSections && session.sections ? (
          <>
            {SECTION_KEYS.map((sk) => {
              const sec = session.sections[sk];
              const textContent =
                typeof sec.content === "string" ? sec.content : "";
              const labsContent = Array.isArray(sec.content)
                ? (sec.content as DiagnosisLab[])
                : [];
              const isEditing = editingSection === sk;
              const stale = sec.state === "stale";
              return (
                <SectionCard
                  key={sk}
                  sectionKey={sk}
                  approved={approvals[sk]}
                  stale={stale}
                  noteCount={notesForSection(notes, sk)}
                  canApprove={canApprove}
                  canEdit={canApprove && isReady}
                  onApprove={() => onApprove(sk)}
                  onEdit={() => startEdit(sk)}
                  onAddNote={() => onAddNoteForSection(sk)}
                  onOpenNotes={onOpenNotes}
                  onCopy={() =>
                    sk === "labs"
                      ? copySection(
                          labsContent
                            .map((d) => `${d.diagnosis} — ${d.lab}`)
                            .join("\n"),
                        )
                      : copySection(textContent)
                  }
                >
                  {isEditing ? (
                    sk === "labs" ? (
                      <LabsEditor
                        rows={draftContent as DiagnosisLab[]}
                        onChange={(rows) => setDraftContent(rows)}
                        onSave={saveEdit}
                        onCancel={cancelEdit}
                      />
                    ) : (
                      <TextEditor
                        value={draftContent as string}
                        onChange={(v) => setDraftContent(v)}
                        onSave={saveEdit}
                        onCancel={cancelEdit}
                      />
                    )
                  ) : sk === "labs" ? (
                    labsContent.length ? (
                      <LabsTable rows={labsContent} />
                    ) : (
                      <p>
                        <em>No diagnoses or labs extracted.</em>
                      </p>
                    )
                  ) : sk === "plan" ? (
                    textContent ? (
                      <PlanBody body={textContent} />
                    ) : (
                      <p>
                        <em>No assessment &amp; plan extracted.</em>
                      </p>
                    )
                  ) : (
                    <p>{textContent || <em>No content extracted.</em>}</p>
                  )}
                </SectionCard>
              );
            })}

            <TranscriptCard transcript={session.transcript} />
          </>
        ) : (
          <div
            style={{
              background: "var(--janus-white)",
              border: "2px solid var(--janus-border)",
              borderRadius: "var(--janus-radius-card)",
              padding: 40,
              textAlign: "center",
              color: "var(--janus-text-light)",
            }}
          >
            <Clock
              style={{
                width: 32,
                height: 32,
                color: "var(--janus-border)",
                display: "inline-block",
                marginBottom: 12,
              }}
            />
            <div style={{ fontSize: 14 }}>
              {isReady
                ? "AI output is being prepared."
                : "Structured output will appear here once the pipeline completes."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/scribe/review-screen.test.tsx`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/scribe/review-screen.tsx frontend/src/components/scribe/review-screen.test.tsx
git commit -m "Add dedicated review screen component"
```

---

## Task 8: Styles for the two screens (`janus-scribe.css`)

Adds CSS for the inbox table and the review screen, and removes the dead two-pane shell rules. The new screens reuse many existing classes (`.janus-page-header`, `.janus-stats-strip`, `.janus-filter-bar`, `.janus-filter-search`, `.janus-filter-chips`, `.janus-chip`, `.janus-detail-empty`, `.janus-approval-bar`, `.janus-action-cluster`, `.janus-section-card`, `.janus-failure-banner`, `.janus-meta-item`, `.janus-editor-textarea`, `.janus-btn*`) — only the rules below are new or changed.

**Files:**
- Modify: `frontend/src/styles/janus-scribe.css`

- [ ] **Step 1: Remove the dead two-pane shell rules**

In `frontend/src/styles/janus-scribe.css`, delete the `.janus-workspace`, `.janus-list-pane`, and `.janus-detail-pane` rule blocks (the block starting at the `/* Two-pane workspace */` comment, currently around lines 340-362). Also delete the `.janus-workspace` override blocks inside the responsive `@media` sections (currently around lines 1949 and 2079) — delete only the `.janus-workspace { ... }` blocks there, leave the rest of each media query intact.

- [ ] **Step 2: Append the new styles**

Add this block at the end of `frontend/src/styles/janus-scribe.css`:

```css
/* ============================================================
 * Inbox table (Screen 1)
 * ============================================================ */
.janus-inbox {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--janus-white);
}
.janus-inbox-table-wrap {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.janus-inbox-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.janus-inbox-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--janus-bg-light);
  text-align: left;
  padding: 10px 20px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--janus-text-light);
  border-bottom: 1px solid var(--janus-border);
}
.janus-inbox-table td {
  padding: 12px 20px;
  border-bottom: 1px solid var(--janus-border);
  color: var(--janus-text-dark);
  vertical-align: middle;
}
.janus-inbox-row {
  cursor: pointer;
  transition: background var(--janus-motion-fast);
}
.janus-inbox-row:hover { background: var(--janus-bg-light); }
.janus-inbox-row:focus-visible {
  outline: 2px solid var(--janus-secondary);
  outline-offset: -2px;
}
.janus-inbox-patient { font-weight: 600; color: var(--janus-primary); }
.janus-inbox-empty {
  padding: 48px 20px;
  text-align: center;
  color: var(--janus-text-light);
  font-size: 13px;
}

/* ============================================================
 * Review screen (Screen 2)
 * ============================================================ */
.janus-review-screen {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--janus-white);
}
.janus-review-topbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 28px;
  border-bottom: 1px solid var(--janus-border);
  background: var(--janus-white);
  flex-shrink: 0;
}
.janus-review-identity {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.janus-review-identity h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--janus-primary);
  line-height: 1.2;
}
.janus-review-identity span {
  font-size: 12px;
  color: var(--janus-text-light);
  font-variant-numeric: tabular-nums;
}
.janus-review-nav {
  display: flex;
  gap: 6px;
  margin-left: auto;
}
.janus-review-meta {
  padding: 12px 28px;
  border-bottom: 1px solid var(--janus-border);
  background: var(--janus-white);
  flex-shrink: 0;
}
.janus-review-meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  font-size: 12px;
  color: var(--janus-text-light);
}
.janus-review-pills {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
.janus-meta-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border: 1.5px solid var(--janus-border);
  border-radius: 999px;
  background: var(--janus-white);
  font-size: 12px;
  font-family: inherit;
  color: var(--janus-text-dark);
  cursor: pointer;
  transition: border-color var(--janus-motion-fast), background var(--janus-motion-fast);
}
.janus-meta-pill svg { width: 13px; height: 13px; }
.janus-meta-pill:hover { border-color: var(--janus-secondary); }
.janus-meta-pill.active {
  border-color: var(--janus-secondary);
  background: var(--janus-bg-light);
  color: var(--janus-primary);
}
.janus-review-meta .janus-audio-strip,
.janus-review-meta .janus-usage-card {
  margin-top: 12px;
}
.janus-review-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px 120px;
  min-height: 0;
}
.janus-review-body::-webkit-scrollbar { width: 10px; }
.janus-review-body::-webkit-scrollbar-thumb {
  background: var(--janus-border);
  border-radius: 5px;
}
.janus-review-body::-webkit-scrollbar-thumb:hover { background: var(--janus-text-light); }

/* Taller section editor textarea so HPI editing is not cramped */
.janus-review-body .janus-editor-textarea {
  min-height: 360px;
  resize: vertical;
}
```

(`.janus-usage-card` is the verified root class of `UsageCostCard` and `.janus-audio-strip` of `AudioStrip` — the `margin-top` rule spaces them below the meta row when expanded.)

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles/janus-scribe.css
git commit -m "Add inbox + review screen styles, drop two-pane shell rules"
```

---

## Task 9: Wire the two screens into `DesktopScribe` (`scribe.tsx`)

The cutover. `DesktopScribe` switches between the inbox and the review screen based on the route match, lifts filter state into URL search params, and wires Prev/Next via `findNeighbors`. After this task `detail-view.tsx` and `session-list.tsx` are no longer imported.

**Files:**
- Modify: `frontend/src/pages/scribe.tsx` (full replacement of the file contents)

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `frontend/src/pages/scribe.tsx` with:

```tsx
import { useMemo, useState } from "react";
import { useMatch, useNavigate, useSearchParams } from "react-router-dom";
import { ClipboardList, Mic } from "lucide-react";
import {
  useAddFeedback,
  useApproveSection,
  useDeleteScribeSession,
  useEditSection,
  useRejectSession,
  useRevokeSection,
  useSendToEHR,
  useScribeSession,
  useScribeSessions,
  useSessionFeedback,
} from "@/lib/scribe-queries";
import { useAuth } from "@/lib/auth";
import { useIsMobile } from "@/lib/use-is-mobile";
import { MobileScribe } from "@/components/scribe-mobile/mobile-scribe";
import { InboxTable } from "@/components/scribe/inbox-table";
import { ReviewScreen } from "@/components/scribe/review-screen";
import { NotesDrawer } from "@/components/scribe/notes-drawer";
import { StatsStrip, type StatsValues } from "@/components/scribe/stats-strip";
import { UploadModal } from "@/components/scribe/upload-modal";
import { deriveStatusId, isInPipeline } from "@/components/scribe/status";
import {
  buildEntries,
  filterEntries,
  type ListFilter,
} from "@/components/scribe/scribe-filters";
import { findNeighbors } from "@/components/scribe/session-neighbors";
import type {
  Approvals,
  FeedbackNote,
  SectionContent,
  SectionKey,
} from "@/components/scribe/types";

const EMPTY_APPROVALS: Approvals = {
  hpi: false,
  plan: false,
  exam: false,
  labs: false,
};

const SECTION_KEYS: SectionKey[] = ["hpi", "plan", "exam", "labs"];

const VALID_FILTERS: ListFilter[] = [
  "all",
  "ready",
  "in_pipeline",
  "sent",
  "attention",
  "rejected",
];

export default function ScribePage() {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileScribe />;
  return <DesktopScribe />;
}

function DesktopScribe() {
  const { data: sessions = [], isLoading: sessionsLoading } = useScribeSessions();
  const { user } = useAuth();
  const canApprove = user?.role === "physician";
  const navigate = useNavigate();

  const approveMut = useApproveSection();
  const revokeMut = useRevokeSection();
  const sendMut = useSendToEHR();
  const rejectMut = useRejectSession();
  const deleteMut = useDeleteScribeSession();
  const editMut = useEditSection();
  const addFeedbackMut = useAddFeedback();

  const sessionMatch = useMatch("/scribe/sessions/:sessionId");
  const selectedId = sessionMatch?.params.sessionId ?? null;

  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const dateRange = searchParams.get("range") ?? "today";
  const rawFilter = searchParams.get("filter");
  const filter: ListFilter = VALID_FILTERS.includes(rawFilter as ListFilter)
    ? (rawFilter as ListFilter)
    : "all";

  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDefaultSection, setNotesDefaultSection] =
    useState<SectionKey | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadSource, setUploadSource] = useState<"record" | "paste">("record");

  const {
    data: selectedDetail,
    isLoading: detailLoading,
    isError: detailError,
  } = useScribeSession(selectedId ?? "");

  const entries = useMemo(() => buildEntries(sessions), [sessions]);

  const stats: StatsValues = useMemo(() => {
    const today = new Date().toDateString();
    let todayTotal = 0;
    let inPipelineCount = 0;
    let awaitingReview = 0;
    let sentToEhr = 0;
    let needsAttention = 0;
    for (const e of entries) {
      if (new Date(e.session.created_at).toDateString() === today) todayTotal++;
      if (isInPipeline(e.statusId)) inPipelineCount++;
      if (e.statusId === "ready") awaitingReview++;
      if (e.statusId === "sent") sentToEhr++;
      if (e.statusId === "failed") needsAttention++;
    }
    return {
      todayTotal,
      inPipeline: inPipelineCount,
      awaitingReview,
      sentToEhr,
      needsAttention,
    };
  }, [entries]);

  const approvals: Approvals = useMemo(() => {
    const sections = selectedDetail?.sections;
    if (!sections) return EMPTY_APPROVALS;
    return {
      hpi: sections.hpi?.state === "approved",
      plan: sections.plan?.state === "approved",
      exam: sections.exam?.state === "approved",
      labs: sections.labs?.state === "approved",
    };
  }, [selectedDetail]);

  const { data: notes = [] } = useSessionFeedback(selectedId ?? "");

  const orderedIds = useMemo(
    () => filterEntries(entries, filter, query).map((e) => e.session.id),
    [entries, filter, query],
  );
  const neighbors = selectedId
    ? findNeighbors(orderedIds, selectedId)
    : { prev: null, next: null };

  const setParam = (key: string, value: string, defaultValue: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === defaultValue) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const gotoSession = (id: string) =>
    navigate({
      pathname: `/scribe/sessions/${id}`,
      search: searchParams.toString(),
    });

  const gotoInbox = () =>
    navigate({ pathname: "/scribe", search: searchParams.toString() });

  const handleApprove = (section: SectionKey) => {
    if (!selectedId || !canApprove) return;
    const mutation = approvals[section] ? revokeMut : approveMut;
    mutation.mutate({ sessionId: selectedId, section });
  };

  const handleApproveAll = () => {
    if (!selectedId || !canApprove) return;
    SECTION_KEYS.filter((k) => !approvals[k]).forEach((section) =>
      approveMut.mutate({ sessionId: selectedId, section }),
    );
  };

  const handleSaveSection = (section: SectionKey, content: SectionContent) => {
    if (!selectedId) return;
    editMut.mutate({ sessionId: selectedId, section, content });
  };

  const handleReject = () => {
    if (!selectedId || !canApprove) return;
    if (
      !window.confirm(
        "Reject this encounter? It won't be sent to the EHR. This can't be undone.",
      )
    )
      return;
    rejectMut.mutate({ sessionId: selectedId });
  };

  const handleDelete = () => {
    if (!selectedId) return;
    if (
      !window.confirm(
        "Delete this encounter and all related notes, approvals, feedback, and audio? This can't be undone.",
      )
    )
      return;
    deleteMut.mutate(
      { sessionId: selectedId },
      {
        onSuccess: () => {
          gotoInbox();
        },
      },
    );
  };

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

  const handleAddNoteForSection = (section: SectionKey) => {
    setNotesDefaultSection(section);
    setNotesOpen(true);
  };

  const statusId = selectedDetail ? deriveStatusId(selectedDetail) : null;

  return (
    <div className="janus-scribe-page">
      {selectedId ? (
        <ReviewScreen
          session={selectedDetail ?? null}
          statusId={statusId}
          approvals={approvals}
          notes={notes}
          loading={detailLoading && !selectedDetail}
          notFound={detailError}
          canApprove={canApprove}
          onBack={gotoInbox}
          onPrev={neighbors.prev ? () => gotoSession(neighbors.prev!) : null}
          onNext={neighbors.next ? () => gotoSession(neighbors.next!) : null}
          onApprove={handleApprove}
          onApproveAll={handleApproveAll}
          onReject={handleReject}
          onDelete={handleDelete}
          onOpenNotes={() => {
            setNotesDefaultSection(null);
            setNotesOpen(true);
          }}
          onAddNoteForSection={handleAddNoteForSection}
          onSend={() => {
            if (selectedId) sendMut.mutate({ sessionId: selectedId });
          }}
          onSaveSection={handleSaveSection}
          onRetry={() => {
            window.alert("Retry is not yet implemented.");
          }}
        />
      ) : (
        <>
          <div className="janus-page-header">
            <div>
              <h1>Scribe</h1>
              <p className="janus-page-subtitle">
                Review AI-extracted encounter notes before sending to the EHR.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="janus-btn janus-btn-secondary janus-btn-sm"
                onClick={() => {
                  setUploadSource("record");
                  setUploadOpen(true);
                }}
              >
                <Mic />
                Record
              </button>
              <button
                type="button"
                className="janus-btn janus-btn-secondary janus-btn-sm"
                onClick={() => {
                  setUploadSource("paste");
                  setUploadOpen(true);
                }}
              >
                <ClipboardList />
                Paste transcript
              </button>
            </div>
          </div>

          <StatsStrip stats={stats} />

          <InboxTable
            entries={entries}
            query={query}
            onQuery={(q) => setParam("q", q, "")}
            filter={filter}
            onFilter={(f) => setParam("filter", f, "all")}
            dateRange={dateRange}
            onDateRange={(r) => setParam("range", r, "today")}
            onOpen={gotoSession}
            loading={sessionsLoading && sessions.length === 0}
          />
        </>
      )}

      <NotesDrawer
        open={notesOpen}
        notes={notes}
        onClose={() => setNotesOpen(false)}
        onAddNote={handleAddNote}
        defaultSection={notesDefaultSection}
      />

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onCreated={gotoSession}
        initialSource={uploadSource}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: PASS — no references to `detail-view` or `session-list` remain.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — all tests green (existing + the four new test files).

- [ ] **Step 4: Manual smoke check**

Start the app (`make dev-servers` from the repo root, or `npm run dev` in `frontend/`) and verify:
- `/scribe` shows the stats strip and the full-width encounter table.
- Clicking a row opens the review screen at `/scribe/sessions/:id`; the URL keeps any `?q=`/`?filter=` params.
- The review screen shows the slim top bar, one meta line, the Audio and Usage & Cost pills (each expands/collapses), the approval bar, and the four section cards with the transcript below — the section area is visibly larger than before.
- Prev/Next step through the filtered order; Prev is disabled on the first encounter, Next on the last.
- Editing HPI opens a tall textarea.
- `Back to inbox` returns to `/scribe` with filters intact.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/scribe.tsx
git commit -m "Switch desktop Scribe to inbox + dedicated review screens"
```

---

## Task 10: Remove the dead two-pane components

`detail-view.tsx` and `session-list.tsx` are no longer imported by any desktop code. (`scribe-mobile/` has its own `detail-view.tsx` — a different file in a different directory — and is untouched.)

**Files:**
- Delete: `frontend/src/components/scribe/detail-view.tsx`
- Delete: `frontend/src/components/scribe/session-list.tsx`

- [ ] **Step 1: Confirm nothing imports them**

Run: `grep -rn "components/scribe/detail-view\|components/scribe/session-list\|\"./detail-view\"\|\"./session-list\"" frontend/src`
Expected: no matches under `frontend/src/components/scribe/` or `frontend/src/pages/`. (Matches inside `frontend/src/components/scribe-mobile/` refer to that directory's own files — those are fine, leave them.)

- [ ] **Step 2: Delete the files**

```bash
git rm frontend/src/components/scribe/detail-view.tsx frontend/src/components/scribe/session-list.tsx
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "Remove dead two-pane scribe components"
```

---

## Self-Review Notes

- **Spec coverage:** Inbox table (Task 4, 9) · dedicated review screen (Tasks 5-7, 9) · demoted stats/cost — stats stay on the inbox, cost demoted to a pill (Task 6) · one shared section scroll (`.janus-review-body`, Tasks 7-8) · taller edit textarea (Tasks 3, 8) · filter state in URL params + Prev/Next ordering (Tasks 2, 9) · routing switch (Task 9) · loading/not-found states (Tasks 4, 7) · component/file structure matches the spec's intent · tests for inbox + review + helpers (Tasks 1, 2, 4, 7).
- **Deviations from spec:** the inbox **Words** column is dropped (data unavailable in the list payload) and dead-CSS removal is scoped to the two-pane shell only — both documented at the top of this plan.
- **Type consistency:** `SessionListEntry`, `ListFilter`, `Neighbors`, and the `ReviewScreen`/`InboxTable`/`ReviewTopBar`/`ReviewMetaBar` prop shapes are defined once and consumed unchanged. `onPrev`/`onNext` are `(() => void) | null` everywhere (helper → `DesktopScribe` → `ReviewScreen` → `ReviewTopBar`).
