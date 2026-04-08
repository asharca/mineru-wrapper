import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { apiReference } from "@scalar/hono-api-reference";
import { v4 as uuid } from "uuid";
import { mkdirSync, unlinkSync, existsSync } from "fs";
import { join, extname } from "path";
import { stmt, type OcrTask } from "./db.ts";
import { parseFile, type ParseOptions } from "./mineru.ts";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXTS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".gif",
]);

const MIME_MAP: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".tiff": "image/tiff",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".mjs": "application/javascript",
  ".js": "application/javascript",
};

const app = new OpenAPIHono();

// -- helpers --

async function saveUpload(
  file: File
): Promise<{ path: string; filename: string }> {
  const ext = extname(file.name).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) throw new Error(`Unsupported file type: ${ext}`);

  const filename = `${uuid()}${ext}`;
  const filepath = join(UPLOAD_DIR, filename);
  await Bun.write(filepath, file);
  return { path: filepath, filename };
}

function cleanFile(path: string) {
  try { unlinkSync(path); } catch { /* ignore */ }
}

async function processTask(
  task: Pick<OcrTask, "id" | "original_name">,
  filePath: string,
  options: ParseOptions
) {
  stmt.setStatus.run({ $id: task.id, $status: "processing" });
  try {
    const result = await parseFile(filePath, task.original_name, options);
    stmt.setResult.run({
      $id: task.id,
      $result_md: result.markdown,
      $content_list: JSON.stringify(result.contentList),
      $pages: JSON.stringify(result.pages),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stmt.setError.run({ $id: task.id, $error: message });
  }
}

// ============ Schemas ============

const ErrorSchema = z.object({
  error: z.string(),
}).openapi("Error");

const TaskStatusSchema = z.enum(["pending", "processing", "completed", "failed"]).openapi("TaskStatus");

const ContentBlockSchema = z.object({
  type: z.string(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  text: z.string().optional(),
  text_level: z.number().optional(),
  page_idx: z.number().optional(),
  img_path: z.string().optional(),
  img_data: z.string().optional(),
}).openapi("ContentBlock");

const PageSizeSchema = z.object({
  width: z.number(),
  height: z.number(),
}).openapi("PageSize");

const TaskSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  original_name: z.string(),
  status: TaskStatusSchema,
  source: z.enum(["web", "api"]),
  backend: z.string(),
  lang: z.string(),
  result_md: z.string().nullable(),
  content_list: z.array(ContentBlockSchema).nullable(),
  pages: z.array(PageSizeSchema).nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
  file_size: z.number(),
}).openapi("Task");

const TaskSummarySchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  original_name: z.string(),
  status: TaskStatusSchema,
  source: z.enum(["web", "api"]),
  backend: z.string(),
  lang: z.string(),
  error: z.string().nullable(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
  file_size: z.number(),
}).openapi("TaskSummary");

const PaginationSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  pages: z.number(),
}).openapi("Pagination");

const TaskListSchema = z.object({
  tasks: z.array(TaskSummarySchema),
  pagination: PaginationSchema,
}).openapi("TaskList");

const TaskCreatedSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("pending"),
  message: z.string(),
}).openapi("TaskCreated");

const SyncResultSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("completed"),
  markdown: z.string(),
  content_list: z.array(ContentBlockSchema),
  pages: z.array(PageSizeSchema),
}).openapi("SyncResult");

// ============ Routes ============

// -- Serve original uploaded file (not documented in OpenAPI) --
app.get("/files/:filename", async (c) => {
  const filename = c.req.param("filename");
  const filepath = join(UPLOAD_DIR, filename);
  if (!existsSync(filepath)) return c.json({ error: "File not found" }, 404);

  const ext = extname(filename).toLowerCase();
  const mime = MIME_MAP[ext] || "application/octet-stream";
  const file = Bun.file(filepath);
  return new Response(file, {
    headers: { "Content-Type": mime, "Cache-Control": "public, max-age=86400" },
  });
});

