import { Hono } from "hono";
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
};

const app = new Hono();

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

// == Serve original uploaded file ==
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

// == Web upload (async, returns immediately) ==
app.post("/upload", async (c) => {
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
  };

  processTask({ id, original_name: file.name }, saved.path, options);
  return c.json({ id, status: "pending", message: "Processing started" });
});

// == General API (async) ==
app.post("/api/parse", async (c) => {
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
  };

  processTask({ id, original_name: file.name }, saved.path, options);
  return c.json({ id, status: "pending", message: "Processing started" });
});

// == Sync API (waits for result) ==
app.post("/api/parse/sync", async (c) => {
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

// == Task status ==
app.get("/tasks/:id", (c) => {
  const task = stmt.getById.get(c.req.param("id")) as OcrTask | undefined;
  if (!task) return c.json({ error: "Task not found" }, 404);
  return c.json({
    ...task,
    content_list: task.content_list ? JSON.parse(task.content_list) : null,
    pages: task.pages ? JSON.parse(task.pages) : null,
  });
});

// == History list ==
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

// == Delete task ==
app.delete("/tasks/:id", (c) => {
  const task = stmt.getById.get(c.req.param("id")) as OcrTask | undefined;
  if (!task) return c.json({ error: "Task not found" }, 404);
  // Also clean up uploaded file
  cleanFile(join(UPLOAD_DIR, task.filename));
  stmt.deleteById.run(c.req.param("id"));
  return c.json({ message: "Deleted" });
});

export default app;
