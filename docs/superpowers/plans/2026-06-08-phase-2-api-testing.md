# Phase 2: API Integration Testing Audit + Black-list Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit existing backend tests and close authentication, authorization, and error-path gaps identified in the spec's BL-1…BL-13 black-list, so the test suite can serve as a regression net for Phase 3 UI work.

**Architecture:** Tests run via Bun's built-in test runner against an in-process `Hono` app (`packages/server/index.ts`). Each test file imports `app` lazily inside `beforeAll` to honor the `test-preload.ts` env setup. Existing helpers (`registerAndLogin`, cookie extraction) are duplicated per file by convention — follow that pattern. No new production code; tests-only changes unless a real product bug is discovered.

**Tech Stack:** `bun:test`, Hono in-process `app.request(...)`, better-auth session cookies, API-key Bearer auth.

**Spec:** [`docs/superpowers/specs/2026-06-08-dark-theme-and-ui-polish-design.md`](../specs/2026-06-08-dark-theme-and-ui-polish-design.md) §5

---

## Pre-Audit Findings (Controller-Read)

Before writing this plan, the controller surveyed:
- `packages/server/index.ts` — auth middleware applied to `/upload`, `/api/parse`, `/api/parse/sync`, `/tasks/*`, `/files/*`, `/api/api-keys/*`, `/api/settings`
- `packages/server/src/middleware/auth.ts` — session-cookie first, Bearer API-key second, else 401
- `packages/server/src/routes/{upload,tasks,apikeys,settings}.ts` — all return `{ error: string }` on failure
- All 6 test files in `packages/server/src/*.test.ts`

### Black-list scenario coverage map

| BL | Description | Current coverage | Gap → Task |
|---|---|---|---|
| BL-1 | Unauthenticated → 401 | `/upload`, `/tasks` (auth.test.ts); `/api/api-keys` GET/POST/DELETE (apikeys.test.ts); `/api/settings` GET/PUT (settings.test.ts) | Missing on `/api/parse`, `/api/parse/sync`, `/tasks/batch-delete`, `/tasks/{id}/reprocess`, `PATCH /tasks/{id}`, `/files/{filename}`, `/files/img/{filename}` → **T2** |
| BL-2 | Cross-user → 404 | `GET /tasks/{id}` and `DELETE /tasks/{id}` (auth.test.ts); `DELETE /api/api-keys/{id}` (apikeys.test.ts) | Missing on `PATCH /tasks/{id}`, `POST /tasks/{id}/reprocess`, `GET /files/{filename}` → **T3** |
| BL-3 | Wrong API key → 401 | `rejects invalid API keys` on `/tasks` (apikeys.test.ts) | Missing explicit test on `/api/parse`, `/api/parse/sync` → **T4** |
| BL-4 | Revoked key immediately rejected | Not covered (idempotent-revoke test does NOT verify subsequent access) → **T5** | — |
| BL-5 | Bad MIME → 400 | `/upload` covered (tasks.test.ts "rejects unsupported file types") | Missing on `/api/parse`, `/api/parse/sync` → **T6** |
| BL-6 | Over size limit → 413 | Not implemented in product. Skipped — file a separate issue if/when limit is added. | — |
| BL-7 | Missing file field → 400 | All 3 upload endpoints covered (tasks.test.ts) | ✅ |
| BL-8 | `GET /tasks/{bad-uuid}` → 404 or 400 | `returns 404 for non-existent task` uses fabricated UUID-shaped string (returns 404). Missing: malformed (non-UUID) ID returns 400 via Zod validation → **T7** | — |
| BL-9 | Delete nonexistent → 404 | Covered (tasks.test.ts) | ✅ |
| BL-10 | Error response shape consistency | Implicit — all routes return `{ error: string }`. Defer formal shape-assertion sweep; not worth a dedicated task. | — |
| BL-11 | mineru upstream 500 → task `failed` | Not covered → **T8** (new test file with isolated `MINERU_URL=http://127.0.0.1:1`) | — |
| BL-12 | Duplicate email registration → error | Not covered → **T9** | — |
| BL-13 | Logged-out cookie → 401 | Not covered → **T10** | — |

The audit doc (T1) records this map for the project archive; T2–T10 close the identified gaps; T11 verifies the suite.

---

## File Structure

**New files:**
- `docs/superpowers/test-audit.md` — audit report (Task 1)
- `packages/server/src/mineru-failure.test.ts` — isolated test for BL-11 (Task 8)

