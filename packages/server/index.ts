import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import routes from "./src/routes.ts";

const PORT = Number(process.env.PORT) || 3001;

const app = new Hono();
app.use("*", cors());
app.route("/", routes);

// Serve frontend static files in production
app.use("/*", serveStatic({ root: "../web/dist" }));
app.get("/*", serveStatic({ root: "../web/dist", path: "index.html" }));

console.log(`OCR Server running at http://0.0.0.0:${PORT}`);
console.log(`MineRU endpoint: ${process.env.MINERU_URL || "http://10.0.10.2:8001"}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
