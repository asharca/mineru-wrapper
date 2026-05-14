import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { mkdirSync } from "node:fs";
import { v4 as uuid } from "uuid";
import { type OcrTask, stmt } from "../db.ts";
import { type ParseOptions, parseFile } from "../mineru.ts";
import {
  getUserId,
  processTask,
  readUploadFile,
  saveBuffer,
  saveForCached,
  UPLOAD_DIR,
} from "./helpers.ts";
import {
  ApiParseRequestSchema,
  ErrorSchema,
  SyncResultSchema,
  TaskCreatedSchema,
  UploadRequestSchema,
} from "./schemas.ts";

mkdirSync(UPLOAD_DIR, { recursive: true });

export const uploadApp = new OpenAPIHono();

const uploadRoute = createRoute({
  method: "post",
  path: "/upload",
  tags: ["Upload"],
  summary: "Upload file for OCR (async)",
  description:
    "Upload a file via the web UI. Returns immediately with a task ID. Poll GET /tasks/{id} for results.",
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: UploadRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Task created",
      content: { "application/json": { schema: TaskCreatedSchema } },
    },
    400: {
      description: "Bad request",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

uploadApp.openapi(uploadRoute, async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) return c.json({ error: "No file uploaded" }, 400);

  const { buf, hash, ext } = await readUploadFile(file);
  const id = uuid();
  const backend = String(body["backend"] || "pipeline");
  const lang = String(body["lang"] || "ch");
  const userId = getUserId(c);

  const existing = stmt.findByHash.get(hash) as OcrTask | undefined;
  if (existing) {
    const saved = await saveForCached(existing.filename, buf, ext);
    stmt.insertCached.run({
      $id: id,
      $filename: saved.filename,
      $original_name: file.name,
      $source: "web",
      $backend: backend,
      $lang: lang,
      $file_size: buf.byteLength,
      $file_hash: hash,
      $result_md: existing.result_md,
      $content_list: existing.content_list,
      $pages: existing.pages,
      $user_id: userId,
    });
    return c.json(
      { id, status: "completed" as const, message: "Duplicate file, returning cached result" },
      200,
    );
  }

  const saved = await saveBuffer(buf, ext);

  stmt.insert.run({
    $id: id,
    $filename: saved.filename,
    $original_name: file.name,
    $status: "pending",
    $source: "web",
    $backend: backend,
    $lang: lang,
    $file_size: buf.byteLength,
    $file_hash: hash,
    $user_id: userId,
  });

  const options: ParseOptions = {
    backend,
    lang_list: [lang],
    parse_method: body["parse_method"] ? String(body["parse_method"]) : undefined,
    formula_enable: body["formula_enable"] !== "false",
    table_enable: body["table_enable"] !== "false",
    auto_rotate: body["auto_rotate"] === "true",
    mineru_url: body["mineru_url"] ? String(body["mineru_url"]) : undefined,
  };

  processTask({ id, original_name: file.name }, saved.path, options);
  return c.json({ id, status: "pending" as const, message: "Processing started" }, 200);
});

const parseAsyncRoute = createRoute({
  method: "post",
  path: "/api/parse",
  tags: ["API"],
  summary: "Parse file (async)",
  description:
    "Submit a file for OCR processing. Returns a task ID immediately. Poll GET /tasks/{id} for results.",
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: ApiParseRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Task created",
      content: { "application/json": { schema: TaskCreatedSchema } },
    },
    400: {
      description: "Bad request",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

uploadApp.openapi(parseAsyncRoute, async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) return c.json({ error: "No file uploaded" }, 400);

  const { buf, hash, ext } = await readUploadFile(file);
  const id = uuid();
  const backend = String(body["backend"] || "pipeline");
  const langRaw = body["lang_list"];
  const langList = Array.isArray(langRaw)
    ? langRaw.map(String)
    : langRaw
      ? [String(langRaw)]
      : ["ch"];
  const userId = getUserId(c);

  const existing = stmt.findByHash.get(hash) as OcrTask | undefined;
  if (existing) {
    const saved = await saveForCached(existing.filename, buf, ext);
    stmt.insertCached.run({
      $id: id,
      $filename: saved.filename,
      $original_name: file.name,
      $source: "api",
      $backend: backend,
      $lang: langList[0] || "ch",
      $file_size: buf.byteLength,
      $file_hash: hash,
      $result_md: existing.result_md,
      $content_list: existing.content_list,
      $pages: existing.pages,
      $user_id: userId,
    });
    return c.json(
      { id, status: "completed" as const, message: "Duplicate file, returning cached result" },
      200,
    );
  }

  const saved = await saveBuffer(buf, ext);

  stmt.insert.run({
    $id: id,
    $filename: saved.filename,
    $original_name: file.name,
    $status: "pending",
    $source: "api",
    $backend: backend,
    $lang: langList[0] || "ch",
    $file_size: buf.byteLength,
    $file_hash: hash,
    $user_id: userId,
  });

  const options: ParseOptions = {
    backend,
    lang_list: langList,
    parse_method: body["parse_method"] ? String(body["parse_method"]) : undefined,
    formula_enable: body["formula_enable"] !== "false",
    table_enable: body["table_enable"] !== "false",
    start_page_id: body["start_page_id"] ? Number(body["start_page_id"]) : undefined,
    end_page_id: body["end_page_id"] ? Number(body["end_page_id"]) : undefined,
    auto_rotate: body["auto_rotate"] === "true",
    mineru_url: body["mineru_url"] ? String(body["mineru_url"]) : undefined,
  };

  processTask({ id, original_name: file.name }, saved.path, options);
  return c.json({ id, status: "pending" as const, message: "Processing started" }, 200);
});

