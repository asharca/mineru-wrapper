import { dirname, extname, join } from "node:path";
import { mkdirSync } from "fs";
import { degrees, PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { v4 as uuid } from "uuid";
import type { ContentBlock } from "./db.ts";
import { logger } from "./logger.ts";

export function applyImageUrls(
  blocks: ContentBlock[],
  urlMap: Record<string, string>,
): ContentBlock[] {
  return blocks.map((block) => {
    if (!block.img_path) return block;
    const key = block.img_path.replace(/^images\//, "");
    const img_url = urlMap[key];
    if (!img_url) return block;
    return { ...block, img_url };
  });
}

const DEFAULT_MINERU_URL = process.env.MINERU_URL || "http://10.0.10.2:8001";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".gif"]);

export interface ParseOptions {
  backend?: string;
  lang_list?: string[];
  parse_method?: string;
  formula_enable?: boolean;
  table_enable?: boolean;
  start_page_id?: number;
  end_page_id?: number;
  mineru_url?: string;
  onProgress?: (progress: { state: string; message?: string }) => void;
}

export interface ParseResult {
  markdown: string;
  contentList: ContentBlock[];
  pages: { width: number; height: number }[];
  raw: unknown;
}

/**
 * Manually rotate a file by a specific angle.
 * For images: rotate with sharp.
 * For PDFs: apply rotation via pdf-lib metadata (setRotation).
 */
export async function rotateFile(
  filePath: string,
  angle: number,
  pageIndices?: number[],
): Promise<void> {
  const validAngles = [90, 180, 270];
  if (!validAngles.includes(angle)) return;

  const ext = extname(filePath).toLowerCase();

  if (IMAGE_EXTS.has(ext)) {
    const buf = await Bun.file(filePath).arrayBuffer();
    const rotated = await sharp(Buffer.from(buf)).rotate(angle).toBuffer();
    await Bun.write(filePath, rotated);
    logger.info("[rotate] image rotated", { angle });
    return;
  }

  if (ext === ".pdf") {
    const pdfBytes = await Bun.file(filePath).arrayBuffer();
    const srcPdf = await PDFDocument.load(pdfBytes);
    const numPages = srcPdf.getPageCount();

    const rotateSet = pageIndices ? new Set(pageIndices) : null;

    for (let i = 0; i < numPages; i++) {
      const shouldRotate = rotateSet === null || rotateSet.has(i);
      if (shouldRotate) {
        const page = srcPdf.getPage(i);
        const currentRotation = page.getRotation().angle;
        page.setRotation(degrees(currentRotation + angle));
        logger.info("[rotate] pdf page rotated", { page: i + 1, total: numPages, angle });
      } else {
        logger.info("[rotate] pdf page kept", { page: i + 1, total: numPages });
      }
    }

    const rotatedBytes = await srcPdf.save();
    await Bun.write(filePath, rotatedBytes);
    return;
  }
}

/**
 * Extract specific pages from a PDF into a temporary file.
 * Returns the temp file path. Caller is responsible for cleanup.
 */
export async function extractPdfPages(filePath: string, pageIndices: number[]): Promise<string> {
  const pdfBytes = await Bun.file(filePath).arrayBuffer();
  const srcPdf = await PDFDocument.load(pdfBytes);
  const newPdf = await PDFDocument.create();

  const copiedPages = await newPdf.copyPages(srcPdf, pageIndices);
  for (const page of copiedPages) {
    newPdf.addPage(page);
  }

  const tmpPath = join(dirname(filePath), `_extract_${uuid()}.pdf`);
  await Bun.write(tmpPath, await newPdf.save());
  return tmpPath;
}

function buildForm(filePath: string, originalName: string, options: ParseOptions): FormData {
  const form = new FormData();
  const fileBlob = Bun.file(filePath);
  form.append("files", fileBlob, originalName);
  form.append("return_md", "true");
  form.append("return_content_list", "true");
  form.append("return_middle_json", "true");
  form.append("return_images", "true");
  form.append("backend", options.backend || "hybrid-auto-engine");

  const langs = options.lang_list?.length ? options.lang_list : ["ch"];
  for (const lang of langs) {
    form.append("lang_list", lang);
  }

  if (options.parse_method) form.append("parse_method", options.parse_method);
  if (options.formula_enable !== undefined)
    form.append("formula_enable", String(options.formula_enable));
  if (options.table_enable !== undefined) form.append("table_enable", String(options.table_enable));
  if (options.start_page_id !== undefined)
    form.append("start_page_id", String(options.start_page_id));
  if (options.end_page_id !== undefined) form.append("end_page_id", String(options.end_page_id));

  return form;
}

const POLL_INTERVAL = 2000;
const POLL_TIMEOUT = 600_000;

type ProgressCallback = (progress: { state: string; message?: string }) => void;

