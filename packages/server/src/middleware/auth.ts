import { createMiddleware } from "hono/factory";
import { validateApiKey } from "../apikey.ts";
import { auth } from "../auth.ts";

export const authMiddleware = createMiddleware(async (c, next) => {
  // 1. Try better-auth session (cookie-based)
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session) {
      c.set("user", session.user);
      c.set("session", session.session);
      await next();
      return;
    }
  } catch {
    // Session lookup failed, continue to API key fallback
  }

  // 2. Fallback to API Key
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const apiKey = authHeader.slice(7);
    const user = await validateApiKey(apiKey);
    if (user) {
      c.set("user", user);
      await next();
      return;
    }
  }

  return c.json({ error: "Unauthorized" }, 401);
});
