# User Management MVP Implementation Plan

Date: 2026-05-14
Spec: `docs/specs/2026-05-14-user-management-design.md`
Status: Approved

## Goal

Add an admin-only Team/User Management area where tenant admins can list users and create pre-registered Google-login users with name, email, and role.

## Constraints from approved spec

- MVP supports list and create only. No invite emails, passwords, edits, deletes, or deactivation.
- Routes and UI must be admin-only.
- `tenant_id` must come from JWT claims, never from client input.
- User list/create are tenant-scoped, but normalized email must be globally unique because Google login currently resolves users by email alone.
- Created users must be eligible for the current Google login flow, including `GOOGLE_ALLOWED_DOMAIN` validation when configured.
- API responses must not expose `password_hash`, MFA fields, or `tenant_id`.

## Task 1 — Add global email uniqueness migration and SQLC queries

Files:

- Create `migrations/014_users_email_lower_unique.up.sql`
- Create `migrations/014_users_email_lower_unique.down.sql`
- Edit `queries/users.sql`
- Regenerate `internal/database/users.sql.go`

Steps:

1. Before applying the migration in any live environment, run duplicate preflight SQL:

   ```sql
   SELECT lower(email) AS normalized_email, COUNT(*) AS user_count, array_agg(id) AS user_ids
   FROM users
   GROUP BY lower(email)
   HAVING COUNT(*) > 1;
   ```

   If any rows are returned, stop and escalate.

2. Add migration:

   ```sql
   CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email));
   ```

   Down migration:

   ```sql
   DROP INDEX IF EXISTS users_email_lower_unique;
   ```

3. Append SQLC queries to `queries/users.sql`:

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

4. Run `make sqlc`.
5. Verify generated methods exist:
   - `ListUsersByTenant`
   - `CreateTenantUser`

## Task 2 — Add backend user-management handler

Files:

- Create `internal/users/handler.go`
- Create `internal/users/handler_test.go`

Implementation requirements:

- Package: `internal/users`.
- Constructor: `NewHandler(queries *database.Queries, googleAllowedDomain string)`.
- Routes exposed by handler:
  - `HandleList`
  - `HandleCreate`
- Request shape for create:

  ```go
  type createUserRequest struct {
      Email string `json:"email"`
      Name  string `json:"name"`
      Role  string `json:"role"`
  }
  ```

- Response shape:

  ```go
  type userResponse struct {
      ID        string `json:"id"`
      Email     string `json:"email"`
      Name      string `json:"name"`
      Role      string `json:"role"`
      CreatedAt string `json:"created_at"`
  }
  ```

Validation requirements:

- Get tenant ID from `auth.ClaimsFromContext(r.Context())`.
- Parse tenant ID into `pgtype.UUID`; invalid/missing claims return `401` or `400` as appropriate.
- Trim/lowercase email before storage.
- Reject empty email.
- Reject display-name emails such as `Jane <jane@janushc.com>`; accept only bare email addresses.
- Reject syntactically invalid emails.
- Reject empty name after trimming.
- Accept roles only: `admin`, `physician`, `staff`.
- If `googleAllowedDomain` is non-empty, reject emails outside that domain with `400` and `email domain is not allowed`.
- Duplicate unique constraint errors return `409 Conflict` and `user already exists`.

Tests:

- Valid request normalizes email and trims name.
- Display-name email is rejected.
- Wrong domain is rejected when configured.
- Any domain is allowed when config is empty.
- Invalid role is rejected.
- Empty name/email are rejected.
- If practical, add HTTP handler tests for create duplicate/error behavior and list response shape.

Verification:

```bash
go test ./internal/users
go test ./...
```

## Task 3 — Wire backend routes

Files:

- Edit `cmd/janushc-dash/main.go`
- Edit `internal/server/server.go`

Steps:

1. Import `github.com/andybarilla/janushc-dash/internal/users` in both files as needed.
2. In `main.go`, instantiate:

   ```go
   usersHandler := users.NewHandler(queries, cfg.GoogleAllowedDomain)
   ```

3. Extend `server.New` to accept/store `*users.Handler`.
4. Register protected admin routes inside the existing JWT-protected route group:

   ```go
   r.With(auth.RequireRole("admin")).Get("/api/users", s.usersHandler.HandleList)
   r.With(auth.RequireRole("admin")).Post("/api/users", s.usersHandler.HandleCreate)
   ```

