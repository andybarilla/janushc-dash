# User Management Area Design

Date: 2026-05-14
Status: Approved

## Summary

Create an admin-only User Management area that lets administrators view existing users and create pre-registered users for Google login. The MVP is intentionally invite/create focused: admins enter a user's name, email, and role; the backend creates the user in the current admin's tenant with an empty password hash, matching the existing Google-auth-only login model.

## Goals

- Add a navigable **Team** / **User Management** area in the authenticated app shell.
- Restrict the area and all user-management APIs to `admin` users.
- Let admins list users in their tenant.
- Let admins create users in their tenant with one of the existing roles: `admin`, `physician`, or `staff`.
- Make newly created users immediately eligible for Google login through the existing `/api/auth/google` flow.
- Preserve tenant isolation for listing and creation: admins can only list/create users for their own tenant.
- Enforce globally unique normalized email addresses because the existing Google login flow resolves users by email before tenant selection.

## Non-goals

- No password login or password management.
- No invite email delivery.
- No editing existing users.
- No deleting/deactivating users.
- No cross-tenant administration.
- No new audit-log reporting UI.
- No multi-tenant login selector. For this MVP, one normalized email address maps to exactly one user across the system.

## Existing context

- Backend: Go + chi, SQLC, pgx/v5, PostgreSQL.
- Frontend: Vite + React + TypeScript, TanStack Query, app shell in `frontend/src/components/layout/app-shell.tsx`.
- Auth: Google token verification followed by lookup in `users` via `GetUserByEmailOnly`.
- Existing `users` table fields: `id`, `tenant_id`, `email`, `password_hash`, `role`, `name`, `mfa_secret`, `mfa_enabled`, timestamps.
- Existing roles: `physician`, `staff`, `admin`.
- Existing auth middleware exposes JWT claims with user ID, tenant ID, and role; `auth.RequireRole("admin")` can guard routes.
- Existing Google verifier enforces `GOOGLE_ALLOWED_DOMAIN` when configured, defaulting to `janushc.com`.

## UX design

### Navigation

- Enable the existing disabled **Team** sidebar item for admins.
- Route it to `/team`.
- Hide or disable it for non-admin users. Recommended behavior: hide from non-admin users to reduce confusion.
- Add `/team` to the topbar module label map as `Team`.

### Page layout

Create `frontend/src/pages/team.tsx` using the existing Janus page style:

- Header:
  - Title: `Team`
  - Subtitle: `Manage who can access Janus for your practice.`
  - Primary action: `Add user`
- Summary strip or compact stats:
  - Total users
  - Physicians
  - Staff
  - Admins
- Main table/card:
  - Name
  - Email
  - Role
  - Created date
- Empty state:
  - Message: `No users yet.`
  - Action: `Add your first user`
- Loading and error states should match existing lightweight patterns.

### Create-user interaction

Use a modal or inline drawer-style form consistent with the existing upload modal pattern.

Fields:

- Name, required
- Email, required, lowercased/trimmed before submission
- Role, required, select from:
  - `physician` — can approve and send scribe notes
  - `staff` — can prepare/review operational work but not physician-only approvals
  - `admin` — can manage team access

Submit behavior:

- Disable submit while pending.
- On success:
  - close the modal
  - clear the form
  - invalidate/refetch the users list
  - show the created user in the table
- On duplicate email or validation failure:
  - show a user-readable inline error.

## Backend design

### Database and queries

Add a migration that enforces global case-insensitive email uniqueness for Google-login users:

```sql
CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email));
```

The down migration should drop that index. This aligns the database with the current `/api/auth/google` lookup, which uses `GetUserByEmailOnly` and does not ask the user to choose a tenant.

Before creating the index, the implementation should verify whether duplicate lowercased emails exist in development/production data. If duplicates exist, stop and escalate rather than silently choosing a tenant.

Extend `queries/users.sql` and regenerate SQLC.

Proposed queries:

```sql
-- name: ListUsersByTenant :many
SELECT id, tenant_id, email, role, name, created_at, updated_at
FROM users
WHERE tenant_id = $1
ORDER BY name ASC, email ASC;

-- name: CreateTenantUser :one
INSERT INTO users (tenant_id, email, password_hash, role, name)
VALUES ($1, lower($2), '', $3, $4)
RETURNING id, tenant_id, email, role, name, created_at, updated_at;
```

If SQLC has trouble with overlapping create methods, the current `CreateUser` can remain for seed/internal usage and `CreateTenantUser` can be used by the handler.

### Handler package

Add `internal/users/handler.go`.

Dependencies:

- `*database.Queries`
- `*config.Config` or the configured allowed Google domain string, so create-user validation can match login eligibility

Routes:

- `GET /api/users`
- `POST /api/users`

Both routes must be protected by:

- JWT auth middleware via the existing protected group
- `auth.RequireRole("admin")`

Request/response shapes:

