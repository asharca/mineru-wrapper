import { Hono } from "hono";
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

const app = new Hono();

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

// ============ Routes ============

// -- Serve original uploaded file --
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

// -- Serve extracted images --
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

// -- Web upload (async) --
app.post("/upload", async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!(file instanceof File)) return c.json({ error: "No file uploaded" }, 400);

  const { buf, hash, ext } = await readUploadFile(file);
  const id = uuid();
  const backend = String(body["backend"] || "pipeline");
  const lang = String(body["lang"] || "ch");

  const existing = stmt.findByHash.get(hash) as OcrTask | undefined;
  if (existing) {
    // Copy the existing file (may be rotated) so the preview matches the cached result
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

// -- API parse (async) --
app.post("/api/parse", async (c) => {
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
    // Copy the existing file (may be rotated) so the preview matches the cached result
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

// -- API parse (sync) --
app.post("/api/parse/sync", async (c) => {
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
    // Copy the existing file (may be rotated) so the preview matches the cached result
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

// -- Task detail --
app.get("/tasks/:id", (c) => {
  const task = stmt.getById.get(c.req.param("id")) as OcrTask | undefined;
  if (!task) return c.json({ error: "Task not found" }, 404);
  return c.json(serializeTask(task));
});

// -- Task list --
app.get("/tasks", (c) => {
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
app.delete("/tasks/:id", (c) => {
  const task = stmt.getById.get(c.req.param("id")) as OcrTask | undefined;
  if (!task) return c.json({ error: "Task not found" }, 404);
  cleanFile(join(UPLOAD_DIR, task.filename));
  stmt.deleteById.run(c.req.param("id"));
  return c.json({ message: "Deleted" });
});

// -- Update task content (manual edit) --
app.patch("/tasks/:id", async (c) => {
  const task = stmt.getById.get(c.req.param("id")) as OcrTask | undefined;
  if (!task) return c.json({ error: "Task not found" }, 404);

  const body = await c.req.json<{ result_md?: string; content_list?: ContentBlock[] }>();
  const newMd = body.result_md ?? task.result_md;
  const newCl = body.content_list ? JSON.stringify(body.content_list) : task.content_list;

  stmt.updateContent.run({ $id: task.id, $result_md: newMd, $content_list: newCl });

  const updated = stmt.getById.get(task.id) as OcrTask;
  return c.json(serializeTask(updated));
});

// -- Reprocess task (rotate + re-OCR) --
app.post("/tasks/:id/reprocess", async (c) => {
  const task = stmt.getById.get(c.req.param("id")) as OcrTask | undefined;
  if (!task) return c.json({ error: "Task not found" }, 404);

  const filePath = join(UPLOAD_DIR, task.filename);
  if (!existsSync(filePath)) return c.json({ error: "Source file not found" }, 404);

  const body = await c.req.json<{
    rotate?: number;
    rotate_pages?: number[];
    rotations?: Record<string, number>;
    page_indices?: number[];
    backend?: string;
    lang?: string;
    parse_method?: string;
    formula_enable?: boolean;
    table_enable?: boolean;
    auto_rotate?: boolean;
    mineru_url?: string;
  }>();

  // Per-page rotations: rotate each page by its own angle, then re-OCR those pages
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

  // Single-angle rotation for all/specific pages
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

  // Partial re-OCR: extract selected pages into a temp PDF, send only that to MineRU, merge results back
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

  // Full reprocess
  stmt.setStatus.run({ $id: task.id, $status: "pending" });
  processTask({ id: task.id, original_name: task.original_name }, filePath, options);

  return c.json({ id: task.id, status: "pending", message: "Reprocessing started" });
});

export default app;
