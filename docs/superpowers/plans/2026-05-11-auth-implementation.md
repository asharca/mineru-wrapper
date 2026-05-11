# Implementation Plan: MineRU Auth & Data Isolation

**Date**: 2026-05-11
**Based on**: [Design Spec](specs/2026-05-11-auth-design.md)

---

## Phase 1: Tooling & Dependencies

### 1.1 Install Dependencies
```bash
# Server
bun add better-auth hono@latest
# Note: better-auth requires hono ^4.x, already satisfied

# Root / Dev
bun add -D lefthook @biomejs/biome
```

### 1.2 Configure Scripts & lefthook
- Add `typecheck`, `test`, `lint` scripts to root `package.json`
- Create `lefthook.yml` with pre-commit: lint, typecheck, test
- Run `bunx lefthook install`

### 1.3 Configure Biome
- Create `biome.json` at root (or reuse eslint if preferred)
- Since project already uses eslint in web, we may use biome only for server or keep eslint
- Decision: Use eslint for web (already configured), add biome for server formatting/linting

---

## Phase 2: Backend Foundation

### 2.1 Database Schema Updates (`packages/server/src/db.ts`)
- Add `user_id TEXT` column to `tasks` table (nullable for migration)
- Create `api_keys` table with fields: id, user_id, key_hash, key_prefix, name, created_at, last_used_at, revoked_at
- Add indexes: idx_tasks_user_id, idx_api_keys_user, idx_api_keys_hash
- Update all SQL statements to include user_id filtering
- Add new prepared statements for user-scoped queries

### 2.2 Auth Configuration (`packages/server/src/auth.ts`)
- Initialize better-auth with Bun SQLite database
- Configure emailAndPassword provider
- Set up environment variables (BETTER_AUTH_SECRET, BETTER_AUTH_URL)

### 2.3 Auth Middleware (`packages/server/src/middleware/auth.ts`)
- Create middleware that:
  1. Tries better-auth session first
  2. Falls back to API Key (Bearer token) from Authorization header
  3. Sets `user` in Hono context
  4. Returns 401 if neither succeeds

### 2.4 API Key Management (`packages/server/src/apikey.ts`)
- Functions: createApiKey, validateApiKey, revokeApiKey, listApiKeys
- Key format: `mk_<random>` (32 chars random)
- Store SHA-256 hash, show prefix only after creation

### 2.5 Type Extensions (`packages/server/src/types.ts`)
- Extend Hono ContextVariableMap with `user` and `session`

---

## Phase 3: Backend Routes

### 3.1 Update `packages/server/index.ts`
- Mount better-auth handler at `/api/auth/**`
- Apply auth middleware to protected routes
- Keep public routes: `/api/auth/*`, `/api/openapi`, `/docs`, static files

### 3.2 Update `packages/server/src/routes.ts`
- All task operations must check `c.get("user")`
- Upload endpoints: set user_id from context
- List endpoints: filter by user_id
- Get/Update/Delete endpoints: verify ownership, return 404 if not owner
- File endpoints: lookup task by filename, verify ownership
- Batch delete: filter by user's tasks only

### 3.3 Add API Key Routes
- `POST /api/api-keys` - Create new API key
- `GET /api/api-keys` - List user's API keys
- `DELETE /api/api-keys/:id` - Revoke API key

---

## Phase 4: Frontend Auth

### 4.1 Auth Context (`packages/web/src/contexts/AuthContext.tsx`)
- Manage user state, login, register, logout
- Use better-auth client SDK or direct fetch to `/api/auth/*`
- Store session token in localStorage (better-auth default cookie-based, but we'll also support Bearer for API)
- Actually better-auth uses cookies by default, but we can use the `authClient` from `better-auth/react`

### 4.2 Login Page (`packages/web/src/pages/Login.tsx`)
- Email + password form
- Link to register
- Error handling

### 4.3 Register Page (`packages/web/src/pages/Register.tsx`)
- Email + password + confirm password
- Auto-login after registration

### 4.4 Route Guards
- Update `App.tsx` to wrap routes in ProtectedRoute
- Redirect unauthenticated users to /login
- Show user info and logout in header

### 4.5 API Client Updates (`packages/web/src/api.ts`)
- All requests should include credentials (cookies handle auth automatically with better-auth)
- Add 401 handler to redirect to login
- Since better-auth uses cookies, fetch with `credentials: "include"`

### 4.6 Settings Page - API Key Section
- Add section in Settings.tsx for API Key management
- List existing keys (show prefix only)
- Create new key (show once)
- Revoke keys

---

## Phase 5: Testing

### 5.1 Backend Tests (`packages/server/src/auth.test.ts`)
- Test registration and login
- Test protected route rejection (401)
- Test data isolation (user A can't see user B's tasks)
- Test API Key authentication

### 5.2 Frontend Tests
- Login/Register form rendering
- Auth context state management

### 5.3 Test Infrastructure
- Use separate test database
- Clean up between tests
- Run with `bun test`

---

## Phase 6: Integration & Verification

### 6.1 Type Checking
- Run `bun run typecheck` for both packages

### 6.2 Linting
- Run `bun run lint`

### 6.3 Testing
- Run `bun test`

### 6.4 Manual Testing
- Register new user
- Login
- Upload file
- Verify only own tasks visible
- Test API Key creation and usage

---

## File Checklist

### New Files
- [ ] `packages/server/src/auth.ts`
- [ ] `packages/server/src/middleware/auth.ts`
- [ ] `packages/server/src/types.ts`
- [ ] `packages/server/src/apikey.ts`
- [ ] `packages/server/src/auth.test.ts`
- [ ] `packages/server/src/apikey.test.ts`
- [ ] `packages/web/src/contexts/AuthContext.tsx`
- [ ] `packages/web/src/pages/Login.tsx`
- [ ] `packages/web/src/pages/Register.tsx`
- [ ] `packages/web/src/pages/Login.test.tsx`
- [ ] `lefthook.yml`
- [ ] `biome.json` (optional)

### Modified Files
- [ ] `packages/server/package.json`
- [ ] `packages/server/index.ts`
- [ ] `packages/server/src/db.ts`
- [ ] `packages/server/src/routes.ts`
- [ ] `packages/web/package.json`
- [ ] `packages/web/src/App.tsx`
- [ ] `packages/web/src/api.ts`
- [ ] `packages/web/src/main.tsx`
- [ ] `packages/web/src/pages/Settings.tsx`
- [ ] `package.json` (root)

---

## Notes

- **better-auth cookie vs Bearer**: better-auth primarily uses cookies. For our API we need Bearer support for API Keys. The auth middleware will handle both.
- **Migration**: Existing tasks will have NULL user_id. They'll be invisible to regular users but accessible to... actually we should probably run a migration to assign them to a default admin or make them public. For simplicity, existing tasks with NULL user_id will only be visible if no user is authenticated (but we require auth now). So existing tasks become orphaned. We should provide a migration script or just accept that existing data becomes inaccessible (acceptable for this project stage).
- **CORS**: Ensure credentials are allowed in CORS config for cookie-based auth.