```json
// GET /api/users response
[
  {
    "id": "uuid",
    "email": "courtney@janushc.com",
    "name": "Courtney Crance",
    "role": "physician",
    "created_at": "2026-05-14T...Z"
  }
]
```

```json
// POST /api/users request
{
  "email": "new.user@janushc.com",
  "name": "New User",
  "role": "staff"
}
```

```json
// POST /api/users response
{
  "id": "uuid",
  "email": "new.user@janushc.com",
  "name": "New User",
  "role": "staff",
  "created_at": "2026-05-14T...Z"
}
```

### Validation

Server-side validation rules:

- Auth claims must be present.
- Tenant ID must parse from claims.
- Email is required, trimmed, lowercased, and validated as a bare email address. Display-name formats accepted by `net/mail.ParseAddress` (for example `Jane <jane@janushc.com>`) must be rejected unless the parsed address exactly matches the submitted string.
- If `GOOGLE_ALLOWED_DOMAIN` is non-empty, the email domain must match it. Otherwise the API should return `400 Bad Request` with a message like `email domain is not allowed` because the user would not be able to complete Google login.
- Name is required after trimming.
- Role must be exactly one of `admin`, `physician`, `staff`.
- Duplicate normalized email, whether in the same tenant or another tenant, should return `409 Conflict` with a stable message like `user already exists`.
- Bad validation should return `400 Bad Request`.
- Non-admin should return `403 Forbidden` through existing role middleware.

### Tenant isolation and login identity

The handler must never accept `tenant_id` from the client. It must use the tenant ID from JWT claims for both list and create.

Because Google login currently identifies users by email alone, normalized email addresses must be globally unique. This avoids issuing a JWT for the wrong tenant if the same Google account were registered under multiple tenants. Listing remains tenant-scoped.

### Server wiring

Update:

- `cmd/janushc-dash/main.go` to create the users handler.
- `internal/server/server.go` to store it and register admin-only routes.

Example route shape:

```go
r.With(auth.RequireRole("admin")).Get("/api/users", s.usersHandler.HandleList)
r.With(auth.RequireRole("admin")).Post("/api/users", s.usersHandler.HandleCreate)
```

## Frontend design

### API/query layer

Extend `frontend/src/lib/queries.ts` or create `frontend/src/lib/user-queries.ts`.

Types:

```ts
export type UserRole = "admin" | "physician" | "staff";

export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  created_at: string;
}

export interface CreateUserInput {
  email: string;
  name: string;
  role: UserRole;
}
```

Hooks:

- `useManagedUsers()` -> `GET /api/users`
- `useCreateUser()` -> `POST /api/users`, invalidates `managedUsers`

### Routing

Update `frontend/src/App.tsx`:

- Import `TeamPage`.
- Add authenticated route `/team`.
- Add an admin guard for this route. A simple component can read the current user and redirect non-admin users to `/scribe`.

### App shell

Update `frontend/src/components/layout/app-shell.tsx`:

- Add `/team` path to Team nav item for admins.
- Hide Team when `user.role !== "admin"`.
- Set module label for `/team` to `Team`.

## Error handling

- Backend uses standard HTTP status codes and plain text messages, matching existing handlers.
- Frontend catches API errors from `api.fetch` and displays the `message` when available.
- Duplicate email should be explicitly shown as `A user with that email already exists.`

## Security and privacy

- Admin-only API and UI route.
- Tenant ID is derived from JWT, not user input.
- No password or secret fields returned to the frontend.
- No cross-tenant user lookup.
- Email normalization plus the global lowercased unique index prevents ambiguous Google-login identity resolution.
- Creating an admin is allowed in MVP because existing admins already have full tenant access; it should be explicit in the role selector copy.

## Testing plan

### Backend

Run `go test ./...`.

Add focused handler tests if practical using existing testing patterns:

- Admin can list tenant users.
- Admin can create a user.
- Admin cannot create an email outside `GOOGLE_ALLOWED_DOMAIN` when that config is set.
- Staff/physician cannot access routes.
- Duplicate email returns conflict.
- Invalid role/email/name returns bad request.

### Frontend

Run `cd frontend && npm run build`.

Manual acceptance checks:

1. Admin sees Team in sidebar and can open `/team`.
2. Non-admin does not see Team and direct `/team` redirects to `/scribe`.
3. Admin can create `staff`, `physician`, and `admin` users.
4. Created user appears in table after save.
5. Duplicate email shows an error and does not close the modal.
6. Newly created user's Google email can log in through the existing auth flow.

## Acceptance criteria

- Admin users can navigate to `/team`.
- `/api/users` list/create routes reject non-admin users.
- Admin users can create a tenant-scoped pre-registered Google-login user with name, email, and role.
- User list displays all users in the admin's tenant without password hashes or MFA secrets.
- The implementation builds successfully with `go test ./...` and `cd frontend && npm run build`.