**Modified files:**
- `packages/server/src/auth.test.ts` — append BL-1 missing endpoint coverage (T2), BL-12 (T9), BL-13 (T10)
- `packages/server/src/tasks.test.ts` — append BL-2 (T3), BL-5 (T6), BL-7 malformed UUID (T7)
- `packages/server/src/apikeys.test.ts` — append BL-3 (T4), BL-4 (T5)

**No production code changes** unless a test surfaces a real bug.

---

## Task 1: Write audit report

**Files:**
- Create: `docs/superpowers/test-audit.md`

- [ ] **Step 1.1: Write the audit doc**

Create `docs/superpowers/test-audit.md` with the following content (the controller has already done the source-code audit; this task captures it for the archive):

````markdown
# Phase 2 Test Audit Report

**Date:** 2026-06-08
**Scope:** Backend API integration tests under `packages/server/src/*.test.ts`
**Purpose:** Map current coverage against the BL-1…BL-13 black-list scenarios from spec §5.3, identify gaps, and inform the implementation plan in `docs/superpowers/plans/2026-06-08-phase-2-api-testing.md`.

## Test Files Surveyed

| File | LoC | Describe | Tests |
|---|---|---|---|
| `auth.test.ts` | 138 | Auth & Data Isolation | 7 |
| `apikeys.test.ts` | 228 | API Keys | 16 |
| `tasks.test.ts` | ~480 | Upload & Tasks API | ~30 |
| `settings.test.ts` | ~115 | User Settings | 10 |
| `db.test.ts` | ~150 | runMigration / FTS5 | pure unit |
| `mineru.test.ts` | ~30 | applyImageUrls | pure unit |

## Black-list Coverage Matrix

| BL | Description | Coverage | Gap |
|---|---|---|---|
| BL-1 | Unauthenticated → 401 | `/upload`, `/tasks`, `/api/api-keys` GET/POST/DELETE, `/api/settings` GET/PUT | `/api/parse`, `/api/parse/sync`, `/tasks/batch-delete`, `/tasks/{id}/reprocess`, `PATCH /tasks/{id}`, `/files/{filename}`, `/files/img/{filename}` |
| BL-2 | Cross-user → 404 | `GET /tasks/{id}`, `DELETE /tasks/{id}`, `DELETE /api/api-keys/{id}` | `PATCH /tasks/{id}`, `POST /tasks/{id}/reprocess`, `GET /files/{filename}` |
| BL-3 | Wrong API key → 401 | `/tasks` only (apikeys.test.ts) | `/api/parse`, `/api/parse/sync` |
| BL-4 | Revoked key immediately rejected | none | needs dedicated test |
| BL-5 | Bad MIME → 400 | `/upload` | `/api/parse`, `/api/parse/sync` |
| BL-6 | Over size limit → 413 | n/a — product gap | filed separately |
| BL-7 | Missing file field → 400 | all 3 endpoints | — |
| BL-8 | GET /tasks/{bad-uuid} → 404/400 | non-existent UUID-shape returns 404 | malformed (non-UUID) ID returns 400 via Zod validation |
| BL-9 | Delete nonexistent → 404 | covered | — |
| BL-10 | Error response shape consistency | implicit `{ error: string }` everywhere | dedicated assertion sweep deferred — low risk |
| BL-11 | mineru upstream 500 → task `failed` | none | needs isolated test with closed-port MINERU_URL |
| BL-12 | Duplicate email registration → error | none | better-auth handles it; needs explicit test |
| BL-13 | Logged-out cookie → 401 | none | needs sign-out test |

## Known Product Gaps (Flagged During Audit)

- **BL-6 — no upload size limit.** `routes/upload.ts` does not enforce a max byte length on the multipart `file` field. Recommended follow-up: add a config-driven limit (`MAX_UPLOAD_BYTES`, default 50 MB), reject with 413. Track separately from Phase 2.
- **`GET /files/:filename` falls back to `user_id IS NULL`.** SQL: `WHERE filename = ? AND (user_id = ? OR user_id IS NULL)`. Legacy data without an owner is accessible to any authenticated user. Verify whether any rows with `user_id IS NULL` still exist; if not, tighten the predicate.

## Out of Scope for Phase 2

- Frontend integration tests (Phase 3 may add)
- Playwright E2E (deliberately deferred per spec §5)
- Refactoring existing tests for DRY — current per-file `registerAndLogin` duplication is acceptable
````

