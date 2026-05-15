import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { auth } from "./src/auth.ts";
import { authMiddleware } from "./src/middleware/index.ts";
import routes from "./src/routes/index.ts";

const PORT = Number(process.env.PORT) || 3001;

const app = new Hono();
app.use("*", cors({ origin: process.env.CORS_ORIGIN || "*", credentials: true }));

// Public routes (no auth required)
app.get("/api/health", (c) => c.json({ status: "ok" }));
app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

// Apply auth middleware to protected routes BEFORE registering them
app.use("/upload", authMiddleware);
app.use("/api/parse", authMiddleware);
app.use("/api/parse/sync", authMiddleware);
app.use("/tasks/*", authMiddleware);
app.use("/files/*", authMiddleware);
app.use("/api/api-keys/*", authMiddleware);

// Protected API routes (auth middleware already applied above)
app.route("/", routes);

// Serve frontend static files in production
const webDistPath = process.env.WEB_DIST_PATH || "./packages/web/dist";
app.use("/*", serveStatic({ root: webDistPath }));
app.get("/*", serveStatic({ root: webDistPath, rewriteRequestPath: () => "/index.html" }));

if (import.meta.main) {
  console.log(`OCR Server running at http://0.0.0.0:${PORT}`);
  console.log(`MineRU endpoint: ${process.env.MINERU_URL || "http://10.0.10.2:8001"}`);

  Bun.serve({
    port: PORT,
    fetch: app.fetch,
  });
}

export { app };
