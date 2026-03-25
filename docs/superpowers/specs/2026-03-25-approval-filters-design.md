# Approval Filters

## Overview

Add client-side text filters to the pending approvals page for patient name and procedure name.

## UI

Two text inputs in a horizontal row between the page header ("Pending Approvals" + Sync button) and the batch actions bar.

- Left input: "Filter by patient name..."
- Right input: "Filter by procedure..."
- Styled consistently with existing card/border theme (bg-card, border-border, rounded-lg)
- Responsive: stack vertically on small screens

## Behavior

- Case-insensitive substring match against `patient_name` and `procedure_name`
- Empty input = no filter applied
- Filters compose (both must match for an item to show)
- Filtered list feeds into both BatchActions counts and the card list
- Selection state resets when filter text changes
- The flagged/unflagged split operates on the already-filtered list

## Scope

- Frontend only — no backend or database changes
- Files modified:
  - `frontend/src/pages/approvals.tsx` — filter state, input elements, filtering logic

## Non-goals

- Server-side filtering / pagination
- Debouncing (dataset is small)
- Persisting filter state across navigations
- Additional filter fields (staff, date, order type)