- [ ] **Step 1.2: Commit**

```bash
git add docs/superpowers/test-audit.md
git commit -m "docs: Phase 2 测试覆盖审计报告"
```

---

## Task 2: BL-1 — fill unauthenticated 401 gaps

**Files:**
- Modify: `packages/server/src/auth.test.ts`

- [ ] **Step 2.1: Add failing tests**

Open `packages/server/src/auth.test.ts`. After the existing `it("should reject unauthenticated task list", …)` block (around line 37), insert the following test block. **Place it inside the existing `describe("Auth & Data Isolation", …)`**:

```ts
  it("should reject unauthenticated /api/parse", async () => {
    const res = await app.request("/api/parse", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("should reject unauthenticated /api/parse/sync", async () => {
    const res = await app.request("/api/parse/sync", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("should reject unauthenticated /tasks/batch-delete", async () => {
    const res = await app.request("/tasks/batch-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["00000000-0000-0000-0000-000000000000"] }),
    });
    expect(res.status).toBe(401);
  });

  it("should reject unauthenticated POST /tasks/{id}/reprocess", async () => {
    const res = await app.request("/tasks/00000000-0000-0000-0000-000000000000/reprocess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("should reject unauthenticated PATCH /tasks/{id}", async () => {
    const res = await app.request("/tasks/00000000-0000-0000-0000-000000000000", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result_md: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("should reject unauthenticated /files/{filename}", async () => {
    const res = await app.request("/files/anything.pdf");
    expect(res.status).toBe(401);
  });

  it("should reject unauthenticated /files/img/{filename}", async () => {
    const res = await app.request("/files/img/anything.png");
    expect(res.status).toBe(401);
  });
```

- [ ] **Step 2.2: Run tests — they should pass immediately**

The auth middleware already returns 401 for these endpoints; if any return a different status, it's a real bug.

Run: `bun test --cwd packages/server src/auth.test.ts`
Expected: PASS — total tests in file goes from 7 → 14.

- [ ] **Step 2.3: Commit**

```bash
git add packages/server/src/auth.test.ts
git commit -m "test(server): BL-1 補齐 7 个未覆盖的未鉴权路径 401 测试"
```

---

## Task 3: BL-2 — fill cross-user 404 gaps

**Files:**
- Modify: `packages/server/src/tasks.test.ts`

- [ ] **Step 3.1: Locate insertion point**

Open `packages/server/src/tasks.test.ts`. Read the file structure. The describe blocks roughly are:
- POST /upload
- POST /api/parse
- POST /api/parse/sync
- GET /tasks
- GET /tasks/{id}
- PATCH /tasks/{id}
- DELETE /tasks/{id}
- POST /tasks/batch-delete
- POST /tasks/{id}/reprocess

Find the `describe("PATCH /tasks/{id}"…)` block and the `describe("POST /tasks/{id}/reprocess"…)` block.

- [ ] **Step 3.2: Add cross-user tests at the END of each describe block**

Inside `describe("PATCH /tasks/{id}"…)`, after the last existing `it(…)` and BEFORE the closing `});`:

```ts
    it("returns 404 when patching another user's task", async () => {
      // Register a second user and upload a task as them
      const otherEmail = `other-patch-${Date.now()}@example.com`;
      const signUp = await app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: otherEmail, password: "password123", name: otherEmail }),
      });
      const otherCookie =
        signUp.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;]+)/)?.[1] ?? "";

      const form = new FormData();
      form.append("file", new File(["other-user-payload"], "other.pdf", { type: "application/pdf" }));
      const upRes = await app.request("/upload", {
        method: "POST",
        body: form,
        headers: { Cookie: `better-auth.session_token=${otherCookie}` },
      });
      const { id: otherTaskId } = (await upRes.json()) as { id: string };

      // Original cookie (userCookie) tries to PATCH the other user's task
      const res = await app.request(`/tasks/${otherTaskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: `better-auth.session_token=${userCookie}` },
        body: JSON.stringify({ result_md: "hijacked" }),
      });
      expect(res.status).toBe(404);
    });
