import { existsSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import db, { type ContentBlock, type OcrTask, stmt } from "../db.ts";
import { extractPdfPages, type ParseOptions, parseFile, rotateFile } from "../mineru.ts";
import {
  cleanFile,
  getUserId,
  getUserSettings,
  MIME_MAP,
  processTask,
  serializeTask,
  UPLOAD_DIR,
} from "./helpers.ts";
import {
  BatchDeleteRequestSchema,
  ErrorSchema,
  ReprocessRequestSchema,
  TaskListSchema,
  TaskSchema,
  UpdateTaskRequestSchema,
} from "./schemas.ts";

export const tasksApp = new OpenAPIHono();

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

tasksApp.openapi(getTaskRoute, (c) => {
  const userId = getUserId(c);
  const task = stmt.getById.get(c.req.param("id"), userId) as OcrTask | undefined;
  if (!task) return c.json({ error: "Task not found" }, 404);
  return c.json(serializeTask(task), 200);
});

const listTasksRoute = createRoute({
  method: "get",
  path: "/tasks",
  tags: ["Tasks"],
  summary: "List tasks",
  description:
    "Paginated list of OCR tasks. Optionally filter by source (web/api) or search by filename.",
  request: {
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
      source: z.enum(["web", "api"]).optional(),
      search: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Task list",
      content: { "application/json": { schema: TaskListSchema } },
    },
  },
});

