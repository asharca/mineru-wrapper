import { OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { apiKeysApp } from "./apikeys.ts";
import { tasksApp } from "./tasks.ts";
import { uploadApp } from "./upload.ts";

const app = new OpenAPIHono();

app.route("/", uploadApp);
app.route("/", tasksApp);
app.route("/", apiKeysApp);

app.doc("/api/openapi", {
  openapi: "3.0.0",
  info: {
    title: "MineRU OCR Wrapper API",
    version: "1.0.0",
    description:
      "OCR document parsing service powered by MineRU. Supports PDF, PNG, JPG, TIFF, BMP, GIF, DOCX, XLSX, XLS, PPTX, CSV.\n\n" +
      "## Authentication\n\n" +
      "This API uses two authentication methods:\n\n" +
      "### 1. Session Cookie (Web UI)\n" +
      "After signing in via `/api/auth/sign-in/email`, the server sets a `better-auth.session_token` cookie. " +
      "Include this cookie with all subsequent requests.\n\n" +
      "### 2. API Key (Programmatic Access)\n" +
      "For API access without cookies, create an API key in the Web UI (Settings page) or via `/api/api-keys`. " +
      "Include the key in the `Authorization` header as a Bearer token:\n\n" +
      "```\nAuthorization: Bearer mk_xxxxxxxxxxxxxxxx\n```\n\n" +
      "API keys are scoped to the user who created them and can be revoked at any time.",
  },
});

app.get(
  "/docs",
  apiReference({
    url: "/api/openapi",
    theme: "default",
  }),
);

export default app;