// -- Web upload (async) --
const uploadRoute = createRoute({
  method: "post",
  path: "/upload",
  tags: ["Upload"],
  summary: "Upload file for OCR (async)",
  description: "Upload a file via the web UI. Returns immediately with a task ID. Poll GET /tasks/{id} for results.",
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.any().openapi({ type: "string", format: "binary", description: "File to parse (PDF, PNG, JPG, TIFF, BMP, GIF)" }),
            backend: z.enum(["pipeline", "vlm-auto-engine", "hybrid-auto-engine"]).optional().openapi({ description: "OCR backend engine", default: "pipeline" }),
            lang: z.enum(["ch", "en", "japan", "korean", "latin", "arabic", "cyrillic", "devanagari"]).optional().openapi({ description: "Primary document language", default: "ch" }),
            parse_method: z.enum(["auto", "ocr", "txt"]).optional().openapi({ description: "Parse method: auto (default), ocr (force OCR), txt (text extraction)" }),
            formula_enable: z.enum(["true", "false"]).optional().openapi({ description: "Enable formula recognition", default: "true" }),
            table_enable: z.enum(["true", "false"]).optional().openapi({ description: "Enable table recognition", default: "true" }),
            auto_rotate: z.enum(["true", "false"]).optional().openapi({ description: "Auto-detect and correct orientation (0/90/180/270) for images and scanned PDFs via MineRU probing. For PDFs, pages are rendered to images, rotated, and rebuilt.", default: "false" }),
            mineru_url: z.string().optional().openapi({ description: "Override MineRU API URL", example: "http://10.0.10.2:8001" }),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: "Task created", content: { "application/json": { schema: TaskCreatedSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(uploadRoute, async (c): Promise<any> => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) return c.json({ error: "No file uploaded" }, 400);

  const saved = await saveUpload(file);
  const id = uuid();
  const backend = String(body["backend"] || "pipeline");
  const lang = String(body["lang"] || "ch");

  stmt.insert.run({
    $id: id, $filename: saved.filename, $original_name: file.name,
    $status: "pending", $source: "web", $backend: backend,
    $lang: lang, $file_size: file.size,
  });

  const options: ParseOptions = {
    backend, lang_list: [lang],
    parse_method: body["parse_method"] ? String(body["parse_method"]) : undefined,
    formula_enable: body["formula_enable"] !== "false",
    table_enable: body["table_enable"] !== "false",
    auto_rotate: body["auto_rotate"] === "true",
    mineru_url: body["mineru_url"] ? String(body["mineru_url"]) : undefined,
  };

  processTask({ id, original_name: file.name }, saved.path, options);
  return c.json({ id, status: "pending" as const, message: "Processing started" });
});

// -- General API (async) --
const parseAsyncRoute = createRoute({
  method: "post",
  path: "/api/parse",
  tags: ["API"],
  summary: "Parse file (async)",
  description: "Submit a file for OCR processing. Returns a task ID immediately. Poll GET /tasks/{id} for results.",
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.any().openapi({ type: "string", format: "binary", description: "File to parse (PDF, PNG, JPG, TIFF, BMP, GIF)" }),
            backend: z.enum(["pipeline", "vlm-auto-engine", "hybrid-auto-engine"]).optional().openapi({ description: "OCR backend engine", default: "pipeline" }),
            lang_list: z.union([z.string(), z.array(z.string())]).optional().openapi({ description: "Language codes (e.g. ch, en, japan)", default: "ch" }),
            parse_method: z.enum(["auto", "ocr", "txt"]).optional().openapi({ description: "Parse method: auto (default), ocr (force OCR), txt (text extraction)" }),
            formula_enable: z.enum(["true", "false"]).optional().openapi({ description: "Enable formula recognition", default: "true" }),
            table_enable: z.enum(["true", "false"]).optional().openapi({ description: "Enable table recognition", default: "true" }),
            start_page_id: z.string().optional().openapi({ description: "Start page (0-indexed)", example: "0" }),
            end_page_id: z.string().optional().openapi({ description: "End page (0-indexed)", example: "5" }),
            auto_rotate: z.enum(["true", "false"]).optional().openapi({ description: "Auto-detect and correct orientation (0/90/180/270) for images and scanned PDFs via MineRU probing", default: "false" }),
            mineru_url: z.string().optional().openapi({ description: "Override MineRU API URL", example: "http://10.0.10.2:8001" }),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: "Task created", content: { "application/json": { schema: TaskCreatedSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(parseAsyncRoute, async (c): Promise<any> => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) return c.json({ error: "No file uploaded" }, 400);

  const saved = await saveUpload(file);
  const id = uuid();
  const backend = String(body["backend"] || "pipeline");
  const langRaw = body["lang_list"];
  const langList = Array.isArray(langRaw) ? langRaw.map(String) : langRaw ? [String(langRaw)] : ["ch"];

  stmt.insert.run({
    $id: id, $filename: saved.filename, $original_name: file.name,
    $status: "pending", $source: "api", $backend: backend,
    $lang: langList[0] || "ch", $file_size: file.size,
  });

  const options: ParseOptions = {
    backend, lang_list: langList,
    parse_method: body["parse_method"] ? String(body["parse_method"]) : undefined,
    formula_enable: body["formula_enable"] !== "false",
    table_enable: body["table_enable"] !== "false",
    start_page_id: body["start_page_id"] ? Number(body["start_page_id"]) : undefined,
    end_page_id: body["end_page_id"] ? Number(body["end_page_id"]) : undefined,
    auto_rotate: body["auto_rotate"] === "true",
    mineru_url: body["mineru_url"] ? String(body["mineru_url"]) : undefined,
  };

  processTask({ id, original_name: file.name }, saved.path, options);
  return c.json({ id, status: "pending" as const, message: "Processing started" });
});

// -- Sync API --
const parseSyncRoute = createRoute({
  method: "post",
  path: "/api/parse/sync",
  tags: ["API"],
  summary: "Parse file (sync)",
  description: "Submit a file and wait for OCR results. Blocks until processing is complete (may take minutes for large files).",
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.any().openapi({ type: "string", format: "binary", description: "File to parse (PDF, PNG, JPG, TIFF, BMP, GIF)" }),
            backend: z.enum(["pipeline", "vlm-auto-engine", "hybrid-auto-engine"]).optional().openapi({ description: "OCR backend engine", default: "pipeline" }),
            lang_list: z.union([z.string(), z.array(z.string())]).optional().openapi({ description: "Language codes (e.g. ch, en, japan)", default: "ch" }),
            parse_method: z.enum(["auto", "ocr", "txt"]).optional().openapi({ description: "Parse method: auto (default), ocr (force OCR), txt (text extraction)" }),
            formula_enable: z.enum(["true", "false"]).optional().openapi({ description: "Enable formula recognition", default: "true" }),
            table_enable: z.enum(["true", "false"]).optional().openapi({ description: "Enable table recognition", default: "true" }),
            start_page_id: z.string().optional().openapi({ description: "Start page (0-indexed)", example: "0" }),
            end_page_id: z.string().optional().openapi({ description: "End page (0-indexed)", example: "5" }),
            auto_rotate: z.enum(["true", "false"]).optional().openapi({ description: "Auto-detect and correct orientation (0/90/180/270) for images and scanned PDFs via MineRU probing", default: "false" }),
            mineru_url: z.string().optional().openapi({ description: "Override MineRU API URL", example: "http://10.0.10.2:8001" }),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: "OCR result", content: { "application/json": { schema: SyncResultSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Processing failed", content: { "application/json": { schema: z.object({ id: z.string(), status: z.literal("failed"), error: z.string() }) } } },
  },
});

app.openapi(parseSyncRoute, async (c): Promise<any> => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) return c.json({ error: "No file uploaded" }, 400);

  const saved = await saveUpload(file);
  const id = uuid();
  const backend = String(body["backend"] || "pipeline");
  const langRaw = body["lang_list"];
  const langList = Array.isArray(langRaw) ? langRaw.map(String) : langRaw ? [String(langRaw)] : ["ch"];

  stmt.insert.run({
    $id: id, $filename: saved.filename, $original_name: file.name,
    $status: "pending", $source: "api", $backend: backend,
    $lang: langList[0] || "ch", $file_size: file.size,
  });

  const options: ParseOptions = {
    backend, lang_list: langList,
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
    return c.json({ id, status: "completed" as const, markdown: result.markdown, content_list: result.contentList, pages: result.pages });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stmt.setError.run({ $id: id, $error: message });
    return c.json({ id, status: "failed" as const, error: message }, 500);
  }
});

// -- Task detail --
const getTaskRoute = createRoute({
  method: "get",
  path: "/tasks/{id}",
  tags: ["Tasks"],
  summary: "Get task detail",
  description: "Retrieve full task info including OCR results, content blocks, and page sizes.",
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ description: "Task ID" }),
    }),
  },
  responses: {
    200: { description: "Task detail", content: { "application/json": { schema: TaskSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(getTaskRoute, (c): any => {
  const task = stmt.getById.get(c.req.param("id")) as OcrTask | undefined;
  if (!task) return c.json({ error: "Task not found" }, 404);
  return c.json({
    ...task,
    content_list: task.content_list ? JSON.parse(task.content_list) : null,
    pages: task.pages ? JSON.parse(task.pages) : null,
  });
});

// -- Task list --
const listTasksRoute = createRoute({
  method: "get",
  path: "/tasks",
  tags: ["Tasks"],
  summary: "List tasks",
  description: "Paginated list of OCR tasks. Optionally filter by source (web/api).",
  request: {
    query: z.object({
      page: z.string().optional().openapi({ description: "Page number", default: "1" }),
      limit: z.string().optional().openapi({ description: "Items per page (max 100)", default: "20" }),
      source: z.enum(["web", "api"]).optional().openapi({ description: "Filter by source" }),
    }),
  },
  responses: {
    200: { description: "Task list", content: { "application/json": { schema: TaskListSchema } } },
  },
});

app.openapi(listTasksRoute, (c): any => {
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 20));
  const offset = (page - 1) * limit;
  const source = c.req.query("source");

  let tasks: OcrTask[];
  let total: number;

  if (source === "web" || source === "api") {
    tasks = stmt.listBySource.all(source, limit, offset) as OcrTask[];
    total = (stmt.countBySource.get(source) as { total: number }).total;
  } else {
    tasks = stmt.list.all(limit, offset) as OcrTask[];
    total = (stmt.count.get() as { total: number }).total;
  }

  return c.json({
    tasks,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// -- Delete task --
const deleteTaskRoute = createRoute({
  method: "delete",
  path: "/tasks/{id}",
  tags: ["Tasks"],
  summary: "Delete task",
  description: "Delete a task and its uploaded file.",
  request: {
    params: z.object({
      id: z.string().uuid().openapi({ description: "Task ID" }),
    }),
  },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: z.object({ message: z.string() }) } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteTaskRoute, (c): any => {
  const task = stmt.getById.get(c.req.param("id")) as OcrTask | undefined;
  if (!task) return c.json({ error: "Task not found" }, 404);
  cleanFile(join(UPLOAD_DIR, task.filename));
  stmt.deleteById.run(c.req.param("id"));
  return c.json({ message: "Deleted" });
});

// ============ OpenAPI Doc + Swagger UI ============

app.doc("/api/openapi", {
  openapi: "3.0.0",
  info: {
    title: "MineRU OCR Wrapper API",
    version: "1.0.0",
    description: "OCR document parsing service powered by MineRU. Supports PDF, PNG, JPG, TIFF, BMP, GIF.",
  },
});

app.get("/swagger", swaggerUI({ url: "/api/openapi" }));

app.get("/docs", apiReference({
  url: "/api/openapi",
  theme: "default",
}));

export default app;
