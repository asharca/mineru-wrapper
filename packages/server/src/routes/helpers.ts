import { existsSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import { v4 as uuid } from "uuid";
import type { AuthUser } from "../auth.ts";
import { type OcrTask, stmt } from "../db.ts";
import { type ParseOptions, parseFile } from "../mineru.ts";

export const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

export const ALLOWED_EXTS = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".tiff",
  ".bmp",
  ".gif",
  ".xlsx",
  ".xls",
  ".docx",
  ".pptx",
]);

export const MIME_MAP: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".tiff": "image/tiff",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".mjs": "application/javascript",
  ".js": "application/javascript",
};

export function getUserId(c: { get: (key: string) => unknown }): string | null {
  const user = c.get("user") as AuthUser | undefined;
  return user?.id ?? null;
}

export async function readUploadFile(
  file: File,
): Promise<{ buf: ArrayBuffer; hash: string; ext: string }> {
  const ext = extname(file.name).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) throw new Error(`Unsupported file type: ${ext}`);

  const buf = await file.arrayBuffer();
  const hash = new Bun.CryptoHasher("sha256").update(buf).digest("hex");
  return { buf, hash, ext };
}

export async function saveBuffer(
  buf: ArrayBuffer,
  ext: string,
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
export async function saveForCached(
  existingFilename: string,
  buf: ArrayBuffer,
  ext: string,
): Promise<{ path: string; filename: string }> {
  const srcPath = join(UPLOAD_DIR, existingFilename);
  if (existsSync(srcPath)) {
    const filename = `${uuid()}${ext}`;
    const filepath = join(UPLOAD_DIR, filename);
    await Bun.write(filepath, Bun.file(srcPath));
    return { path: filepath, filename };
  }
  return saveBuffer(buf, ext);
}

export function cleanFile(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    /* ignore */
  }
}

export async function processTask(
  task: Pick<OcrTask, "id" | "original_name">,
  filePath: string,
  options: ParseOptions,
): Promise<void> {
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

export function serializeTask(task: OcrTask) {
  return {
    ...task,
    content_list: task.content_list ? JSON.parse(task.content_list) : null,
    pages: task.pages ? JSON.parse(task.pages) : null,
  };
}
