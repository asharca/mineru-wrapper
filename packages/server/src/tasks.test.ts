import { beforeAll, describe, expect, it } from "bun:test";
import type { Hono } from "hono";
import type { stmt as StmtType } from "./db.ts";

// DB_PATH, UPLOAD_DIR, and initial cleanup are handled by test-preload.ts

describe("Upload & Tasks API", () => {
  let app: Hono;
  let cookie: string;
  let stmt: typeof StmtType;

  beforeAll(async () => {
    const mod = await import("../index.ts");
    app = mod.app;
    stmt = (await import("./db.ts")).stmt;

    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "tasks-user@test.example",
        password: "password123",
        name: "Tasks User",
      }),
    });
    const setCookie = res.headers.get("set-cookie") ?? "";
    cookie = setCookie.match(/better-auth\.session_token=([^;]+)/)?.[1] ?? "";
  });

  async function upload(name = "test.pdf", content = "pdf-content"): Promise<string> {
    const form = new FormData();
    form.append("file", new File([content], name, { type: "application/pdf" }));
    const res = await app.request("/upload", {
      method: "POST",
      body: form,
      headers: { Cookie: `better-auth.session_token=${cookie}` },
    });
    const { id } = (await res.json()) as { id: string };
    return id;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  describe("POST /api/auth/sign-in/email", () => {
    it("signs in with valid credentials", async () => {
      const res = await app.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "tasks-user@test.example", password: "password123" }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toContain("better-auth.session_token");
    });

    it("rejects wrong password", async () => {
      const res = await app.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "tasks-user@test.example", password: "wrong" }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ── POST /upload ──────────────────────────────────────────────────────────

  describe("POST /upload", () => {
    it("returns 400 when no file is provided", async () => {
      const res = await app.request("/upload", {
        method: "POST",
        body: new FormData(),
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      expect(res.status).toBe(400);
    });

    it("rejects unsupported file types", async () => {
      const form = new FormData();
      form.append("file", new File(["text"], "document.txt", { type: "text/plain" }));
      const res = await app.request("/upload", {
        method: "POST",
        body: form,
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("returns pending task for a valid PDF", async () => {
      const form = new FormData();
      form.append("file", new File(["pdf"], "valid.pdf", { type: "application/pdf" }));
      const res = await app.request("/upload", {
        method: "POST",
        body: form,
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; status: string };
      expect(body.status).toBe("pending");
      expect(body.id).toBeTruthy();
    });

    it("returns cached result for duplicate file content", async () => {
      const content = `unique-content-${Math.random()}`;
      const firstId = await upload("original.pdf", content);

      // External OCR service unavailable in tests — manually mark the task completed
      // so findByHash (which filters status='completed') can find it as a cache hit.
      stmt.setResult.run({
        $id: firstId,
        $result_md: "# Cached Result",
        $content_list: JSON.stringify([]),
        $pages: JSON.stringify([]),
      });

      const form = new FormData();
      form.append("file", new File([content], "copy.pdf", { type: "application/pdf" }));
      const res = await app.request("/upload", {
        method: "POST",
        body: form,
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; message: string };
      expect(body.message).toContain("cached");
    });
  });

  // ── POST /api/parse ───────────────────────────────────────────────────────

  describe("POST /api/parse", () => {
    it("returns 400 when no file is provided", async () => {
      const res = await app.request("/api/parse", {
        method: "POST",
        body: new FormData(),
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      expect(res.status).toBe(400);
    });

    it("creates a pending task with source=api", async () => {
      const form = new FormData();
      form.append("file", new File(["pdf"], "api.pdf", { type: "application/pdf" }));
      const res = await app.request("/api/parse", {
        method: "POST",
        body: form,
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; status: string };
      expect(body.status).toBe("pending");
      expect(body.id).toBeTruthy();
    });

    it("records source as api (not web)", async () => {
      const form = new FormData();
      form.append("file", new File(["pdf-api-src"], "api-src.pdf", { type: "application/pdf" }));
      const res = await app.request("/api/parse", {
        method: "POST",
        body: form,
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      const { id } = (await res.json()) as { id: string };

      const taskRes = await app.request(`/tasks/${id}`, {
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      const task = (await taskRes.json()) as { source: string };
      expect(task.source).toBe("api");
    });
  });

  // ── POST /api/parse/sync ──────────────────────────────────────────────────

  describe("POST /api/parse/sync", () => {
    it("returns 400 when no file is provided", async () => {
      const res = await app.request("/api/parse/sync", {
        method: "POST",
        body: new FormData(),
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      expect(res.status).toBe(400);
    });
  });

  // ── GET /tasks ────────────────────────────────────────────────────────────

  describe("GET /tasks", () => {
    it("returns task list with pagination metadata", async () => {
      const res = await app.request("/tasks", {
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        tasks: unknown[];
        pagination: { page: number; limit: number; total: number; pages: number };
      };
      expect(Array.isArray(body.tasks)).toBe(true);
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.limit).toBeGreaterThan(0);
    });

    it("shows newly uploaded task in list", async () => {
      const id = await upload("list-test.pdf");
      const res = await app.request("/tasks", {
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      const { tasks } = (await res.json()) as { tasks: { id: string }[] };
      expect(tasks.some((t) => t.id === id)).toBe(true);
    });

    it("respects limit parameter", async () => {
      const res = await app.request("/tasks?limit=2", {
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      const body = (await res.json()) as { tasks: unknown[]; pagination: { limit: number } };
      expect(body.tasks.length).toBeLessThanOrEqual(2);
      expect(body.pagination.limit).toBe(2);
    });

    it("filters by source=web", async () => {
      const res = await app.request("/tasks?source=web", {
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      const { tasks } = (await res.json()) as { tasks: { source: string }[] };
      expect(tasks.every((t) => t.source === "web")).toBe(true);
    });

    it("filters by source=api", async () => {
      const res = await app.request("/tasks?source=api", {
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      const { tasks } = (await res.json()) as { tasks: { source: string }[] };
      expect(tasks.every((t) => t.source === "api")).toBe(true);
    });

    it("returns matching tasks for search query", async () => {
      await upload("findme-unique.pdf");
      const res = await app.request("/tasks?search=findme-unique", {
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      expect(res.status).toBe(200);
      const { tasks } = (await res.json()) as { tasks: { original_name: string }[] };
      expect(tasks.some((t) => t.original_name.includes("findme-unique"))).toBe(true);
    });

    it("returns snippet field when searching", async () => {
      await upload("snippet-test.pdf");
      const res = await app.request("/tasks?search=snippet-test", {
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      const { tasks } = (await res.json()) as { tasks: { snippet: unknown }[] };
      // snippet key is present (may be null if FTS index not yet populated)
      expect(tasks[0]).toHaveProperty("snippet");
    });
  });

  // ── GET /tasks/:id ────────────────────────────────────────────────────────

  describe("GET /tasks/:id", () => {
    it("returns full task detail", async () => {
      const id = await upload("detail.pdf");
      const res = await app.request(`/tasks/${id}`, {
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      expect(res.status).toBe(200);
      const task = (await res.json()) as {
        id: string;
        original_name: string;
        status: string;
        source: string;
      };
      expect(task.id).toBe(id);
      expect(task.original_name).toBe("detail.pdf");
      expect(task.source).toBe("web");
    });

    it("returns 404 for non-existent task", async () => {
      const res = await app.request("/tasks/00000000-0000-0000-0000-000000000000", {
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      expect(res.status).toBe(404);
    });
  });

  // ── PATCH /tasks/:id ──────────────────────────────────────────────────────

  describe("PATCH /tasks/:id", () => {
    it("updates result_md", async () => {
      const id = await upload("patch-md.pdf");
      const res = await app.request(`/tasks/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: `better-auth.session_token=${cookie}`,
        },
        body: JSON.stringify({ result_md: "# Updated Markdown" }),
      });
      expect(res.status).toBe(200);
      const task = (await res.json()) as { result_md: string };
      expect(task.result_md).toBe("# Updated Markdown");
    });

    it("updates content_list", async () => {
      const id = await upload("patch-cl.pdf");
      const block = {
        type: "text",
        bbox: [0, 0, 100, 20] as [number, number, number, number],
        text: "hello",
      };
      const res = await app.request(`/tasks/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: `better-auth.session_token=${cookie}`,
        },
        body: JSON.stringify({ content_list: [block] }),
      });
      expect(res.status).toBe(200);
      const task = (await res.json()) as { content_list: (typeof block)[] };
      expect(task.content_list).toHaveLength(1);
      expect(task.content_list[0]?.text).toBe("hello");
    });

    it("preserves existing fields when partially updating", async () => {
      const id = await upload("patch-partial.pdf");

      await app.request(`/tasks/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: `better-auth.session_token=${cookie}`,
        },
        body: JSON.stringify({ result_md: "original" }),
      });

      const res = await app.request(`/tasks/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: `better-auth.session_token=${cookie}`,
        },
        body: JSON.stringify({ content_list: [{ type: "text", bbox: [0, 0, 1, 1], text: "a" }] }),
      });
      const task = (await res.json()) as { result_md: string; content_list: unknown[] };
      expect(task.result_md).toBe("original");
      expect(task.content_list).toHaveLength(1);
    });

    it("returns 404 for non-existent task", async () => {
      const res = await app.request("/tasks/00000000-0000-0000-0000-000000000000", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: `better-auth.session_token=${cookie}`,
        },
        body: JSON.stringify({ result_md: "text" }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ── DELETE /tasks/:id ─────────────────────────────────────────────────────

  describe("DELETE /tasks/:id", () => {
    it("deletes the task and returns confirmation", async () => {
      const id = await upload("delete-me.pdf");
      const res = await app.request(`/tasks/${id}`, {
        method: "DELETE",
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { message: string };
      expect(body.message).toBe("Deleted");
    });

    it("task is no longer accessible after deletion", async () => {
      const id = await upload("gone.pdf");
      await app.request(`/tasks/${id}`, {
        method: "DELETE",
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      const res = await app.request(`/tasks/${id}`, {
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 for non-existent task", async () => {
      const res = await app.request("/tasks/00000000-0000-0000-0000-000000000000", {
        method: "DELETE",
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      expect(res.status).toBe(404);
    });
  });

  // ── POST /tasks/batch-delete ──────────────────────────────────────────────

  describe("POST /tasks/batch-delete", () => {
    it("deletes multiple tasks and returns count", async () => {
      const id1 = await upload("batch-a.pdf", "batch-content-a");
      const id2 = await upload("batch-b.pdf", "batch-content-b");
      const res = await app.request("/tasks/batch-delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `better-auth.session_token=${cookie}`,
        },
        body: JSON.stringify({ ids: [id1, id2] }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { deleted: number };
      expect(body.deleted).toBe(2);
    });

    it("deleted tasks are no longer accessible", async () => {
      const id = await upload("batch-gone.pdf", "batch-content-gone");
      await app.request("/tasks/batch-delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `better-auth.session_token=${cookie}`,
        },
        body: JSON.stringify({ ids: [id] }),
      });
      const res = await app.request(`/tasks/${id}`, {
        headers: { Cookie: `better-auth.session_token=${cookie}` },
      });
      expect(res.status).toBe(404);
    });

    it("returns 400 for empty ids array", async () => {
      const res = await app.request("/tasks/batch-delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `better-auth.session_token=${cookie}`,
        },
        body: JSON.stringify({ ids: [] }),
      });
      expect(res.status).toBe(400);
    });

    it("silently ignores non-existent ids", async () => {
      const id = await upload("batch-real.pdf", "batch-content-real");
      const res = await app.request("/tasks/batch-delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `better-auth.session_token=${cookie}`,
        },
        body: JSON.stringify({ ids: [id, "00000000-0000-0000-0000-000000000000"] }),
      });
      expect(res.status).toBe(200);
    });
  });

  // ── POST /tasks/:id/reprocess ─────────────────────────────────────────────

  describe("POST /tasks/:id/reprocess", () => {
    it("starts reprocessing and returns pending status", async () => {
      const id = await upload("reprocess.pdf");
      const res = await app.request(`/tasks/${id}/reprocess`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `better-auth.session_token=${cookie}`,
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; status: string; message: string };
      expect(body.id).toBe(id);
      expect(["pending", "processing"]).toContain(body.status);
      expect(body.message).toBeTruthy();
    });

    it("returns 404 for non-existent task", async () => {
      const res = await app.request("/tasks/00000000-0000-0000-0000-000000000000/reprocess", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `better-auth.session_token=${cookie}`,
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
    });
  });
});
