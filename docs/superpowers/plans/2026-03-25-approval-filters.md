# Approval Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add client-side text filters for patient name and procedure name on the pending approvals page.

**Architecture:** Two controlled text inputs filter the approval items list before it reaches BatchActions and the card list. All filtering is client-side with case-insensitive substring matching. Selection resets on filter change.

**Tech Stack:** React 19, TypeScript, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-25-approval-filters-design.md`

---

## File Structure

- Modify: `frontend/src/pages/approvals.tsx` — add filter state, filter inputs, filtering logic

No new files. BatchActions and ApprovalCard components need no changes — they already accept filtered data via props.

---

### Task 1: Add filter state and filtering logic

**Files:**
- Modify: `frontend/src/pages/approvals.tsx`

- [ ] **Step 1: Add filter state variables**

Add after the existing `useState` calls (line 10):

```typescript
const [patientFilter, setPatientFilter] = useState("");
const [procedureFilter, setProcedureFilter] = useState("");
```

- [ ] **Step 2: Add filtered items computation**

Replace the existing `unflaggedItems` line (line 38):

```typescript
const filteredItems = items.filter((item) => {
  const matchesPatient =
    !patientFilter ||
    item.patient_name.toLowerCase().includes(patientFilter.toLowerCase());
  const matchesProcedure =
    !procedureFilter ||
    item.procedure_name.toLowerCase().includes(procedureFilter.toLowerCase());
  return matchesPatient && matchesProcedure;
});

const unflaggedItems = filteredItems.filter((i) => !i.flagged);
```

- [ ] **Step 3: Clear selection when filters change**

Add a `useEffect` after the filter state declarations:

```typescript
import { useState, useEffect } from "react";
```

```typescript
useEffect(() => {
  setSelectedIds(new Set());
}, [patientFilter, procedureFilter]);
```

- [ ] **Step 4: Update BatchActions and card list to use filteredItems**

In the JSX, update `BatchActions` props to use `filteredItems`:

```typescript
<BatchActions
  totalCount={filteredItems.length}
  selectedCount={selectedIds.size}
  unflaggedCount={unflaggedItems.length}
  onSelectAllUnflagged={() => setSelectedIds(new Set(unflaggedItems.map((i) => i.id)))}
  onSelectAll={() => setSelectedIds(new Set(filteredItems.map((i) => i.id)))}
  onDeselectAll={() => setSelectedIds(new Set())}
  onApprove={handleApprove}
  approving={batchApprove.isPending}
/>
```

Update the card list to iterate over `filteredItems`:

```typescript
{filteredItems.map((item) => (
  <ApprovalCard key={item.id} item={item} selected={selectedIds.has(item.id)} onToggle={toggleItem} />
))}
```

- [ ] **Step 5: Run build to verify no type errors**

Run: `cd frontend && npm run build`
Expected: PASS — no TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/approvals.tsx
git commit -m "feat: add client-side filter logic for approvals"
```

---

### Task 2: Add filter input UI

**Files:**
- Modify: `frontend/src/pages/approvals.tsx`

- [ ] **Step 1: Add filter inputs between header and batch actions**

Insert after the header `<div>` (after the syncMessage/error blocks, before the `isLoading` ternary), inside the `<>` fragment before `<BatchActions>`:

```typescript
<div className="flex flex-col sm:flex-row gap-2">
  <input
    type="text"
    placeholder="Filter by patient name..."
    value={patientFilter}
    onChange={(e) => setPatientFilter(e.target.value)}
    className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
  />
  <input
    type="text"
    placeholder="Filter by procedure..."
    value={procedureFilter}
    onChange={(e) => setProcedureFilter(e.target.value)}
    className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
  />
</div>
```

- [ ] **Step 2: Handle empty filtered state**

The existing `items.length === 0` check shows "No pending approvals." This should remain for truly empty data. Add a separate check for when filters produce no results. After the `BatchActions` block:

```typescript
{filteredItems.length === 0 ? (
  <div className="text-center text-muted-foreground py-8 text-sm">
    No items match your filters.
  </div>
) : (
  <div className="space-y-3">
    {filteredItems.map((item) => (
      <ApprovalCard key={item.id} item={item} selected={selectedIds.has(item.id)} onToggle={toggleItem} />
    ))}
  </div>
)}
```

- [ ] **Step 3: Run build to verify**

Run: `cd frontend && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/approvals.tsx
git commit -m "feat: add filter inputs UI for approvals page"
```

---

### Task 3: Manual verification

- [ ] **Step 1: Start dev servers**

Run: `make dev-servers`

- [ ] **Step 2: Verify in browser**

Navigate to the approvals page. Confirm:
- Two filter inputs appear between header and batch actions
- Typing in patient name filter narrows the list
- Typing in procedure filter narrows the list
- Both filters compose (AND logic)
- Batch action counts reflect filtered list
- "Select all" and "Select all standard" work on filtered items only
- Selection clears when filter text changes
- Filters stack vertically on narrow viewport
- Empty filter results show "No items match your filters."
