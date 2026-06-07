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
});