```

Inside `describe("POST /tasks/{id}/reprocess"…)`, after the last existing `it(…)` and BEFORE the closing `});`:

```ts
    it("returns 404 when reprocessing another user's task", async () => {
      const otherEmail = `other-reproc-${Date.now()}@example.com`;
      const signUp = await app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: otherEmail, password: "password123", name: otherEmail }),
      });
      const otherCookie =
        signUp.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;]+)/)?.[1] ?? "";

      const form = new FormData();
      form.append("file", new File(["other-user-payload"], "other-r.pdf", { type: "application/pdf" }));
      const upRes = await app.request("/upload", {
        method: "POST",
        body: form,
        headers: { Cookie: `better-auth.session_token=${otherCookie}` },
      });
      const { id: otherTaskId } = (await upRes.json()) as { id: string };

      const res = await app.request(`/tasks/${otherTaskId}/reprocess`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `better-auth.session_token=${userCookie}` },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
    });
```

Then add a new describe block at the end of the file (BEFORE the final `});` that closes the top-level describe), targeting `/files/{filename}` cross-user isolation:

```ts
  describe("GET /files/{filename} isolation", () => {
    it("cannot fetch another user's uploaded file", async () => {
      const otherEmail = `other-files-${Date.now()}@example.com`;
      const signUp = await app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: otherEmail, password: "password123", name: otherEmail }),
      });
      const otherCookie =
        signUp.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;]+)/)?.[1] ?? "";

      const form = new FormData();
      form.append("file", new File(["payload-files"], "files-iso.pdf", { type: "application/pdf" }));
      const upRes = await app.request("/upload", {
        method: "POST",
        body: form,
        headers: { Cookie: `better-auth.session_token=${otherCookie}` },
      });
      const { id: otherTaskId } = (await upRes.json()) as { id: string };

      const detailRes = await app.request(`/tasks/${otherTaskId}`, {
        headers: { Cookie: `better-auth.session_token=${otherCookie}` },
      });
      const { filename: otherFilename } = (await detailRes.json()) as { filename: string };

      const res = await app.request(`/files/${otherFilename}`, {
        headers: { Cookie: `better-auth.session_token=${userCookie}` },
      });
      expect(res.status).toBe(404);
    });
  });
```

> Note: `userCookie` is already defined in the file's top-level `beforeAll`. If not, look in the existing tests for how the cookie is named — it may be `cookie` or `sessionCookie`. Adapt the variable name to match.

- [ ] **Step 3.3: Run tests**

Run: `bun test --cwd packages/server src/tasks.test.ts`
Expected: PASS — 3 new tests added.

If the file-isolation test fails because the route returns 200 (real bug), STOP and report DONE_WITH_CONCERNS with the failure. Do NOT silently change the test to match buggy behavior.

- [ ] **Step 3.4: Commit**

```bash
git add packages/server/src/tasks.test.ts
git commit -m "test(server): BL-2 PATCH/reprocess/files 跨用户 404 覆盖"
```

---

## Task 4: BL-3 — invalid API key on /api/parse* endpoints

**Files:**
- Modify: `packages/server/src/apikeys.test.ts`

- [ ] **Step 4.1: Add tests**

Open `packages/server/src/apikeys.test.ts`. Locate `describe("API key bearer auth", …)` (around line 200). Inside it, after the existing `"rejects invalid API keys"` test, add:

```ts
    it("rejects invalid Bearer on /api/parse", async () => {
      const form = new FormData();
      form.append("file", new File(["x"], "x.pdf", { type: "application/pdf" }));
      const res = await app.request("/api/parse", {
        method: "POST",
        body: form,
        headers: { Authorization: "Bearer mk_invalid_key_value" },
      });
      expect(res.status).toBe(401);
    });

    it("rejects invalid Bearer on /api/parse/sync", async () => {
      const form = new FormData();
      form.append("file", new File(["x"], "x.pdf", { type: "application/pdf" }));
      const res = await app.request("/api/parse/sync", {
        method: "POST",
        body: form,
        headers: { Authorization: "Bearer mk_invalid_key_value" },
      });
      expect(res.status).toBe(401);
    });
