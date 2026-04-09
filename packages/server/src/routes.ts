import { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { v4 as uuid } from "uuid";
import { mkdirSync, unlinkSync, existsSync } from "fs";
import { join, extname } from "path";
import { stmt, type OcrTask, type ContentBlock } from "./db.ts";
import { parseFile, rotateFile, extractPdfPages, type ParseOptions } from "./mineru.ts";

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

async function readUploadFile(file: File): Promise<{ buf: ArrayBuffer; hash: string; ext: string }> {
  const ext = extname(file.name).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) throw new Error(`Unsupported file type: ${ext}`);

  const buf = await file.arrayBuffer();
  const hash = new Bun.CryptoHasher("sha256").update(buf).digest("hex");
  return { buf, hash, ext };
}

async function saveBuffer(
  buf: ArrayBuffer,
  ext: string
): Promise<{ path: string; filename: string }> {
  const filename = `${uuid()}${ext}`;
  const filepath = join(UPLOAD_DIR, filename);
  await Bun.write(filepath, buf);
  return { path: filepath, filename };
}

/**
 * For cached tasks: copy the existing task's file (which may be rotated)
 * so the new task's PDF preview matches the cached result.
 * Falls back to saving the original buffer if the source file is missing.
 */
async function saveForCached(
  existingFilename: string,
  buf: ArrayBuffer,
  ext: string
): Promise<{ path: string; filename: string }> {
  const srcPath = join(UPLOAD_DIR, existingFilename);
  if (existsSync(srcPath)) {
    const filename = `${uuid()}${ext}`;
    const filepath = join(UPLOAD_DIR, filename);
    await Bun.write(filepath, Bun.file(srcPath));
    return { path: filepath, filename };
  }
  // Source gone – fall back to the original uploaded buffer
  return saveBuffer(buf, ext);
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
    options.onProgress = (progress) => {
      stmt.setProgress.run({ $id: task.id, $progress: JSON.stringify(progress) });
    };
    const result = await parseFile(filePath, task.original_name, options);
    stmt.setResult.run({
      $id: task.id,
      $result_md: result.markdown,
      $content_list: JSON.stringify(result.contentList),
      $pages: JSON.stringify(result.pages),
    });
    stmt.setProgress.run({ $id: task.id, $progress: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stmt.setError.run({ $id: task.id, $error: message });
    stmt.setProgress.run({ $id: task.id, $progress: null });
  }
}

function serializeTask(task: OcrTask) {
  return {
    ...task,
    content_list: task.content_list ? JSON.parse(task.content_list) : null,
    pages: task.pages ? JSON.parse(task.pages) : null,
  };
}

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
  img_url: z.string().optional(),
  table_body: z.string().optional(),
  list_items: z.array(z.string()).optional(),
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
  progress: z.string().nullable().optional(),
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
  progress: z.string().nullable().optional(),
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

// ============ OpenAPI Routes ============

const UploadRequestSchema = z.object({
  file: z.any(),
  backend: z.enum(["pipeline", "vlm-auto-engine", "hybrid-auto-engine", "vlm-http-client", "hybrid-http-client"]).optional(),
  lang: z.enum(["ch", "en", "japan", "korean", "latin", "arabic", "cyrillic", "devanagari"]).optional(),
  parse_method: z.enum(["auto", "ocr", "txt"]).optional(),
  formula_enable: z.enum(["true", "false"]).optional(),
  table_enable: z.enum(["true", "false"]).optional(),
  auto_rotate: z.enum(["true", "false"]).optional(),
  mineru_url: z.string().optional(),
}).openapi("UploadRequest");

const ApiParseRequestSchema = z.object({
  file: z.any(),
  backend: z.enum(["pipeline", "vlm-auto-engine", "hybrid-auto-engine", "vlm-http-client", "hybrid-http-client"]).optional(),
  lang_list: z.union([z.string(), z.array(z.string())]).optional(),
  parse_method: z.enum(["auto", "ocr", "txt"]).optional(),
  formula_enable: z.enum(["true", "false"]).optional(),
  table_enable: z.enum(["true", "false"]).optional(),
  start_page_id: z.string().optional(),
  end_page_id: z.string().optional(),
  auto_rotate: z.enum(["true", "false"]).optional(),
  mineru_url: z.string().optional(),
}).openapi("ApiParseRequest");

const UpdateTaskRequestSchema = z.object({
  result_md: z.string().optional(),
  content_list: z.array(ContentBlockSchema).optional(),
}).openapi("UpdateTaskRequest");

const ReprocessRequestSchema = z.object({
  rotate: z.number().optional(),
  rotate_pages: z.array(z.number()).optional(),
  rotations: z.record(z.string(), z.number()).optional(),
  page_indices: z.array(z.number()).optional(),
  backend: z.string().optional(),
  lang: z.string().optional(),
  parse_method: z.string().optional(),
  formula_enable: z.boolean().optional(),
  table_enable: z.boolean().optional(),
  auto_rotate: z.boolean().optional(),
  mineru_url: z.string().optional(),
}).openapi("ReprocessRequest");

// ============ OpenAPI Routes ============

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

app.openapi(uploadRoute, async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) return c.json({ error: "No file uploaded" }, 400);

  const { buf, hash, ext } = await readUploadFile(file);
  const id = uuid();
  const backend = String(body["backend"] || "pipeline");
  const lang = String(body["lang"] || "ch");

  const existing = stmt.findByHash.get(hash) as OcrTask | undefined;
  if (existing) {
    const saved = await saveForCached(existing.filename, buf, ext);
    stmt.insertCached.run({
      $id: id, $filename: saved.filename, $original_name: file.name,
      $source: "web", $backend: backend, $lang: lang,
      $file_size: buf.byteLength, $file_hash: hash,
      $result_md: existing.result_md, $content_list: existing.content_list, $pages: existing.pages,
    });
    return c.json({ id, status: "completed", message: "Duplicate file, returning cached result" });
  }

  const saved = await saveBuffer(buf, ext);

  stmt.insert.run({
    $id: id, $filename: saved.filename, $original_name: file.name,
    $status: "pending", $source: "web", $backend: backend,
    $lang: lang, $file_size: buf.byteLength, $file_hash: hash,
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
  return c.json({ id, status: "pending", message: "Processing started" });
});

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

app.openapi(parseAsyncRoute, async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) return c.json({ error: "No file uploaded" }, 400);

  const { buf, hash, ext } = await readUploadFile(file);
  const id = uuid();
  const backend = String(body["backend"] || "pipeline");
  const langRaw = body["lang_list"];
  const langList = Array.isArray(langRaw) ? langRaw.map(String) : langRaw ? [String(langRaw)] : ["ch"];

  const existing = stmt.findByHash.get(hash) as OcrTask | undefined;
  if (existing) {
    const saved = await saveForCached(existing.filename, buf, ext);
    stmt.insertCached.run({
      $id: id, $filename: saved.filename, $original_name: file.name,
      $source: "api", $backend: backend, $lang: langList[0] || "ch",
      $file_size: buf.byteLength, $file_hash: hash,
      $result_md: existing.result_md, $content_list: existing.content_list, $pages: existing.pages,
    });
    return c.json({ id, status: "completed", message: "Duplicate file, returning cached result" });
  }

  const saved = await saveBuffer(buf, ext);

  stmt.insert.run({
    $id: id, $filename: saved.filename, $original_name: file.name,
    $status: "pending", $source: "api", $backend: backend,
    $lang: langList[0] || "ch", $file_size: buf.byteLength, $file_hash: hash,
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
  return c.json({ id, status: "pending", message: "Processing started" });
});

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

app.openapi(parseSyncRoute, async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) return c.json({ error: "No file uploaded" }, 400);

  const { buf, hash, ext } = await readUploadFile(file);
  const id = uuid();
  const backend = String(body["backend"] || "pipeline");
  const langRaw = body["lang_list"];
  const langList = Array.isArray(langRaw) ? langRaw.map(String) : langRaw ? [String(langRaw)] : ["ch"];

  const existing = stmt.findByHash.get(hash) as OcrTask | undefined;
  if (existing) {
    const saved = await saveForCached(existing.filename, buf, ext);
    stmt.insertCached.run({
      $id: id, $filename: saved.filename, $original_name: file.name,
      $source: "api", $backend: backend, $lang: langList[0] || "ch",
      $file_size: buf.byteLength, $file_hash: hash,
      $result_md: existing.result_md, $content_list: existing.content_list, $pages: existing.pages,
    });
    return c.json({
      id, status: "completed",
      markdown: existing.result_md || "",
      content_list: existing.content_list ? JSON.parse(existing.content_list) : [],
      pages: existing.pages ? JSON.parse(existing.pages) : [],
    });
  }

  const saved = await saveBuffer(buf, ext);

  stmt.insert.run({
    $id: id, $filename: saved.filename, $original_name: file.name,
    $status: "pending", $source: "api", $backend: backend,
    $lang: langList[0] || "ch", $file_size: buf.byteLength, $file_hash: hash,
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
    return c.json({ id, status: "completed", markdown: result.markdown, content_list: result.contentList, pages: result.pages });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stmt.setError.run({ $id: id, $error: message });
    return c.json({ id, status: "failed", error: message }, 500);
  }
});

