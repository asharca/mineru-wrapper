import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { stmt } from "../db.ts";
import { getUserId } from "./helpers.ts";
import { DEFAULT_SETTINGS, ErrorSchema, SettingsSchema } from "./schemas.ts";

export const settingsApp = new OpenAPIHono();

const getSettingsRoute = createRoute({
  method: "get",
  path: "/api/settings",
  tags: ["Settings"],
  summary: "Get user settings",
  responses: {
    200: {
      description: "User settings",
      content: { "application/json": { schema: SettingsSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

settingsApp.openapi(getSettingsRoute, (c) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const row = stmt.getSettings.get(userId) as { settings: string } | undefined;
  if (!row) return c.json(DEFAULT_SETTINGS, 200);
  try {
    return c.json(JSON.parse(row.settings), 200);
  } catch {
    return c.json(DEFAULT_SETTINGS, 200);
  }
});

const putSettingsRoute = createRoute({
  method: "put",
  path: "/api/settings",
  tags: ["Settings"],
  summary: "Update user settings",
  request: {
    body: {
      content: { "application/json": { schema: SettingsSchema } },
    },
  },
  responses: {
    200: {
      description: "Saved settings",
      content: { "application/json": { schema: SettingsSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

settingsApp.openapi(putSettingsRoute, (c) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const settings = c.req.valid("json");
  stmt.upsertSettings.run({ $user_id: userId, $settings: JSON.stringify(settings) });
  return c.json(settings, 200);
});