```

- [ ] **Step 4.2: Run tests**

Run: `bun test --cwd packages/server src/apikeys.test.ts`
Expected: PASS — 2 new tests.

- [ ] **Step 4.3: Commit**

```bash
git add packages/server/src/apikeys.test.ts
git commit -m "test(server): BL-3 无效 Bearer 在 /api/parse* 返回 401"
```

---

## Task 5: BL-4 — revoked API key immediately rejected

**Files:**
- Modify: `packages/server/src/apikeys.test.ts`

- [ ] **Step 5.1: Add test**

Inside `describe("API key bearer auth", …)`, after the BL-3 tests just added, append:

```ts
    it("a revoked API key is rejected on subsequent requests", async () => {
      // Create a fresh key
      const { key } = await createKey(userACookie, "to-be-revoked");

      // Verify it works first
      const ok = await app.request("/tasks", {
        headers: { Authorization: `Bearer ${key}` },
      });
      expect(ok.status).toBe(200);

      // Find the key's id and revoke it
      const keys = await listKeys(userACookie);
      const target = keys.find((k) => k.name === "to-be-revoked");
      if (!target) throw new Error("Just-created key missing from list");
      const revokeRes = await app.request(`/api/api-keys/${target.id}`, {
        method: "DELETE",
        headers: authHeader(userACookie),
      });
      expect(revokeRes.status).toBe(200);

      // Same key should now be rejected
      const after = await app.request("/tasks", {
        headers: { Authorization: `Bearer ${key}` },
      });
      expect(after.status).toBe(401);
    });