tasksApp.openapi(listTasksRoute, (c) => {
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 20));
  const offset = (page - 1) * limit;
  const source = c.req.query("source");
  const search = c.req.query("search");
  // FTS5: append * for prefix matching so partial words like "doc" match "document".
  // Strip non-alphanumeric (preserving CJK) to avoid FTS5 syntax errors from punctuation.
  const searchPattern = search ? `${search.replace(/[^a-zA-Z0-9一-鿿\s]/g, " ").trim()}*` : null;
  const userId = getUserId(c);

  let tasks: OcrTask[];
  let total: number;

  if (source === "web" || source === "api") {
    if (searchPattern) {
      tasks = stmt.listBySourceSearch.all(
        source,
        userId,
        searchPattern,
        limit,
        offset,
      ) as OcrTask[];
      total = (stmt.countBySourceSearch.get(source, userId, searchPattern) as { total: number })
        .total;
    } else {
      tasks = stmt.listBySource.all(source, userId, limit, offset) as OcrTask[];
      total = (stmt.countBySource.get(source, userId) as { total: number }).total;
    }
  } else {
    if (searchPattern) {
      tasks = stmt.listSearch.all(userId, searchPattern, limit, offset) as OcrTask[];
      total = (stmt.countSearch.get(userId, searchPattern) as { total: number }).total;
    } else {
      tasks = stmt.list.all(userId, limit, offset) as OcrTask[];
      total = (stmt.count.get(userId) as { total: number }).total;
    }
  }

  const taskItems = (
    tasks as (OcrTask & { result_md?: string | null; fts_snippet?: string | null })[]
  ).map((task) => ({
    id: task.id,
    filename: task.filename,
    original_name: task.original_name,
    status: task.status,
    source: task.source,
    backend: task.backend,
    lang: task.lang,
    progress: task.progress,
    error: task.error,
    created_at: task.created_at,
    completed_at: task.completed_at,
    file_size: task.file_size,
    snippet: searchPattern ? (task.fts_snippet ?? null) : null,
  }));

  return c.json(
    {
      tasks: taskItems,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
    200,
  );
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

tasksApp.openapi(deleteTaskRoute, (c) => {
  const userId = getUserId(c);
  const task = stmt.getById.get(c.req.param("id"), userId) as OcrTask | undefined;
  if (!task) return c.json({ error: "Task not found" }, 404);
  cleanFile(join(UPLOAD_DIR, task.filename));
  stmt.deleteById.run(c.req.param("id"), userId);
  return c.json({ message: "Deleted" }, 200);
});

const batchDeleteRoute = createRoute({
  method: "post",
  path: "/tasks/batch-delete",
  tags: ["Tasks"],
  summary: "Batch delete tasks",
  description: "Delete multiple tasks and their uploaded files by ID.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: BatchDeleteRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Deleted",
      content: { "application/json": { schema: z.object({ deleted: z.number() }) } },
    },
    400: {
      description: "Bad request",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

tasksApp.openapi(batchDeleteRoute, (c) => {
  const body = c.req.valid("json");
  const { ids } = body;
  if (!ids.length) return c.json({ error: "No IDs provided" }, 400);
  const userId = getUserId(c);

  for (const id of ids) {
    const task = stmt.getById.get(id, userId) as OcrTask | undefined;
    if (task) cleanFile(join(UPLOAD_DIR, task.filename));
  }
  stmt.deleteByIds(ids, userId!);
  return c.json({ deleted: ids.length }, 200);
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

tasksApp.openapi(updateContentRoute, (c) => {
  const userId = getUserId(c);
  const task = stmt.getById.get(c.req.param("id"), userId) as OcrTask | undefined;
  if (!task) return c.json({ error: "Task not found" }, 404);

  const body = c.req.valid("json");
  const newMd = body.result_md ?? task.result_md;
  const newCl = body.content_list ? JSON.stringify(body.content_list) : task.content_list;

  stmt.updateContent.run({
    $id: task.id,
    $result_md: newMd,
    $content_list: newCl,
    $user_id: userId,
  });

  const updated = stmt.getById.get(task.id, userId) as OcrTask;
  return c.json(serializeTask(updated), 200);
});

const reprocessRoute = createRoute({
  method: "post",
  path: "/tasks/{id}/reprocess",
  tags: ["Tasks"],
  summary: "Reprocess task",
  description:
    "Re-run OCR on the task's file. Optionally rotate by a specific angle before re-processing. For PDFs, use page_index to only re-OCR a single page.",
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

tasksApp.openapi(reprocessRoute, async (c) => {
  const userId = getUserId(c);
  const task = stmt.getById.get(c.req.param("id"), userId) as OcrTask | undefined;
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
      body.page_indices = Object.keys(body.rotations)
        .map(Number)
        .sort((a, b) => a - b);
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
    mineru_url: body.mineru_url || getUserSettings(userId)?.mineru_url || undefined,
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
        const existingBlocks: ContentBlock[] = task.content_list
          ? JSON.parse(task.content_list)
          : [];
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

        const existingPages: { width: number; height: number }[] = task.pages
          ? JSON.parse(task.pages)
          : [];
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
          else if (block.list_items)
            pageMds.get(pi)!.push(block.list_items.map((li: string) => `- ${li}`).join("\n"));
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
        if (tmpPath)
          try {
            unlinkSync(tmpPath);
          } catch {
            /* ignore */
          }
      }
    })();

    const label = pageIndices.map((i) => i + 1).join(", ");
    return c.json(
      {
        id: task.id,
        status: "processing",
        message: `Re-OCR page(s) ${label} started`,
      },
      200,
    );
  }

  stmt.setStatus.run({ $id: task.id, $status: "pending" });
  processTask({ id: task.id, original_name: task.original_name }, filePath, options);

  return c.json({ id: task.id, status: "pending", message: "Reprocessing started" }, 200);
});

tasksApp.get("/files/:filename", async (c) => {
  const userId = getUserId(c);
  const filename = c.req.param("filename");
  const task = db
    .prepare(`SELECT * FROM tasks WHERE filename = ? AND (user_id = ? OR user_id IS NULL)`)
    .get(filename, userId) as OcrTask | undefined;
  if (!task) return c.json({ error: "File not found" }, 404);

  const filepath = join(UPLOAD_DIR, filename);
  if (!existsSync(filepath)) return c.json({ error: "File not found" }, 404);

  const ext = extname(filename).toLowerCase();
  const mime = MIME_MAP[ext] || "application/octet-stream";
  const file = Bun.file(filepath);
  return new Response(file, {
    headers: { "Content-Type": mime, "Cache-Control": "public, max-age=86400" },
  });
});

tasksApp.get("/files/img/:filename", async (c) => {
  const userId = getUserId(c);
  const filename = c.req.param("filename");
  const task = db
    .prepare(
      `SELECT * FROM tasks WHERE (result_md LIKE ? OR content_list LIKE ?) AND (user_id = ? OR user_id IS NULL) LIMIT 1`,
    )
    .get(`%${filename}%`, `%${filename}%`, userId) as OcrTask | undefined;
  if (!task) return c.json({ error: "Image not found" }, 404);

  const filepath = join(UPLOAD_DIR, "img", filename);
  if (!existsSync(filepath)) return c.json({ error: "Image not found" }, 404);

  const ext = extname(filename).toLowerCase();
  const mime = MIME_MAP[ext] || "application/octet-stream";
  const file = Bun.file(filepath);
  return new Response(file, {
    headers: { "Content-Type": mime, "Cache-Control": "public, max-age=86400" },
  });
});
