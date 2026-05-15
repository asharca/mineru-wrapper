import { beforeAll, describe, expect, it } from "bun:test";
import type { Hono } from "hono";

// DB_PATH, UPLOAD_DIR, and initial cleanup are handled by test-preload.ts

describe("API Keys", () => {
  let app: Hono;
  let userACookie: string;
  let userBCookie: string;

  beforeAll(async () => {
    const mod = await import("../index.ts");
    app = mod.default;

    async function register(email: string): Promise<string> {
      const res = await app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "password123", name: email }),
      });
      const setCookie = res.headers.get("set-cookie") ?? "";
      return setCookie.match(/better-auth\.session_token=([^;]+)/)?.[1] ?? "";
    }

    userACookie = await register("keyuser-a@test.example");
    userBCookie = await register("keyuser-b@test.example");
  });

  function authHeader(c: string) {
    return { Cookie: `better-auth.session_token=${c}` };
  }

  async function createKey(cookie: string, name: string): Promise<{ key: string; prefix: string }> {
    const res = await app.request("/api/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader(cookie) },
      body: JSON.stringify({ name }),
    });
    return res.json() as Promise<{ key: string; prefix: string }>;
  }

  async function listKeys(
    cookie: string,
  ): Promise<{ id: string; name: string; key_prefix: string }[]> {
    const res = await app.request("/api/api-keys", { headers: authHeader(cookie) });
    return res.json() as Promise<{ id: string; name: string; key_prefix: string }[]>;
  }

  // ── GET /api/api-keys ─────────────────────────────────────────────────────

  describe("GET /api/api-keys", () => {
    it("returns empty list when user has no keys", async () => {
      const res = await app.request("/api/api-keys", { headers: authHeader(userACookie) });
      expect(res.status).toBe(200);
      const body = (await res.json()) as unknown[];
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(0);
    });

    it("returns 401 when unauthenticated", async () => {
      const res = await app.request("/api/api-keys");
      expect(res.status).toBe(401);
    });
  });

  // ── POST /api/api-keys ────────────────────────────────────────────────────

  describe("POST /api/api-keys", () => {
    it("creates a key and returns full key + prefix", async () => {
      const res = await app.request("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader(userACookie) },
        body: JSON.stringify({ name: "my-key" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { key: string; prefix: string };
      expect(body.key).toStartWith("mk_");
      expect(body.prefix).toContain("...");
    });

    it("creates a key without a name", async () => {
      const res = await app.request("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader(userACookie) },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { key: string };
      expect(body.key).toBeTruthy();
    });

    it("returns 401 when unauthenticated", async () => {
      const res = await app.request("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test" }),
      });
      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/api-keys (after creation) ────────────────────────────────────

  describe("GET /api/api-keys after creation", () => {
    it("lists all keys for the user", async () => {
      const keys = await listKeys(userACookie);
      expect(keys.some((k) => k.name === "my-key")).toBe(true);
    });

    it("does not include full key value (only prefix)", async () => {
      const keys = await listKeys(userACookie);
      for (const k of keys) {
        expect(k).not.toHaveProperty("key");
        expect(k.key_prefix).toContain("...");
      }
    });

    it("does not expose another user's keys", async () => {
      const keys = await listKeys(userBCookie);
      expect(keys.length).toBe(0);
    });
  });

  // ── DELETE /api/api-keys/:id ──────────────────────────────────────────────

  describe("DELETE /api/api-keys/:id", () => {
    it("revokes an existing key", async () => {
      await createKey(userACookie, "to-revoke");
      const keys = await listKeys(userACookie);
      const target = keys.find((k) => k.name === "to-revoke")!;

      const res = await app.request(`/api/api-keys/${target.id}`, {
        method: "DELETE",
        headers: authHeader(userACookie),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { message: string };
      expect(body.message).toBe("Revoked");
    });

    it("revoked key no longer appears in list", async () => {
      await createKey(userACookie, "disappear");
      const before = await listKeys(userACookie);
      const target = before.find((k) => k.name === "disappear")!;

      await app.request(`/api/api-keys/${target.id}`, {
        method: "DELETE",
        headers: authHeader(userACookie),
      });

      const after = await listKeys(userACookie);
      expect(after.some((k) => k.id === target.id)).toBe(false);
    });

    it("returns 404 for a non-existent key id", async () => {
      const res = await app.request("/api/api-keys/00000000-0000-0000-0000-000000000000", {
        method: "DELETE",
        headers: authHeader(userACookie),
      });
      expect(res.status).toBe(404);
    });

    it("revoking an already-revoked key is idempotent (returns 200)", async () => {
      // Current API behavior: UPDATE runs unconditionally, so a second revoke
      // updates revoked_at again and returns 200. This is intentional idempotency.
      await createKey(userACookie, "double-revoke");
      const keys = await listKeys(userACookie);
      const target = keys.find((k) => k.name === "double-revoke")!;

      await app.request(`/api/api-keys/${target.id}`, {
        method: "DELETE",
        headers: authHeader(userACookie),
      });
      const res = await app.request(`/api/api-keys/${target.id}`, {
        method: "DELETE",
        headers: authHeader(userACookie),
      });
      expect(res.status).toBe(200);
    });

    it("cannot revoke another user's key", async () => {
      await createKey(userACookie, "user-a-private");
      const keys = await listKeys(userACookie);
      const target = keys.find((k) => k.name === "user-a-private")!;

      const res = await app.request(`/api/api-keys/${target.id}`, {
        method: "DELETE",
        headers: authHeader(userBCookie),
      });
      expect(res.status).toBe(404);
    });

    it("returns 401 when unauthenticated", async () => {
      const res = await app.request("/api/api-keys/some-id", { method: "DELETE" });
      expect(res.status).toBe(401);
    });
  });

  // ── API key authentication ─────────────────────────────────────────────────

  describe("API key bearer auth", () => {
    it("can authenticate requests using an API key", async () => {
      const { key } = await createKey(userACookie, "bearer-test");
      const res = await app.request("/tasks", {
        headers: { Authorization: `Bearer ${key}` },
      });
      expect(res.status).toBe(200);
    });

    it("rejects invalid API keys", async () => {
      const res = await app.request("/tasks", {
        headers: { Authorization: "Bearer mk_invalid_key_value" },
      });
      expect(res.status).toBe(401);
    });

    it("API key only sees its owner's tasks", async () => {
      const { key } = await createKey(userBCookie, "isolation-test");
      const res = await app.request("/tasks", {
        headers: { Authorization: `Bearer ${key}` },
      });
      expect(res.status).toBe(200);
      const { tasks } = (await res.json()) as { tasks: unknown[] };
      // userB has no tasks - should return empty list, not userA's tasks
      expect(tasks.length).toBe(0);
    });
  });
});
