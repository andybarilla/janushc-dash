# App Shell + Google Auth — Design Spec

## Goal

Replace the bare-bones email/password login with Google OAuth (domain-locked to `@janushc.com`), add a responsive app shell with bottom nav (mobile) / side rail (desktop), dark mode toggle, and role-filtered navigation.

## Users

4 users at Janus Healthcare:
- 1 physician (full access, approval authority)
- 3 staff (role-filtered — only see modules they can act on)

Pre-created accounts — no self-registration.

## Authentication

### Google OAuth Flow

1. Login page shows "Sign in with Google" button (Google Identity Services / `@react-oauth/google`)
2. User authenticates with Google → returns an ID token (JWT from Google)
3. Frontend sends the Google ID token to `POST /api/auth/google`
4. Backend verifies the token:
   - Validate signature via Google's `oauth2/v3/tokeninfo` or `google.golang.org/api/idtoken`
   - Check `hd` (hosted domain) claim is `janushc.com`
   - Look up user by email in the database
   - If no user found → reject (403 — not registered)
5. Backend returns an emrai JWT (same format as current — userID, tenantID, role in claims)
6. Frontend stores token in localStorage (same as current)

### Endpoints

- `POST /api/auth/google` — accepts `{id_token}`, returns `{access_token, expires_in}`
- `GET /api/auth/me` — returns current user's `{id, email, name, role}` from JWT claims
- **Remove:** `POST /api/auth/login` (email/password)

### User Management

Users are pre-created via seed script with `@janushc.com` emails and assigned roles. No passwords stored. The `password_hash` column becomes unused (keep the column, just don't populate).

### Google OAuth Config

New env vars:
- `GOOGLE_CLIENT_ID` — from Google Cloud Console (OAuth 2.0 client, Web application type)
- `GOOGLE_ALLOWED_DOMAIN` — `janushc.com`

The Google Client ID is also needed on the frontend (it's public — safe to embed).

## App Shell Layout

### Mobile (<768px)

```
┌─────────────────────────┐
│ Janus HC    [☀] [avatar]│  ← slim header
├─────────────────────────┤
│                         │
│     Page Content        │  ← scrollable
│                         │
├─────────────────────────┤
│  ✓    🎙    📄    ⚙    │  ← fixed bottom nav
│ Appr  Scr  Docs  Set   │
└─────────────────────────┘
```

- Fixed bottom tab bar with icons + labels
- Slim top header: practice name left, dark mode toggle + user avatar right
- Avatar tap → dropdown: name, email, sign out

### Desktop (≥768px)

```
┌──┬──────────────────────┐
│  │ Approvals    [☀] [av]│  ← header with page title
│✓ ├──────────────────────┤
│🎙│                      │
│📄│     Page Content     │
│  │                      │
│⚙ │                      │
└──┴──────────────────────┘
 ↑ icon rail (56px)
```

- Narrow icon sidebar (icon rail) always visible
- Icons match the bottom nav tabs
- Active item highlighted
- Content area fills remaining width

### Dark Mode

- Default to dark (migraine consideration)
- Toggle via sun/moon icon in header
- Preference persisted in `localStorage`
- Tailwind `dark:` class strategy (not media query)

### Navigation Config

Nav items defined as a config array:

```typescript
const navItems = [
  { path: "/approvals", label: "Approvals", icon: CheckIcon, roles: ["physician"] },
  { path: "/scribe", label: "Scribe", icon: MicIcon, roles: ["physician"] },
  { path: "/docs", label: "Docs", icon: FileIcon, roles: ["physician", "staff"] },
  { path: "/settings", label: "Settings", icon: SettingsIcon, roles: ["physician", "staff"] },
];
```

Filtered by the user's role from `GET /api/auth/me`. Easy to update as modules are added.

## UI Library

Install **shadcn/ui** for consistent components:
- Button, Card, Avatar, DropdownMenu, Separator
- Built-in dark mode support via CSS variables
- Matches kern-app conventions

## Files to Create

- `frontend/src/components/layout/app-shell.tsx` — responsive shell (bottom nav / side rail)
- `frontend/src/components/layout/nav-config.ts` — nav items with role filtering
- `frontend/src/components/layout/theme-toggle.tsx` — dark/light toggle with localStorage
- `frontend/src/components/layout/user-menu.tsx` — avatar dropdown with sign out
- `internal/auth/google.go` — Google ID token verification

## Files to Modify

- `frontend/src/pages/login.tsx` — replace email/password form with Google sign-in button
- `frontend/src/pages/approvals.tsx` — remove inline header (app shell provides it)
- `frontend/src/lib/auth.tsx` — swap login method for Google token flow, add user state
- `frontend/src/lib/queries.ts` — add `useCurrentUser` hook
- `frontend/src/App.tsx` — wrap authenticated routes in app shell, route guard
- `frontend/src/index.css` — add shadcn/ui theme CSS variables, dark mode defaults
- `frontend/package.json` — add `@react-oauth/google`, shadcn/ui deps
- `internal/auth/handler.go` — replace `HandleLogin` with `HandleGoogleLogin` + `HandleMe`
- `internal/server/server.go` — swap login route, add `/api/auth/me`
- `cmd/emrai/main.go` — minor wiring
- `scripts/seed.go` — update users to `@janushc.com` emails, no passwords
- `.env.example` — add `GOOGLE_CLIENT_ID`, `GOOGLE_ALLOWED_DOMAIN`
- `internal/config/config.go` — add Google config fields

## Files to Remove

- `internal/auth/password.go`
- `internal/auth/password_test.go`

## Files NOT Modified

- Database schema (no migration needed)
- Approval handler, flagger, EMR client (unchanged)
- Athena integration (unchanged)