```

- [ ] **Step 5.2: Run tests**

Run: `bun test --cwd packages/server src/apikeys.test.ts`
Expected: PASS — implementation in `apikey.ts:validateApiKey` already filters `revoked_at IS NULL`.

- [ ] **Step 5.3: Commit**

```bash
git add packages/server/src/apikeys.test.ts
git commit -m "test(server): BL-4 被撤销的 API Key 立即拒绝后续请求"
```

---

## Task 6: BL-5 — bad MIME on /api/parse* endpoints

**Files:**
- Modify: `packages/server/src/tasks.test.ts`

- [ ] **Step 6.1: Locate insertion point**

Open `packages/server/src/tasks.test.ts`. The existing `"rejects unsupported file types"` test lives in the `/upload` describe block (around line 77). The `/api/parse` describe block does NOT have this. Find it (the one whose path is `/api/parse`, not `/api/parse/sync`) and locate its closing `});`.

- [ ] **Step 6.2: Add tests to `/api/parse` describe block**

Inside `describe("POST /api/parse"…)`, after the existing `"returns 400 when no file is provided"` test, append:

```ts
    it("rejects unsupported file types on /api/parse", async () => {
      const form = new FormData();
      form.append("file", new File(["txt"], "x.exe", { type: "application/octet-stream" }));
      const res = await app.request("/api/parse", {
        method: "POST",
        body: form,
        headers: { Cookie: `better-auth.session_token=${userCookie}` },
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Unsupported file type");
    });
```

Inside `describe("POST /api/parse/sync"…)`, after its existing `"returns 400 when no file is provided"`, append:

```ts
    it("rejects unsupported file types on /api/parse/sync", async () => {
      const form = new FormData();
      form.append("file", new File(["txt"], "x.exe", { type: "application/octet-stream" }));
      const res = await app.request("/api/parse/sync", {
        method: "POST",
        body: form,
        headers: { Cookie: `better-auth.session_token=${userCookie}` },
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Unsupported file type");
    });
```

- [ ] **Step 6.3: Run tests**

Run: `bun test --cwd packages/server src/tasks.test.ts`
Expected: PASS — `readUploadFile` already throws `"Unsupported file type: <ext>"` (helpers.ts:61).

- [ ] **Step 6.4: Commit**

```bash
git add packages/server/src/tasks.test.ts
git commit -m "test(server): BL-5 /api/parse* 拒绝非白名单 MIME"
```

---

## Task 7: BL-8 — malformed UUID returns 400 (Zod validation)

**Files:**
- Modify: `packages/server/src/tasks.test.ts`

- [ ] **Step 7.1: Add test**

Inside `describe("GET /tasks/{id}"…)`, after the existing `"returns 404 for non-existent task"`, append:

```ts
    it("returns 400 for malformed (non-UUID) id", async () => {
      const res = await app.request("/tasks/not-a-uuid", {
        headers: { Cookie: `better-auth.session_token=${userCookie}` },
      });
      expect(res.status).toBe(400);
    });
```

- [ ] **Step 7.2: Run tests**

Run: `bun test --cwd packages/server src/tasks.test.ts`
Expected: PASS — Zod's `z.string().uuid()` schema on the route's `params` rejects non-UUIDs with 400.

If the test fails with 404 instead of 400, the project's OpenAPIHono setup is not validating path params — STOP and report DONE_WITH_CONCERNS with the actual response status. Don't soften the assertion.

- [ ] **Step 7.3: Commit**

```bash
git add packages/server/src/tasks.test.ts
git commit -m "test(server): BL-8 非 UUID 格式的 task id 返回 400"
```

---

## Task 8: BL-11 — mineru upstream failure marks task as failed

**Files:**
- Create: `packages/server/src/mineru-failure.test.ts`

- [ ] **Step 8.1: Create the isolated test file**

Create `packages/server/src/mineru-failure.test.ts` with the following content:

```ts
import { beforeAll, describe, expect, it } from "bun:test";
import type { Hono } from "hono";

// Point MineRU to a closed loopback port BEFORE any module import that
// captures the env. `mineru.ts` reads `process.env.MINERU_URL` at module
// load and stores it in `DEFAULT_MINERU_URL`.
process.env.MINERU_URL = "http://127.0.0.1:1";

describe("MineRU upstream failure → task failed", () => {
  let app: Hono;
  let cookie: string;

  beforeAll(async () => {
    const mod = await import("../index.ts");
    app = mod.app;

    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `mineru-fail-${Date.now()}@example.com`,
        password: "password123",
        name: "mineru-fail",
      }),
    });
    cookie =
      res.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;]+)/)?.[1] ?? "";
  });

  it("marks the task as failed when upstream fetch errors", async () => {
    const form = new FormData();
    form.append(
      "file",
      new File(["uniq-payload-for-failure-test"], "fail.pdf", { type: "application/pdf" }),
    );

    const upload = await app.request("/upload", {
      method: "POST",
      body: form,
      headers: { Cookie: `better-auth.session_token=${cookie}` },
    });
    expect(upload.status).toBe(200);
    const { id } = (await upload.json()) as { id: string };

    // Poll: connection refused fails fast (~ms). Allow up to 5 s.
    const deadline = Date.now() + 5000;
    let status = "pending";
    let detail: { status: string; error?: string | null } | null = null;
    while (Date.now() < deadline && status !== "failed" && status !== "completed") {
      await new Promise((r) => setTimeout(r, 100));
      const res = await app.request(`/tasks/${id}`, {
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      if (res.status !== 200) continue;
      detail = (await res.json()) as { status: string; error?: string | null };
      status = detail.status;
    }

    expect(status).toBe("failed");
    expect(detail?.error).toBeTruthy();
  });
});
```

- [ ] **Step 8.2: Run the file**

Run: `bun test --cwd packages/server src/mineru-failure.test.ts`
Expected: PASS within ~5 seconds.

If the test times out at 5 s with status still `pending`, the upstream fetch may have a longer timeout. Increase the poll deadline to 30 s and re-run. If it still hangs, STOP and report DONE_WITH_CONCERNS — the abort signals in `mineru.ts` may not be firing on connection-refused.

- [ ] **Step 8.3: Verify full suite still passes**

The test file in its own worker should NOT pollute `MINERU_URL` for other workers, but verify by running the full suite:

Run: `bun test --cwd packages/server`
Expected: all server tests pass.

- [ ] **Step 8.4: Commit**

```bash
git add packages/server/src/mineru-failure.test.ts
git commit -m "test(server): BL-11 MineRU 上游故障时任务标记 failed"
```

---

## Task 9: BL-12 — duplicate email registration rejected

**Files:**
- Modify: `packages/server/src/auth.test.ts`

- [ ] **Step 9.1: Add test**

Open `packages/server/src/auth.test.ts`. After the last existing test in the file (the "should support API Key authentication" test), append BEFORE the closing `});`:

```ts
  it("rejects duplicate email on sign-up", async () => {
    const email = `dup-${Date.now()}@example.com`;
    const first = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123", name: email }),
    });
    expect(first.status).toBe(200);

    const second = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123", name: email }),
    });
    // better-auth returns a 4xx for duplicate user. Accept any 4xx.
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(second.status).toBeLessThan(500);
  });