const parseSyncRoute = createRoute({
  method: "post",
  path: "/api/parse/sync",
  tags: ["API"],
  summary: "Parse file (sync)",
  description:
    "Submit a file and wait for OCR results. Blocks until processing is complete (may take minutes for large files).",
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: ApiParseRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "OCR result",
      content: { "application/json": { schema: SyncResultSchema } },
    },
    400: {
      description: "Bad request",
      content: { "application/json": { schema: ErrorSchema } },
    },
    500: {
      description: "Processing failed",
      content: {
        "application/json": {
          schema: z.object({ id: z.string(), status: z.literal("failed"), error: z.string() }),
        },
      },
    },
  },
});

uploadApp.openapi(parseSyncRoute, async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) return c.json({ error: "No file uploaded" }, 400);

  const { buf, hash, ext } = await readUploadFile(file);
  const id = uuid();
  const backend = String(body["backend"] || "pipeline");
  const langRaw = body["lang_list"];
  const langList = Array.isArray(langRaw)
    ? langRaw.map(String)
    : langRaw
      ? [String(langRaw)]
      : ["ch"];
  const userId = getUserId(c);

  const existing = stmt.findByHash.get(hash) as OcrTask | undefined;
  if (existing) {
    const saved = await saveForCached(existing.filename, buf, ext);
    stmt.insertCached.run({
      $id: id,
      $filename: saved.filename,
      $original_name: file.name,
      $source: "api",
      $backend: backend,
      $lang: langList[0] || "ch",
      $file_size: buf.byteLength,
      $file_hash: hash,
      $result_md: existing.result_md,
      $content_list: existing.content_list,
      $pages: existing.pages,
      $user_id: userId,
    });
    return c.json(
      {
        id,
        status: "completed" as const,
        markdown: existing.result_md || "",
        content_list: existing.content_list ? JSON.parse(existing.content_list) : [],
        pages: existing.pages ? JSON.parse(existing.pages) : [],
      },
      200,
    );
  }

  const saved = await saveBuffer(buf, ext);

  stmt.insert.run({
    $id: id,
    $filename: saved.filename,
    $original_name: file.name,
    $status: "pending",
    $source: "api",
    $backend: backend,
    $lang: langList[0] || "ch",
    $file_size: buf.byteLength,
    $file_hash: hash,
    $user_id: userId,
  });

  const options: ParseOptions = {
    backend,
    lang_list: langList,
    parse_method: body["parse_method"] ? String(body["parse_method"]) : undefined,
    formula_enable: body["formula_enable"] !== "false",
    table_enable: body["table_enable"] !== "false",
    start_page_id: body["start_page_id"] ? Number(body["start_page_id"]) : undefined,
    end_page_id: body["end_page_id"] ? Number(body["end_page_id"]) : undefined,
    auto_rotate: body["auto_rotate"] === "true",
    mineru_url: body["mineru_url"] ? String(body["mineru_url"]) : undefined,
  };

  try {
    stmt.setStatus.run({ $id: id, $status: "processing" });
    const result = await parseFile(saved.path, file.name, options);
    stmt.setResult.run({
      $id: id,
      $result_md: result.markdown,
      $content_list: JSON.stringify(result.contentList),
      $pages: JSON.stringify(result.pages),
    });
    return c.json(
      {
        id,
        status: "completed" as const,
        markdown: result.markdown,
        content_list: result.contentList,
        pages: result.pages,
      },
      200,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stmt.setError.run({ $id: id, $error: message });
    return c.json({ id, status: "failed" as const, error: message }, 500);
  }
});
