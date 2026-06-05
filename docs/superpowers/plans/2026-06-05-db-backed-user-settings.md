# DB-backed User Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist per-user OCR settings in the database (replacing browser localStorage) and make the API default `mineru_url` from a user's stored settings.

**Architecture:** A new `user_settings` table (one row per user, settings as a JSON blob) with `GET`/`PUT /api/settings` endpoints. Parse routes resolve `mineru_url` as request → user's saved setting → `MINERU_URL` env default. The frontend drops localStorage for a `SettingsProvider` React context that loads/saves via the API.

**Tech Stack:** Bun + Hono + Zod OpenAPI + bun:sqlite (server); React 19 + Vite (web). Server tests use `bun:test`.

**Reference spec:** `docs/superpowers/specs/2026-06-05-db-backed-user-settings-design.md`

**Testing note:** The web package has Vitest installed but zero existing tests and no jsdom config. Per YAGNI, frontend tasks are verified via `bun run typecheck` + production build, not new test infra. All logic-bearing behavior (persistence, isolation, `mineru_url` resolution) is covered by server `bun:test` tests.

---

## File Structure

**Server (`packages/server/src/`):**
- `db.ts` — MODIFY: add `user_settings` table migration + `getSettings`/`upsertSettings` prepared statements.
- `routes/schemas.ts` — MODIFY: add `SettingsSchema` (Zod) + `DEFAULT_SETTINGS` constant + `Settings` type.
- `routes/settings.ts` — CREATE: `GET`/`PUT /api/settings` handlers.
- `routes/index.ts` — MODIFY: register `settingsApp`.
- `index.ts` — MODIFY: add `app.use("/api/settings", authMiddleware)`.
- `routes/helpers.ts` — MODIFY: add `getUserSettings(userId)` helper.
- `routes/upload.ts` — MODIFY: resolve `mineru_url` default in 3 handlers.
- `routes/tasks.ts` — MODIFY: resolve `mineru_url` default in the reprocess handler.
- `settings.test.ts` — CREATE: endpoint + isolation + default-resolution tests.

**Web (`packages/web/src/`):**
- `settings.ts` — MODIFY: keep constants/type/`DEFAULTS`; remove localStorage load/save.
- `api.ts` — MODIFY: add `getSettings`/`updateSettings`.
- `SettingsContext.tsx` — CREATE: `SettingsProvider` + `useSettings`.
- `main.tsx` — MODIFY: mount `SettingsProvider` inside `AuthProvider`.
- `pages/Settings.tsx` — MODIFY: consume context.
- `pages/Upload.tsx` — MODIFY: consume context, disable upload while loading.

---

## Task 1: `user_settings` table + statements

**Files:**
- Modify: `packages/server/src/db.ts`

- [ ] **Step 1: Add the migration**

In `packages/server/src/db.ts`, after the last `runMigration(...)` call (the `fts5_trigger_delete` block ending at line 107), add:

```ts
runMigration(
  "user_settings",
  `CREATE TABLE IF NOT EXISTS user_settings (
     user_id    TEXT PRIMARY KEY,
     settings   TEXT NOT NULL,
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
);
```

- [ ] **Step 2: Add prepared statements**

In the same file, inside the exported `stmt` object (before the closing `};` at line 220), add:

```ts
  getSettings: db.prepare(`SELECT settings FROM user_settings WHERE user_id = ?1`),
  upsertSettings: db.prepare(
    `INSERT INTO user_settings (user_id, settings, updated_at)
     VALUES ($user_id, $settings, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET settings = $settings, updated_at = datetime('now')`,
  ),
```

- [ ] **Step 3: Verify typecheck passes**

Run: `bun run typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/db.ts
git commit -m "feat: add user_settings table and statements"
```

---

## Task 2: Settings schema, defaults, and type

**Files:**
- Modify: `packages/server/src/routes/schemas.ts`

- [ ] **Step 1: Add the schema, defaults, and type**

At the end of `packages/server/src/routes/schemas.ts`, append:

```ts
export const SettingsSchema = z
  .object({
    backend: z.enum([
      "pipeline",
      "vlm-auto-engine",
      "hybrid-auto-engine",
      "vlm-http-client",
      "hybrid-http-client",
    ]),
    lang: z.enum(["ch", "en", "japan", "korean", "latin", "arabic", "cyrillic", "devanagari"]),
    parse_method: z.enum(["auto", "ocr", "txt"]),
    formula_enable: z.boolean(),
    table_enable: z.boolean(),
    auto_rotate: z.boolean(),
    mineru_url: z.string(),
  })
  .openapi("Settings");

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  backend: "hybrid-auto-engine",
  lang: "ch",
  parse_method: "auto",
  formula_enable: true,
  table_enable: true,
  auto_rotate: false,
  mineru_url: "",
};
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes/schemas.ts
git commit -m "feat: add Settings schema, type, and defaults"
```

---

## Task 3: Settings endpoints (TDD)

**Files:**
- Create: `packages/server/src/settings.test.ts`
- Create: `packages/server/src/routes/settings.ts`
- Modify: `packages/server/src/routes/index.ts`
- Modify: `packages/server/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/settings.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "bun:test";
import type { Hono } from "hono";