const getTaskRoute = createRoute({
  method: "get",
  path: "/tasks/{id}",
  tags: ["Tasks"],
  summary: "Get task detail",
  description: "Retrieve full task info including OCR results, content blocks, and page sizes.",
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: "Task detail",
      content: { "application/json": { schema: TaskSchema } },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

app.openapi(getTaskRoute, (c) => {
  const task = stmt.getById.get(c.req.param("id")) as OcrTask | undefined;
  if (!task) return c.json({ error: "Task not found" }, 404);
  return c.json(serializeTask(task));
});

const listTasksRoute = createRoute({
  method: "get",
  path: "/tasks",
  tags: ["Tasks"],
  summary: "List tasks",
  description: "Paginated list of OCR tasks. Optionally filter by source (web/api).",
  request: {
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
      source: z.enum(["web", "api"]).optional(),
    }),
  },
  responses: {
    200: {
      description: "Task list",
      content: { "application/json": { schema: TaskListSchema } },
    },
  },
});

app.openapi(listTasksRoute, (c) => {
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

const deleteTaskRoute = createRoute({
  method: "delete",
  path: "/tasks/{id}",
  tags: ["Tasks"],
  summary: "Delete task",
  description: "Delete a task and its uploaded file.",
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: "Deleted",
      content: { "application/json": { schema: z.object({ message: z.string() }) } },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

app.openapi(deleteTaskRoute, (c) => {
  const task = stmt.getById.get(c.req.param("id")) as OcrTask | undefined;
  if (!task) return c.json({ error: "Task not found" }, 404);
  cleanFile(join(UPLOAD_DIR, task.filename));
  stmt.deleteById.run(c.req.param("id"));
  return c.json({ message: "Deleted" });
});

const updateContentRoute = createRoute({
  method: "patch",
  path: "/tasks/{id}",
  tags: ["Tasks"],
  summary: "Update task content",
  description: "Manually edit the recognized text content (markdown and/or content blocks).",
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
    body: {
      content: {
        "application/json": {
          schema: UpdateTaskRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Updated",
      content: { "application/json": { schema: TaskSchema } },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

app.openapi(updateContentRoute, (c) => {
  const task = stmt.getById.get(c.req.param("id")) as OcrTask | undefined;
  if (!task) return c.json({ error: "Task not found" }, 404);

  const body = c.req.valid("json");
  const newMd = body.result_md ?? task.result_md;
  const newCl = body.content_list ? JSON.stringify(body.content_list) : task.content_list;

  stmt.updateContent.run({ $id: task.id, $result_md: newMd, $content_list: newCl });

  const updated = stmt.getById.get(task.id) as OcrTask;
  return c.json(serializeTask(updated));
});

const reprocessRoute = createRoute({
  method: "post",
  path: "/tasks/{id}/reprocess",
  tags: ["Tasks"],
  summary: "Reprocess task",
  description: "Re-run OCR on the task's file. Optionally rotate by a specific angle before re-processing. For PDFs, use page_index to only re-OCR a single page.",
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
    body: {
      content: {
        "application/json": {
          schema: ReprocessRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Reprocessing started",
      content: {
        "application/json": {
          schema: z.object({ id: z.string(), status: z.string(), message: z.string() }),
        },
      },
    },
    404: {
      description: "Not found",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

app.openapi(reprocessRoute, async (c) => {
  const task = stmt.getById.get(c.req.param("id")) as OcrTask | undefined;
  if (!task) return c.json({ error: "Task not found" }, 404);

  const filePath = join(UPLOAD_DIR, task.filename);
  if (!existsSync(filePath)) return c.json({ error: "Source file not found" }, 404);

  const body = c.req.valid("json");

  if (body.rotations && Object.keys(body.rotations).length > 0) {
    for (const [pageStr, angle] of Object.entries(body.rotations)) {
      const pageIdx = Number(pageStr);
      if (angle && [90, 180, 270].includes(angle)) {
        await rotateFile(filePath, angle, [pageIdx]);
      }
    }
    if (!body.page_indices?.length) {
      body.page_indices = Object.keys(body.rotations).map(Number).sort((a, b) => a - b);
    }
  }

  if (body.rotate && body.rotate !== 0 && !body.rotations) {
    await rotateFile(filePath, body.rotate, body.rotate_pages);
  }

  const options: ParseOptions = {
    backend: body.backend || task.backend,
    lang_list: [body.lang || task.lang],
    parse_method: body.parse_method || undefined,
    formula_enable: body.formula_enable ?? true,
    table_enable: body.table_enable ?? true,
    auto_rotate: body.auto_rotate ?? false,
    mineru_url: body.mineru_url || undefined,
  };

  if (body.page_indices?.length) {
    const pageIndices = body.page_indices.sort((a, b) => a - b);

    stmt.setStatus.run({ $id: task.id, $status: "processing" });

    (async () => {
      let tmpPath: string | undefined;
      try {
        tmpPath = await extractPdfPages(filePath, pageIndices);
        options.onProgress = (progress) => {
          stmt.setProgress.run({ $id: task.id, $progress: JSON.stringify(progress) });
        };
        const result = await parseFile(tmpPath, task.original_name, options);

        const pageIndexSet = new Set(pageIndices);
        const existingBlocks: ContentBlock[] = task.content_list ? JSON.parse(task.content_list) : [];
        const otherBlocks = existingBlocks.filter((b) => !pageIndexSet.has(b.page_idx ?? 0));
        const newBlocks = result.contentList.map((b) => ({
          ...b,
          page_idx: pageIndices[b.page_idx ?? 0],
        }));
        const merged = [...otherBlocks, ...newBlocks].sort((a, b) => {
          const pa = a.page_idx ?? 0;
          const pb = b.page_idx ?? 0;
          if (pa !== pb) return pa - pb;
          return (a.bbox?.[1] ?? 0) - (b.bbox?.[1] ?? 0);
        });

        const existingPages: { width: number; height: number }[] = task.pages ? JSON.parse(task.pages) : [];
        for (let i = 0; i < pageIndices.length; i++) {
          const origIdx = pageIndices[i]!;
          if (result.pages[i] && origIdx < existingPages.length) {
            existingPages[origIdx] = result.pages[i]!;
          }
        }

        const pageMds = new Map<number, string[]>();
        for (const block of merged) {
          const pi = block.page_idx ?? 0;
          if (!pageMds.has(pi)) pageMds.set(pi, []);
          if (block.text) pageMds.get(pi)!.push(block.text);
          else if (block.list_items) pageMds.get(pi)!.push(block.list_items.map((li: string) => `- ${li}`).join("\n"));
          else if (block.table_body) pageMds.get(pi)!.push(block.table_body);
        }
        const sortedPages = [...pageMds.keys()].sort((a, b) => a - b);
        const newMd = sortedPages.map((pi) => pageMds.get(pi)!.join("\n\n")).join("\n\n---\n\n");

        stmt.setResult.run({
          $id: task.id,
          $result_md: newMd,
          $content_list: JSON.stringify(merged),
          $pages: JSON.stringify(existingPages),
        });
        stmt.setProgress.run({ $id: task.id, $progress: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        stmt.setError.run({ $id: task.id, $error: message });
        stmt.setProgress.run({ $id: task.id, $progress: null });
      } finally {
        if (tmpPath) try { unlinkSync(tmpPath); } catch { /* ignore */ }
      }
    })();

    const label = pageIndices.map((i) => i + 1).join(", ");
    return c.json({ id: task.id, status: "processing", message: `Re-OCR page(s) ${label} started` });
  }

  stmt.setStatus.run({ $id: task.id, $status: "pending" });
  processTask({ id: task.id, original_name: task.original_name }, filePath, options);

  return c.json({ id: task.id, status: "pending", message: "Reprocessing started" });
});

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

app.get("/files/img/:filename", async (c) => {
  const filename = c.req.param("filename");
  const filepath = join(UPLOAD_DIR, "img", filename);
  if (!existsSync(filepath)) return c.json({ error: "Image not found" }, 404);

  const ext = extname(filename).toLowerCase();
  const mime = MIME_MAP[ext] || "application/octet-stream";
  const file = Bun.file(filepath);
  return new Response(file, {
    headers: { "Content-Type": mime, "Cache-Control": "public, max-age=86400" },
  });
});

// OpenAPI documentation endpoint
app.doc("/api/openapi", {
  openapi: "3.0.0",
  info: {
    title: "MineRU OCR Wrapper API",
    version: "1.0.0",
    description: "OCR document parsing service powered by MineRU. Supports PDF, PNG, JPG, TIFF, BMP, GIF.",
  },
});

app.get("/docs", apiReference({
  url: "/api/openapi",
  theme: "default",
}));

export default app;
