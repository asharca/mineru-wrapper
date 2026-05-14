import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { createApiKey, listApiKeys, revokeApiKey } from "../apikey.ts";
import { getUserId } from "./helpers.ts";
import { ApiKeyCreateRequestSchema, ErrorSchema } from "./schemas.ts";

export const apiKeysApp = new OpenAPIHono();

const apiKeyListRoute = createRoute({
  method: "get",
  path: "/api/api-keys",
  tags: ["API Keys"],
  summary: "List API keys",
  responses: {
    200: {
      description: "List of API keys",
      content: {
        "application/json": {
          schema: z.array(
            z.object({
              id: z.string(),
              key_prefix: z.string(),
              name: z.string().nullable(),
              created_at: z.string(),
              last_used_at: z.string().nullable(),
            }),
          ),
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

apiKeysApp.openapi(apiKeyListRoute, (c) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const keys = listApiKeys(userId);
  return c.json(keys, 200);
});

const apiKeyCreateRoute = createRoute({
  method: "post",
  path: "/api/api-keys",
  tags: ["API Keys"],
  summary: "Create API key",
  request: {
    body: {
      content: {
        "application/json": {
          schema: ApiKeyCreateRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "API key created",
      content: {
        "application/json": {
          schema: z.object({ key: z.string(), prefix: z.string() }),
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

apiKeysApp.openapi(apiKeyCreateRoute, (c) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const body = c.req.valid("json");
  const result = createApiKey(userId, body.name);
  return c.json(result, 200);
});

const apiKeyDeleteRoute = createRoute({
  method: "delete",
  path: "/api/api-keys/{id}",
  tags: ["API Keys"],
  summary: "Revoke API key",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: "Revoked",
      content: { "application/json": { schema: z.object({ message: z.string() }) } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorSchema } },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

apiKeysApp.openapi(apiKeyDeleteRoute, (c) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const success = revokeApiKey(c.req.param("id"), userId);
  if (!success) return c.json({ error: "API key not found" }, 404);
  return c.json({ message: "Revoked" }, 200);
});