async function submitAndPoll(
  mineruUrl: string,
  form: FormData,
  onProgress?: ProgressCallback,
): Promise<Record<string, unknown>> {
  const submitRes = await fetch(`${mineruUrl}/tasks`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60_000),
  });

  if (!submitRes.ok) {
    const text = await submitRes.text();
    throw new Error(`MineRU submit failed ${submitRes.status}: ${text}`);
  }

  const submitJson = (await submitRes.json()) as Record<string, unknown>;
  const taskId = submitJson.task_id as string;
  if (!taskId) throw new Error("MineRU did not return a task_id");

  const queuedAhead = typeof submitJson.queued_ahead === "number" ? submitJson.queued_ahead : 0;
  onProgress?.({
    state: "pending",
    message: queuedAhead > 0 ? `Queued (${queuedAhead} ahead)` : "Queued",
  });

  const deadline = Date.now() + POLL_TIMEOUT;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));

    const statusRes = await fetch(`${mineruUrl}/tasks/${taskId}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!statusRes.ok) continue;

    const statusJson = (await statusRes.json()) as Record<string, unknown>;
    const state = String(statusJson.status || "unknown");

    if (state === "pending") {
      const qa = typeof statusJson.queued_ahead === "number" ? statusJson.queued_ahead : 0;
      onProgress?.({
        state,
        message: qa > 0 ? `Queued (${qa} ahead)` : "Queued",
      });
    } else if (state === "running" || state === "processing") {
      onProgress?.({ state, message: "Recognizing" });
    }

    if (state === "done" || state === "completed" || state === "success") {
      onProgress?.({ state: "completed", message: "Fetching result" });
      const resultRes = await fetch(`${mineruUrl}/tasks/${taskId}/result`, {
        signal: AbortSignal.timeout(60_000),
      });
      if (!resultRes.ok) {
        const text = await resultRes.text();
        throw new Error(`MineRU result fetch failed ${resultRes.status}: ${text}`);
      }
      return (await resultRes.json()) as Record<string, unknown>;
    }

    if (state === "failed" || state === "error") {
      const errMsg = statusJson.error || statusJson.message || "MineRU task failed";
      throw new Error(String(errMsg));
    }
  }

  throw new Error("MineRU task timed out");
}

async function extractResults(
  json: Record<string, unknown>,
  filePath: string,
): Promise<ParseResult> {
  let markdown = "";
  let contentList: ContentBlock[] = [];
  const pages: { width: number; height: number }[] = [];

  const results = json.results as Record<string, Record<string, unknown>> | undefined;

  if (results && typeof results === "object") {
    const entries = Object.values(results);
    markdown = entries
      .map((entry) => String(entry.md_content || ""))
      .filter(Boolean)
      .join("\n\n---\n\n");

    for (const entry of entries) {
      const cl =
        typeof entry.content_list === "string"
          ? JSON.parse(entry.content_list)
          : entry.content_list;
      if (Array.isArray(cl)) {
        contentList = contentList.concat(cl as ContentBlock[]);
      }

      const mj =
        typeof entry.middle_json === "string" ? JSON.parse(entry.middle_json) : entry.middle_json;
      if (mj?.pdf_info && Array.isArray(mj.pdf_info)) {
        for (const page of mj.pdf_info) {
          if (page.page_size) {
            pages.push({ width: page.page_size[0], height: page.page_size[1] });
          }
        }
      }

      const images = entry.images as Record<string, string> | undefined;
      if (images && typeof images === "object") {
        const uploadDir = dirname(filePath);
        const imgDir = join(uploadDir, "img");
        mkdirSync(imgDir, { recursive: true });

        const urlMap: Record<string, string> = {};
        for (const [key, dataUri] of Object.entries(images)) {
          const match = dataUri.match(/^data:image\/(\w+);base64,(.+)$/);
          if (!match?.[1] || !match[2]) continue;
          const imgExt = match[1] === "jpeg" ? "jpg" : match[1];
          const imgFilename = `${uuid()}.${imgExt}`;
          const imgPath = join(imgDir, imgFilename);
          await Bun.write(imgPath, Buffer.from(match[2], "base64"));
          urlMap[key] = `/files/img/${imgFilename}`;
        }

        contentList = applyImageUrls(contentList, urlMap);

        for (const [key, url] of Object.entries(urlMap)) {
          markdown = markdown.replaceAll(`images/${key}`, url);
        }
      }
    }
  }

  if (!markdown) {
    markdown = JSON.stringify(json, null, 2);
  }

  return { markdown, contentList, pages, raw: json };
}

export async function parseFile(
  filePath: string,
  originalName: string,
  options: ParseOptions = {},
): Promise<ParseResult> {
  const mineruUrl = options.mineru_url || DEFAULT_MINERU_URL;

  const form = buildForm(filePath, originalName, options);
  const json = await submitAndPoll(mineruUrl, form, options.onProgress);
  return extractResults(json, filePath);
}