```

- [ ] **Step 9.2: Run tests**

Run: `bun test --cwd packages/server src/auth.test.ts`
Expected: PASS.

- [ ] **Step 9.3: Commit**

```bash
git add packages/server/src/auth.test.ts
git commit -m "test(server): BL-12 重复 email 注册返回 4xx"
```

---

## Task 10: BL-13 — sign-out invalidates session cookie

**Files:**
- Modify: `packages/server/src/auth.test.ts`

- [ ] **Step 10.1: Add test**

Open `packages/server/src/auth.test.ts`. Append after the BL-12 test from Task 9:

```ts
  it("session cookie is rejected after sign-out", async () => {
    const email = `signout-${Date.now()}@example.com`;

    const signUp = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123", name: email }),
    });
    const cookie =
      signUp.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;]+)/)?.[1] ?? "";
    expect(cookie).toBeTruthy();

    // Verify cookie works
    const before = await app.request("/tasks", {
      headers: { Cookie: `better-auth.session_token=${cookie}` },
    });
    expect(before.status).toBe(200);

    // Sign out
    const out = await app.request("/api/auth/sign-out", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `better-auth.session_token=${cookie}`,
      },
    });
    expect([200, 204]).toContain(out.status);

    // Same cookie should now be rejected
    const after = await app.request("/tasks", {
      headers: { Cookie: `better-auth.session_token=${cookie}` },
    });
    expect(after.status).toBe(401);
  });
```

- [ ] **Step 10.2: Run tests**

Run: `bun test --cwd packages/server src/auth.test.ts`
Expected: PASS.

If `/api/auth/sign-out` returns something other than 200/204, check better-auth docs for the exact route name and adapt the URL (e.g. `/api/auth/sign-out/email` or `/api/auth/signout`). The plan picks `/api/auth/sign-out` which is the better-auth default.

- [ ] **Step 10.3: Commit**

```bash
git add packages/server/src/auth.test.ts
git commit -m "test(server): BL-13 登出后 session cookie 被拒绝"
```

---

## Task 11: Final suite verification

**Files:** None.

- [ ] **Step 11.1: Run typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 11.2: Run full test suite**

Run: `bun run test`
Expected: ALL tests pass. Server test count should rise from 76 → ~95 (audit shows ~19 new tests across BL-1…BL-13 minus 6, 7, 9, 10). Web tests remain at 12.

- [ ] **Step 11.3: Update audit doc with execution results**

Open `docs/superpowers/test-audit.md`. At the bottom, append:

```markdown

## Phase 2 Execution Summary (2026-06-08)

| BL | Status | New tests | Commit |
|---|---|---|---|
| BL-1 | Closed | 7 (auth.test.ts) | T2 |
| BL-2 | Closed | 3 (tasks.test.ts) | T3 |
| BL-3 | Closed | 2 (apikeys.test.ts) | T4 |
| BL-4 | Closed | 1 (apikeys.test.ts) | T5 |
| BL-5 | Closed | 2 (tasks.test.ts) | T6 |
| BL-8 | Closed | 1 (tasks.test.ts) | T7 |
| BL-11 | Closed | 1 (mineru-failure.test.ts, new file) | T8 |
| BL-12 | Closed | 1 (auth.test.ts) | T9 |
| BL-13 | Closed | 1 (auth.test.ts) | T10 |
| BL-6 | Deferred — product gap (no size limit). Filed as follow-up. |
| BL-10 | Deferred — error shape sweep low value. |

**Total:** 19 new tests across 4 test files. Suite size: 76 → ~95 server, 12 web.
```

- [ ] **Step 11.4: Commit**

```bash
git add docs/superpowers/test-audit.md
git commit -m "docs: Phase 2 执行汇总写入审计报告"
```

---

## Phase 2 Completion Criteria

- [ ] All 11 tasks committed
- [ ] `bun run typecheck && bun run test` all green
- [ ] `docs/superpowers/test-audit.md` reflects executed coverage and notes any deferred items as known product gaps
- [ ] No production code changed (or, if any tests surfaced real bugs, they're documented separately — don't silently patch them in Phase 2)

## Self-Review Checklist (already performed)

- ✅ **Spec coverage:** spec §5.3 BL items mapped to tasks; deferrals (BL-6, BL-10) justified in audit
- ✅ **No placeholders:** every test step has complete test code; no "similar to X" references
- ✅ **Type consistency:** variable names in plan (`userCookie`, `userACookie`, etc.) reference the existing fixtures in each test file; implementer reads the file before editing to confirm names

## What Phase 2 does NOT cover

- Phase 3 visual polish (4 sub-PRs) — separate plans
- Frontend testing — out of scope for Phase 2
- Product-side fix for BL-6 (size limit) and `/files/{filename}` NULL user_id fallback — flagged in audit, filed separately
