# DB-backed user settings — Design

**Date:** 2026-06-05
**Status:** Approved

## Problem

User settings (`backend`, `lang`, `parse_method`, `formula_enable`, `table_enable`,
`auto_rotate`, `mineru_url`) currently live in browser **localStorage**
(`packages/web/src/settings.ts`). They don't follow a user across devices/browsers,
and the **API** (programmatic / Bearer-key callers) has no access to a user's saved
`mineru_url` — it only falls back to the `MINERU_URL` env var.

Goals:

1. Persist user settings in the database, per user (single source of truth).
2. Make the API default `mineru_url` from the user's stored settings when a request
   does not specify one.

## Decisions

- **Full migration** off localStorage to DB-backed settings (no dual storage).
- **`mineru_url` precedence:** explicit request value → user's saved value → `MINERU_URL`
  env default. The request value remains a valid per-upload override.
- **No migration of existing localStorage values.** After this change the app starts
  from server defaults; users re-enter any non-default settings once.

## Architecture

### Data storage (`packages/server/src/db.ts`)

New table, one row per user, settings held as a JSON blob:

```sql
CREATE TABLE user_settings (
  user_id    TEXT PRIMARY KEY,
  settings   TEXT NOT NULL,              -- JSON: the OcrSettings object
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Added via the existing `runMigration(name, sql)` system. Two prepared statements:

- `getSettings`: `SELECT settings FROM user_settings WHERE user_id = ?1`
- `upsertSettings`:
  `INSERT INTO user_settings (user_id, settings, updated_at)
   VALUES ($user_id, $settings, datetime('now'))
   ON CONFLICT(user_id) DO UPDATE SET settings = $settings, updated_at = datetime('now')`

**Why a JSON blob over typed columns:** settings move as one object between frontend
and storage; reads/writes are always whole-object. A blob keeps the schema stable as
settings fields evolve. The one field the server reads individually (`mineru_url`) is
cheap to extract after `JSON.parse`.

### Validation & defaults (`packages/server/src/routes/schemas.ts`)

A Zod `SettingsSchema` mirroring `OcrSettings` validates the `PUT` body (boundary
validation per project convention). A server-side `DEFAULT_SETTINGS` constant supplies
values when a user has no row yet:

```ts
const DEFAULT_SETTINGS = {
  backend: "hybrid-auto-engine",
  lang: "ch",
  parse_method: "auto",
  formula_enable: true,
  table_enable: true,
  auto_rotate: false,
  mineru_url: "",
};
```

(Values mirror the existing frontend `DEFAULTS`. Empty `mineru_url` means "use server
default.")

### Server API (`packages/server/src/routes/settings.ts` — new)

Registered in `routes/index.ts`; `app.use("/api/settings", authMiddleware)` added in
`index.ts`.

- `GET /api/settings` → user's stored settings, or `DEFAULT_SETTINGS` if no row.
  `401` if no user.
- `PUT /api/settings` → validate body with `SettingsSchema`, upsert, return saved
  settings. `401` if no user.

### `mineru_url` resolution (`packages/server/src/routes/helpers.ts`)

New helper:

```ts
getUserSettings(userId: string | null): OcrSettings | null
// returns parsed stored settings, or null when userId is null / no row
```

Each route building `ParseOptions` (`upload.ts` — 3 handlers, `tasks.ts` re-process)
changes its `mineru_url` line from:

```ts
mineru_url: body["mineru_url"] ? String(body["mineru_url"]) : undefined,
```

to resolve **request → user DB setting → undefined**:

```ts
mineru_url: body["mineru_url"]
  ? String(body["mineru_url"])
  : getUserSettings(userId)?.mineru_url || undefined,
```

The env-var fallback is unchanged: `DEFAULT_MINERU_URL` in `mineru.ts` still applies
when `mineru_url` is `undefined`. Full chain: request → user saved → `MINERU_URL` env.
Nothing else in `mineru.ts` changes.

**Scope note:** only `mineru_url` is wired into the API default path (the explicit
requirement). Other settings are stored for the web UI; the API keeps its own body
defaults (`backend`, `lang`, etc.).

### Frontend (`packages/web/`)

`src/settings.ts` — keep `BACKENDS`/`LANGS`/`PARSE_METHODS`, the `OcrSettings` type, and
`DEFAULTS`. Remove the localStorage `loadSettings`/`saveSettings`.

`src/api.ts` — add:

- `getSettings(): Promise<OcrSettings>` → `GET /api/settings`
- `updateSettings(s: OcrSettings): Promise<OcrSettings>` → `PUT /api/settings`

`src/SettingsContext.tsx` (new) — a `SettingsProvider` wrapping the authenticated app so
both pages share one source without refetching:

- Fetches settings once on mount (`loading` state while in flight).
- Exposes `{ settings, loading, updateSetting(key, value), reset() }`.
- `updateSetting` optimistically updates local state and PUTs the full object
  (preserves auto-save-on-change UX). `reset()` PUTs `DEFAULTS`.
- PUT failures surface an error (no silent swallow).

`src/pages/Settings.tsx` — drop local `useState(loadSettings)` and the duplicate
`DEFAULTS`; consume the context. "Saved ✓" fires on successful PUT; shows an error on
failure.

`src/pages/Upload.tsx` — replace `loadSettings()` with `settings` from the context.
While settings are still `loading` (the one-time fetch on app start), the **upload
action is disabled**.

## Data flow

```
Web UI:    Settings page edit → updateSetting → PUT /api/settings → user_settings row
           Upload → uses context settings (incl. mineru_url) → POST /upload

API call:  POST /api/parse (Bearer key, no mineru_url in body)
           → route resolves getUserSettings(userId).mineru_url
           → ParseOptions.mineru_url
           → mineru.ts: mineru_url || DEFAULT_MINERU_URL (env)
```

## Error handling

- Settings endpoints return `401` when no authenticated user.
- `PUT` invalid body → Zod validation error (`400`) via the OpenAPI handler.
- `getUserSettings` returns `null` (not throwing) on null user / missing row /
  unparseable JSON; callers treat that as "no saved value" and fall through to the env
  default.
- Frontend surfaces PUT failures in the Settings UI.

## Testing (`packages/server/src/settings.test.ts` — new)

Following existing `auth.test.ts` / `apikeys.test.ts` patterns:

- `GET /api/settings` returns `DEFAULT_SETTINGS` when the user has no row.
- `PUT` then `GET` round-trips the saved settings.
- Cross-user isolation: user A's settings are invisible to user B.
- `getUserSettings` returns the stored `mineru_url` (the value the parse routes use as
  the default).
- `401` when unauthenticated.

## Out of scope

- Importing existing localStorage settings.
- Defaulting API `backend`/`lang`/etc. from stored settings.
- Any change to `mineru.ts` parsing logic beyond the unchanged env fallback.