// DB_PATH, UPLOAD_DIR, and initial cleanup are handled by test-preload.ts

describe("User Settings", () => {
  let app: Hono;
  let userACookie: string;
  let userBCookie: string;

  beforeAll(async () => {
    const mod = await import("../index.ts");
    app = mod.app;

    async function register(email: string): Promise<string> {
      const res = await app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "password123", name: email }),
      });
      const setCookie = res.headers.get("set-cookie") ?? "";
      return setCookie.match(/better-auth\.session_token=([^;]+)/)?.[1] ?? "";
    }

    userACookie = await register("settingsuser-a@test.example");
    userBCookie = await register("settingsuser-b@test.example");
  });

  function authHeader(c: string) {
    return { Cookie: `better-auth.session_token=${c}` };
  }

  const sampleSettings = {
    backend: "pipeline",
    lang: "en",
    parse_method: "ocr",
    formula_enable: false,
    table_enable: false,
    auto_rotate: true,
    mineru_url: "http://example.test:9000",
  };

  it("GET returns defaults when user has no saved settings", async () => {
    const res = await app.request("/api/settings", { headers: authHeader(userACookie) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { backend: string; mineru_url: string };
    expect(body.backend).toBe("hybrid-auto-engine");
    expect(body.mineru_url).toBe("");
  });

  it("PUT persists settings and returns them", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader(userACookie) },
      body: JSON.stringify(sampleSettings),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof sampleSettings;
    expect(body).toEqual(sampleSettings);
  });

  it("GET returns the previously saved settings", async () => {
    const res = await app.request("/api/settings", { headers: authHeader(userACookie) });
    const body = (await res.json()) as typeof sampleSettings;
    expect(body).toEqual(sampleSettings);
  });

  it("does not leak one user's settings to another", async () => {
    const res = await app.request("/api/settings", { headers: authHeader(userBCookie) });
    const body = (await res.json()) as { backend: string; mineru_url: string };
    expect(body.backend).toBe("hybrid-auto-engine");
    expect(body.mineru_url).toBe("");
  });

  it("rejects invalid settings with 400", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeader(userACookie) },
      body: JSON.stringify({ ...sampleSettings, backend: "not-a-backend" }),
    });
    expect(res.status).toBe(400);
  });

  it("GET returns 401 when unauthenticated", async () => {
    const res = await app.request("/api/settings");
    expect(res.status).toBe(401);
  });

  it("PUT returns 401 when unauthenticated", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sampleSettings),
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test --cwd packages/server src/settings.test.ts`
Expected: FAIL — requests to `/api/settings` return 404 (route not registered yet).

- [ ] **Step 3: Create the route handlers**

Create `packages/server/src/routes/settings.ts`:

```ts
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { stmt } from "../db.ts";
import { getUserId } from "./helpers.ts";
import { DEFAULT_SETTINGS, ErrorSchema, SettingsSchema } from "./schemas.ts";

export const settingsApp = new OpenAPIHono();

