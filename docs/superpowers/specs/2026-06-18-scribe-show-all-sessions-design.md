# Scribe session list shows all sessions

## Goal

The scribe review page should show and count every session awaiting review. The
current fixed 50-session query cap makes the Awaiting Review card and table look
incomplete when more sessions exist.

## Scope

- Backend: update `queries/scribe.sql` `ListScribeSessions` to order newest first
  without `LIMIT 50`.
- Regenerate sqlc after the query change during implementation.
- Frontend: rename the table header from `Patient / Transcript` to `Patient`.
- Frontend: render only the existing patient display value in that column.

Out of scope: pagination, filtering changes, schema changes, and new summary
endpoints.

## Data flow

1. The frontend requests the existing scribe sessions list.
2. `ListScribeSessions` returns every matching session for the tenant/status flow,
   ordered newest first.
3. Existing frontend query state receives the full result set.
4. The Awaiting Review count and table reflect the same complete session list.

## UI behavior

- Show all sessions in the table with no pagination.
- Keep newest sessions first.
- The patient column header reads `Patient`.
- Each row shows the patient display value only; transcript label/details should
  not appear in that column.

## Testing

- Run `go test ./...`.
- Run `cd frontend && npm run build`.
