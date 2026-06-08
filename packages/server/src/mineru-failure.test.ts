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
    cookie = res.headers.get("set-cookie")?.match(/better-auth\.session_token=([^;]+)/)?.[1] ?? "";
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