const getSettingsRoute = createRoute({
  method: "get",
  path: "/api/settings",
  tags: ["Settings"],
  summary: "Get user settings",
  responses: {
    200: {
      description: "User settings",
      content: { "application/json": { schema: SettingsSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

settingsApp.openapi(getSettingsRoute, (c) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const row = stmt.getSettings.get(userId) as { settings: string } | undefined;
  if (!row) return c.json(DEFAULT_SETTINGS, 200);
  return c.json(JSON.parse(row.settings), 200);
});

const putSettingsRoute = createRoute({
  method: "put",
  path: "/api/settings",
  tags: ["Settings"],
  summary: "Update user settings",
  request: {
    body: {
      content: { "application/json": { schema: SettingsSchema } },
    },
  },
  responses: {
    200: {
      description: "Saved settings",
      content: { "application/json": { schema: SettingsSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

settingsApp.openapi(putSettingsRoute, (c) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const settings = c.req.valid("json");
  stmt.upsertSettings.run({ $user_id: userId, $settings: JSON.stringify(settings) });
  return c.json(settings, 200);
});
```

- [ ] **Step 4: Register the route**

In `packages/server/src/routes/index.ts`, add the import alongside the others:

```ts
import { settingsApp } from "./settings.ts";
```

and register it after `apiKeysApp` (line 11):

```ts
app.route("/", settingsApp);
```

- [ ] **Step 5: Apply auth middleware**

In `packages/server/index.ts`, add this line within the auth-middleware block (after line 23, `app.use("/api/api-keys/*", authMiddleware);`):

```ts
app.use("/api/settings", authMiddleware);
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test --cwd packages/server src/settings.test.ts`
Expected: PASS (all 7 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/settings.test.ts packages/server/src/routes/settings.ts packages/server/src/routes/index.ts packages/server/index.ts
git commit -m "feat: add GET/PUT /api/settings endpoints"
```

---

## Task 4: Resolve `mineru_url` default from settings (TDD)

**Files:**
- Modify: `packages/server/src/routes/helpers.ts`
- Modify: `packages/server/src/routes/upload.ts`
- Modify: `packages/server/src/routes/tasks.ts`
- Modify: `packages/server/src/settings.test.ts`

- [ ] **Step 1: Write the failing test**

Append this block inside the `describe("User Settings", ...)` in `packages/server/src/settings.test.ts`, before its closing `});`:

```ts
  it("getUserSettings returns the saved mineru_url for a user", async () => {
    const { getUserSettings } = await import("./routes/helpers.ts");
    const { auth } = await import("./auth.ts");
    const session = await auth.api.getSession({
      headers: new Headers(authHeader(userACookie)),
    });
    const userId = session!.user.id;
    const result = getUserSettings(userId);
    expect(result?.mineru_url).toBe("http://example.test:9000");
  });

  it("getUserSettings returns null for an unknown user", async () => {
    const { getUserSettings } = await import("./routes/helpers.ts");
    expect(getUserSettings("no-such-user-id")).toBeNull();
  });

  it("getUserSettings returns null when userId is null", async () => {
    const { getUserSettings } = await import("./routes/helpers.ts");
    expect(getUserSettings(null)).toBeNull();
  });
```

(User A saved `mineru_url: "http://example.test:9000"` in Task 3's PUT test.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test --cwd packages/server src/settings.test.ts`
Expected: FAIL — `getUserSettings` is not exported from `helpers.ts`.

- [ ] **Step 3: Add the helper**

In `packages/server/src/routes/helpers.ts`, add the import for `Settings` at the top (next to the existing `db` import on line 5):

```ts
import { type OcrTask, stmt } from "../db.ts";
import type { Settings } from "./schemas.ts";
```

(The `stmt` import already exists on line 5 — only add the `Settings` import line.)

Then add the function (place it right after `getUserId`, which ends at line 43):

```ts
export function getUserSettings(userId: string | null): Settings | null {
  if (!userId) return null;
  const row = stmt.getSettings.get(userId) as { settings: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.settings) as Settings;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test --cwd packages/server src/settings.test.ts`
Expected: PASS (all 10 tests).

- [ ] **Step 5: Wire the default into upload routes**

In `packages/server/src/routes/upload.ts`, add `getUserSettings` to the existing import from `./helpers.ts` (the import block at lines 6–13):

```ts
import {
  getUserId,
  getUserSettings,
  processTask,
  readUploadFile,
  saveBuffer,
  saveForCached,
  UPLOAD_DIR,
} from "./helpers.ts";
```

Then change each of the **three** `mineru_url` lines (they are identical, at lines 115, 218, and 335) from:

```ts
    mineru_url: body["mineru_url"] ? String(body["mineru_url"]) : undefined,
```

to:

```ts
    mineru_url: body["mineru_url"]
      ? String(body["mineru_url"])
      : getUserSettings(getUserId(c))?.mineru_url || undefined,
```

- [ ] **Step 6: Wire the default into the reprocess route**

In `packages/server/src/routes/tasks.ts`, add `getUserSettings` to the existing helpers import block (lines 6–13):

```ts
import {
  cleanFile,
  getUserId,
  getUserSettings,
  MIME_MAP,
  processTask,
  serializeTask,
  UPLOAD_DIR,
} from "./helpers.ts";
```

Then change the `mineru_url` line in the reprocess handler (line 337) from:

```ts
    mineru_url: body.mineru_url || undefined,
```

to:

```ts
    mineru_url: body.mineru_url || getUserSettings(userId)?.mineru_url || undefined,
```

(`userId` is already in scope at line 303 of the reprocess handler.)

- [ ] **Step 7: Verify typecheck + the full server suite pass**

Run: `bun run typecheck && bun test --cwd packages/server`
Expected: PASS — typecheck clean, all server tests green.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/routes/helpers.ts packages/server/src/routes/upload.ts packages/server/src/routes/tasks.ts packages/server/src/settings.test.ts
git commit -m "feat: default mineru_url from user settings in parse routes"
```

---

## Task 5: Frontend API client + settings module cleanup

**Files:**
- Modify: `packages/web/src/settings.ts`
- Modify: `packages/web/src/api.ts`

- [ ] **Step 1: Remove localStorage load/save from settings.ts**

In `packages/web/src/settings.ts`, delete the `STORAGE_KEY` constant (line 1) and the `loadSettings`/`saveSettings` functions (lines 48–60). Keep `BACKENDS`, `LANGS`, `PARSE_METHODS`, the `OcrSettings` interface, and `DEFAULTS`. Export `DEFAULTS`:

```ts
export const DEFAULTS: OcrSettings = {
  backend: "hybrid-auto-engine",
  lang: "ch",
  parse_method: "auto",
  formula_enable: true,
  table_enable: true,
  auto_rotate: false,
  mineru_url: "",
};
```

- [ ] **Step 2: Add API client functions**

In `packages/web/src/api.ts`, add an import for the settings type at the top:

```ts
import type { OcrSettings } from "./settings.ts";
```

Then append these functions at the end of the file:

```ts
export async function getSettings(): Promise<OcrSettings> {
  const res = await apiFetch("/api/settings");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateSettings(settings: OcrSettings): Promise<OcrSettings> {
  const res = await apiFetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `bun run typecheck`
Expected: PASS — note: `Settings.tsx` and `Upload.tsx` still import `loadSettings`, so this step will report errors there. That is expected and fixed in Tasks 7–8. Confirm the only errors are the missing `loadSettings`/`saveSettings` imports in those two files.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/settings.ts packages/web/src/api.ts
git commit -m "feat: add settings API client, drop localStorage helpers"
```

---

## Task 6: SettingsContext provider

**Files:**
- Create: `packages/web/src/SettingsContext.tsx`
- Modify: `packages/web/src/main.tsx`

- [ ] **Step 1: Create the provider**

Create `packages/web/src/SettingsContext.tsx`:

```tsx
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { getSettings, updateSettings } from "./api.ts";
import { useAuth } from "./contexts/AuthContext";
import { DEFAULTS, type OcrSettings } from "./settings.ts";

interface SettingsContextType {
  settings: OcrSettings;
  loading: boolean;
  updateSetting: <K extends keyof OcrSettings>(key: K, value: OcrSettings[K]) => Promise<void>;
  reset: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<OcrSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setSettings(DEFAULTS);
      setLoading(false);
      return;
    }
    setLoading(true);
    getSettings()
      .then((s) => setSettings(s))
      .catch(() => setSettings(DEFAULTS))
      .finally(() => setLoading(false));
  }, [user]);

  const persist = useCallback(async (next: OcrSettings) => {
    const prev = settings;
    setSettings(next);
    try {
      const saved = await updateSettings(next);
      setSettings(saved);
    } catch (err) {
      setSettings(prev);
      throw err;
    }
  }, [settings]);

  const updateSetting = useCallback(
    <K extends keyof OcrSettings>(key: K, value: OcrSettings[K]) =>
      persist({ ...settings, [key]: value }),
    [settings, persist],
  );

  const reset = useCallback(() => persist({ ...DEFAULTS }), [persist]);

  return (
    <SettingsContext.Provider value={{ settings, loading, updateSetting, reset }}>
      {children}
    </SettingsContext.Provider>
  );
}
```

- [ ] **Step 2: Mount the provider**

In `packages/web/src/main.tsx`, add the import:

```ts
import { SettingsProvider } from "./SettingsContext.tsx";
```

and wrap `App` with it, inside `AuthProvider` and outside `TooltipProvider`:

```tsx
      <AuthProvider>
        <SettingsProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </SettingsProvider>
      </AuthProvider>
```

- [ ] **Step 3: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS for the new files. (`Settings.tsx`/`Upload.tsx` may still error on `loadSettings`; fixed next.)

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/SettingsContext.tsx packages/web/src/main.tsx
git commit -m "feat: add SettingsProvider context"
```

---

## Task 7: Settings page consumes context

**Files:**
- Modify: `packages/web/src/pages/Settings.tsx`

- [ ] **Step 1: Swap localStorage for the context**

In `packages/web/src/pages/Settings.tsx`:

Replace the settings import block (lines 17–24) — remove `loadSettings`, `saveSettings`, and the unused `OcrSettings` type if no longer referenced; keep the constants:

```ts
import { BACKENDS, LANGS, PARSE_METHODS } from "../settings.ts";
import { useSettings } from "../SettingsContext.tsx";
```

Delete the local `DEFAULTS` constant (lines 26–34).

Replace the component's state setup (lines 58–80) with:

```tsx
  const { settings, updateSetting, reset } = useSettings();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const update = useCallback(
    <K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) => {
      setError("");
      updateSetting(key, value)
        .then(() => setSaved(true))
        .catch((err) => setError(err instanceof Error ? err.message : "Failed to save"));
    },
    [updateSetting],
  );

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 1500);
    return () => clearTimeout(t);
  }, [saved]);

  const handleReset = () => {
    setError("");
    reset()
      .then(() => setSaved(true))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to reset"));
  };
```

- [ ] **Step 2: Surface save errors in the UI**

In the header status area, next to the existing `{saved && (...)}` block (around line 136), add an error indicator:

```tsx
          {error && <span className="text-xs text-destructive font-medium">{error}</span>}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `bun run typecheck`
Expected: PASS for `Settings.tsx` (the file no longer references `loadSettings`/`saveSettings`/local `DEFAULTS`).

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/Settings.tsx
git commit -m "feat: settings page reads/writes via SettingsContext"
```

---

## Task 8: Upload page consumes context

**Files:**
- Modify: `packages/web/src/pages/Upload.tsx`

- [ ] **Step 1: Swap localStorage for the context**

In `packages/web/src/pages/Upload.tsx`:

Replace the import on line 9:

```ts
import { useSettings } from "../SettingsContext.tsx";
```

Replace the state/handler setup. Change line 15 and the `onDrop` body (lines 15–41) so settings come from the context and `auto_rotate` initializes from it once loaded:

```tsx
  const navigate = useNavigate();
  const { settings, loading } = useSettings();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [autoRotate, setAutoRotate] = useState(false);

  useEffect(() => {
    setAutoRotate(settings.auto_rotate);
  }, [settings.auto_rotate]);

  const onDrop = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      setError("");
      try {
        const result = await uploadFile(files[0], {
          backend: settings.backend,
          lang: settings.lang,
          parse_method: settings.parse_method === "auto" ? undefined : settings.parse_method,
          formula_enable: settings.formula_enable,
          table_enable: settings.table_enable,
          auto_rotate: autoRotate,
          mineru_url: settings.mineru_url || undefined,
        });
        navigate(`/task/${result.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [navigate, autoRotate, settings],
  );
```

Add `useEffect` to the React import on line 2:

```ts
import { useCallback, useEffect, useState } from "react";
```

- [ ] **Step 2: Disable upload while settings load**

Update the dropzone's `disabled` option (line 54) to also block while loading:

```ts
    disabled: uploading || loading,
```

And reflect it in the card's visual state — change the className condition (line 73) to include `loading`:

```tsx
          ${uploading || loading ? "opacity-60 cursor-not-allowed" : ""}
```

- [ ] **Step 3: Verify typecheck + build pass**

Run: `bun run typecheck && bun run --cwd packages/web build`
Expected: PASS — typecheck clean, Vite production build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/Upload.tsx
git commit -m "feat: upload page uses SettingsContext, blocks while loading"
```

---

## Task 9: Full verification

- [ ] **Step 1: Run the complete check suite**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: PASS — typecheck clean, Biome clean, all server + web tests green (`vitest` passes with no web tests).

- [ ] **Step 2: Manual smoke test (optional but recommended)**

Run `bun run dev`, sign in, open Settings, change `MineRU API URL` and a backend, reload the page → values persist (now from DB, not localStorage). Open Upload → upload control is enabled after the brief load and uses the saved settings.

- [ ] **Step 3: Final commit (if any lint autofixes applied)**

```bash
git add -A
git commit -m "chore: lint fixes for DB-backed settings" || echo "nothing to commit"
```