Verification:

```bash
go test ./...
```

## Task 4 — Add frontend managed-user query hooks

Files:

- Edit `frontend/src/lib/queries.ts`

Add:

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
- `useCreateUser()` -> `POST /api/users`, trims/lowercases email, trims name, invalidates `managedUsers` on success.

Verification:

```bash
cd frontend && npm run build
```

## Task 5 — Add Team page UI

Files:

- Create `frontend/src/pages/team.tsx`
- Edit `frontend/src/styles/janus-scribe.css` only for missing Team-specific styles

UI requirements:

- Header:
  - `Team`
  - `Manage who can access Janus for your practice.`
  - `Add user` primary button
- Stats cards:
  - Total users
  - Physicians
  - Staff
  - Admins
- Users table:
  - Name
  - Email
  - Role
  - Created date
- Empty state:
  - `No users yet.`
  - `Add your first user`
- Loading/error states.
- Add-user modal with fields:
  - Name
  - Email
  - Role select (`physician`, `staff`, `admin`) with helper copy.

Behavior requirements:

- Disable submit while pending or while required fields are empty.
- On success, close modal and clear form.
- On error, keep modal open and display inline error.
- Map backend `409 user already exists` to `A user with that email already exists.`
- Catch `mutateAsync` errors in submit handler so duplicate/validation errors do not become unhandled promise rejections.

Verification:

```bash
cd frontend && npm run build
```

## Task 6 — Add admin-only route and navigation

Files:

- Edit `frontend/src/App.tsx`
- Edit `frontend/src/components/layout/app-shell.tsx`

Routing requirements:

- Import `TeamPage`.
- Add authenticated `/team` route.
- Guard `/team` for admins only.
- Avoid a false redirect before `useAuth().user` has been populated by `AuthenticatedLayout`; either:
  - use the already-loaded current-user query data in the guard, or
  - update `AuthenticatedLayout`/guard so admin status is available synchronously before route evaluation.
- Non-admin direct navigation to `/team` redirects to `/scribe`.

Navigation requirements:

- Add `"/team": "Team"` to module labels.
- Enable the existing Team sidebar item only for admin users.
- Hide Team for non-admin users.
- Team item routes to `/team`.

Verification:

```bash
cd frontend && npm run build
```

## Task 7 — End-to-end verification

Backend:

```bash
go test ./...
```

Frontend:

```bash
cd frontend && npm run build
```

Database preflight before applying migration:

```sql
SELECT lower(email) AS normalized_email, COUNT(*) AS user_count, array_agg(id) AS user_ids
FROM users
GROUP BY lower(email)
HAVING COUNT(*) > 1;
```

Manual API checks with admin JWT:

- `GET /api/users` returns `200` and only safe user fields.
- `POST /api/users` creates a `staff` user and returns `201`.
- Duplicate email with different case returns `409 user already exists`.
- Wrong domain returns `400 email domain is not allowed` when `GOOGLE_ALLOWED_DOMAIN` is set.

Manual API checks with non-admin JWT:

- `GET /api/users` returns `403 forbidden`.
- `POST /api/users` returns `403 forbidden`.

Manual frontend checks:

1. Admin sees Team in sidebar and can load `/team`.
2. Admin sees stats and table.
3. Admin can create `staff`, `physician`, and `admin` users.
4. Duplicate email shows `A user with that email already exists.` and keeps modal open.
5. Non-admin does not see Team.
6. Non-admin direct `/team` navigation redirects to `/scribe`.
7. Newly created Google email can log in through the existing auth flow.

## Final acceptance criteria

- Admin users can navigate to `/team`.
- Non-admin users cannot access `/team`.
- `GET /api/users` and `POST /api/users` require JWT auth and admin role.
- List/create are tenant-scoped from JWT claims.
- Create user never accepts tenant ID from the client.
- Created user email is normalized and globally unique case-insensitively.
- Create user enforces `GOOGLE_ALLOWED_DOMAIN` when configured.
- API responses never include password hashes, MFA secrets, or tenant IDs.
- No password/invite/edit/delete functionality is implemented.
- `go test ./...` passes.
- `cd frontend && npm run build` passes.
