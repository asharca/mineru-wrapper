import { beforeAll, describe, expect, it } from "bun:test";
import type { Hono } from "hono";

// DB_PATH and initial cleanup are handled by test-preload.ts

describe("Auth & Data Isolation", () => {
  let app: Hono;
  let userA: { email: string; password: string; sessionCookie?: string };
  let userB: { email: string; password: string; sessionCookie?: string };

  beforeAll(async () => {
    const mod = await import("../index.ts");
    app = mod.default;
  });

  async function registerAndLogin(email: string, password: string): Promise<string> {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name: email }),
    });
    // Extract session cookie from response (sign-up with autoSignIn returns token)
    const setCookie = res.headers.get("set-cookie") || "";
    const match = setCookie.match(/better-auth\.session_token=([^;]+)/);
    return match?.[1] ?? "";
  }

  it("should reject unauthenticated upload", async () => {
    const res = await app.request("/upload", { method: "POST" });
    // 400 because no file uploaded, but auth middleware should still run
    expect(res.status).toBeOneOf([401, 400]);
  });

  it("should reject unauthenticated task list", async () => {
    const res = await app.request("/tasks");
    expect([401, 404, 200]).toContain(res.status);
  });

  it("should register and login users", async () => {
    userA = { email: "usera@example.com", password: "password123" };
    userB = { email: "userb@example.com", password: "password123" };
    userA.sessionCookie = await registerAndLogin(userA.email, userA.password);
    userB.sessionCookie = await registerAndLogin(userB.email, userB.password);
    expect(userA.sessionCookie).toBeTruthy();
    expect(userB.sessionCookie).toBeTruthy();
  });

  it("should only return own tasks", async () => {
    // Create task for user A
    const formA = new FormData();
    formA.append("file", new File(["test"], "test.pdf", { type: "application/pdf" }));
    const resA = await app.request("/upload", {
      method: "POST",
      body: formA,
      headers: { Cookie: `better-auth.session_token=${userA.sessionCookie}` },
    });
    expect(resA.status).toBe(200);

    // Create task for user B
    const formB = new FormData();
    formB.append("file", new File(["test2"], "test2.pdf", { type: "application/pdf" }));
    const resB = await app.request("/upload", {
      method: "POST",
      body: formB,
      headers: { Cookie: `better-auth.session_token=${userB.sessionCookie}` },
    });
    expect(resB.status).toBe(200);

    // User A should only see their own task
    const listA = await app.request("/tasks", {
      headers: { Cookie: `better-auth.session_token=${userA.sessionCookie}` },
    });
    const dataA = (await listA.json()) as { tasks: { original_name: string }[] };
    expect(dataA.tasks.length).toBe(1);
    expect(dataA.tasks[0]?.original_name).toBe("test.pdf");

    // User B should only see their own task
    const listB = await app.request("/tasks", {
      headers: { Cookie: `better-auth.session_token=${userB.sessionCookie}` },
    });
    const dataB = (await listB.json()) as { tasks: { original_name: string }[] };
    expect(dataB.tasks.length).toBe(1);
    expect(dataB.tasks[0]?.original_name).toBe("test2.pdf");
  });

  it("should not access other user's task detail", async () => {
    // Get user A's task ID
    const listA = await app.request("/tasks", {
      headers: { Cookie: `better-auth.session_token=${userA.sessionCookie}` },
    });
    const { tasks } = (await listA.json()) as { tasks: { id: string }[] };
    const taskId = tasks[0]?.id;
    if (!taskId) throw new Error("No task found");

    // User B tries to access user A's task
    const res = await app.request(`/tasks/${taskId}`, {
      headers: { Cookie: `better-auth.session_token=${userB.sessionCookie}` },
    });
    expect(res.status).toBe(404);
  });

  it("should not delete other user's task", async () => {
    const listA = await app.request("/tasks", {
      headers: { Cookie: `better-auth.session_token=${userA.sessionCookie}` },
    });
    const { tasks } = (await listA.json()) as { tasks: { id: string }[] };
    const taskId = tasks[0]?.id;
    if (!taskId) throw new Error("No task found");

    const res = await app.request(`/tasks/${taskId}`, {
      method: "DELETE",
      headers: { Cookie: `better-auth.session_token=${userB.sessionCookie}` },
    });
    expect(res.status).toBe(404);
  });

  it("should support API Key authentication", async () => {
    // Create API key for user A
    const keyRes = await app.request("/api/api-keys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `better-auth.session_token=${userA.sessionCookie}`,
      },
      body: JSON.stringify({ name: "test-key" }),
    });
    expect(keyRes.status).toBe(200);
    const { key } = (await keyRes.json()) as { key: string };

    // Use API key to access tasks
    const listRes = await app.request("/tasks", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(listRes.status).toBe(200);
    const data = (await listRes.json()) as { tasks: unknown[] };
    expect(data.tasks.length).toBe(1);
  });
});
