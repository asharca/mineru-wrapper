import sharp from "sharp";
import { PDFDocument, degrees } from "pdf-lib";
import * as mupdf from "mupdf";
import { extname, dirname, join } from "path";
import { mkdirSync, unlinkSync } from "fs";
import { v4 as uuid } from "uuid";
import type { ContentBlock } from "./db.ts";

const DEFAULT_MINERU_URL = process.env.MINERU_URL || "http://10.0.10.2:8001";
const PADDLEOCR_URL = process.env.PADDLEOCR_URL || "http://localhost:8000";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".gif"]);
const OFFICE_EXTS = new Set([".xlsx", ".xls", ".docx", ".pptx"]);

export interface ParseOptions {
  backend?: string;
  lang_list?: string[];
  parse_method?: string;
  formula_enable?: boolean;
  table_enable?: boolean;
  start_page_id?: number;
  end_page_id?: number;
  auto_rotate?: boolean;
  mineru_url?: string;
  onProgress?: (progress: { state: string; message?: string }) => void;
}

export interface ParseResult {
  markdown: string;
  contentList: ContentBlock[];
  pages: { width: number; height: number }[];
  raw: unknown;
}

/** Max dimension for probe thumbnails */
const PROBE_MAX = 800;

/** Timeout for PaddleOCR service: 30s base + 15s per image */
function paddleTimeoutMs(count: number): number {
  return Math.max(30000, count * 15000);
}

/**
 * Detect best rotation angles for a batch of images via the PaddleOCR HTTP service.
 * Sends binary image data; no local file paths needed.
 */
async function detectRotationsHttp(imageBuffers: Buffer[]): Promise<number[]> {
  if (imageBuffers.length === 0) return [];

  const form = new FormData();
  for (let i = 0; i < imageBuffers.length; i++) {
    const blob = new Blob([imageBuffers[i]], { type: "image/png" });
    form.append("files", blob, `probe_${i}.png`);
  }

  try {
    const res = await fetch(`${PADDLEOCR_URL}/detect`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(paddleTimeoutMs(imageBuffers.length)),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[auto-rotate] PaddleOCR service error ${res.status}: ${text}`);
      return imageBuffers.map(() => 0);
    }

    const json = (await res.json()) as { angles?: number[] };
    if (Array.isArray(json.angles) && json.angles.length === imageBuffers.length) {
      return json.angles;
    }
    console.error("[auto-rotate] Unexpected PaddleOCR response:", json);
    return imageBuffers.map(() => 0);
  } catch (e) {
    console.error("[auto-rotate] PaddleOCR request failed:", e);
    return imageBuffers.map(() => 0);
  }
}

/**
 * Auto-rotate an image:
 * 1. Apply EXIF rotation via sharp
 * 2. Send thumbnail to PaddleOCR service for direction detection
 * 3. Rotate original image if needed
 */
async function autoRotateImage(filePath: string): Promise<void> {
  const buf = await Bun.file(filePath).arrayBuffer();
  // Step 1: Apply EXIF rotation
  let corrected = await sharp(Buffer.from(buf)).rotate().toBuffer();

  // Step 2: Create thumbnail for direction detection
  const meta = await sharp(corrected).metadata();
  let thumb = corrected;
  if ((meta.width ?? 0) > PROBE_MAX || (meta.height ?? 0) > PROBE_MAX) {
    thumb = await sharp(corrected)
      .resize({ width: PROBE_MAX, height: PROBE_MAX, fit: "inside" })
      .png()
      .toBuffer();
  }

  const [angle] = await detectRotationsHttp([thumb]);
  console.log(`[auto-rotate] image -> angle=${angle}°`);

  // Step 3: Rotate original image if needed
  if (angle > 0) {
    corrected = await sharp(corrected).rotate(angle).toBuffer();
    await Bun.write(filePath, corrected);
  }
}

/** Scale factor for PDF rendering: 200 DPI (200/72 ≈ 2.78x) */
const PDF_RENDER_SCALE = 200 / 72;

/**
 * Render a PDF page to PNG buffer using mupdf WASM at 200 DPI.
 */
function renderPdfPageToImage(pdfBytes: ArrayBuffer, pageIndex: number): Buffer {
  const doc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
  const page = doc.loadPage(pageIndex);
  const matrix = mupdf.Matrix.scale(PDF_RENDER_SCALE, PDF_RENDER_SCALE);
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
  const png = pixmap.asPNG();
  return Buffer.from(png);
}

/**
 * Auto-rotate a scanned PDF:
 * 1. Render each page to image via mupdf
 * 2. Send all page images to PaddleOCR service for per-page direction detection
 * 3. Rebuild PDF: each page rotated to its best detected angle
 */
async function autoRotatePdf(filePath: string): Promise<void> {
  const pdfBytes = await Bun.file(filePath).arrayBuffer();
  const doc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
  const numPages = doc.countPages();

  // Step 1: Render all pages to PNG buffers
  const pageBuffers: Buffer[] = [];
  for (let i = 0; i < numPages; i++) {
    pageBuffers.push(renderPdfPageToImage(pdfBytes, i));
  }

  // Step 2: Detect best angle for each page independently
  const angles = await detectRotationsHttp(pageBuffers);

  const needsRotation = angles.some((a) => a !== 0);
  if (!needsRotation) {
    console.log(`[auto-rotate] pdf: no rotation needed for any page`);
    return;
  }

  console.log(
    `[auto-rotate] pdf page angles: ${angles.map((a, i) => `p${i + 1}=${a}°`).join(", ")}`
  );

  // Step 3: Rebuild PDF with per-page rotation
  const newPdf = await PDFDocument.create();

  for (let i = 0; i < numPages; i++) {
    const angle = angles[i];
    const pageBuf = pageBuffers[i];

    let imageData: Buffer;
    if (angle === 0) {
      imageData = pageBuf;
    } else {
      imageData = await sharp(pageBuf).rotate(angle).jpeg({ quality: 90 }).toBuffer();
    }

    const img = await newPdf.embedJpg(imageData);
    const newPage = newPdf.addPage([img.width, img.height]);
    newPage.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }

  const rotatedBytes = await newPdf.save();
  await Bun.write(filePath, rotatedBytes);
}

/**
 * Auto-rotate entry point: handles both images and PDFs.
 * Office files (.docx, .xlsx, .pptx) and CSV are skipped.
 */
async function autoRotateFile(filePath: string): Promise<void> {
  const ext = extname(filePath).toLowerCase();
  if (IMAGE_EXTS.has(ext)) {
    await autoRotateImage(filePath);
  } else if (ext === ".pdf") {
    await autoRotatePdf(filePath);
  }
  // .xlsx, .xls, .docx, .pptx, .csv — no rotation needed
}

/**
 * Manually rotate a file by a specific angle.
 * For images: rotate with sharp.
 * For PDFs: render pages to images, rotate specified pages, rebuild PDF.
 */
export async function rotateFile(
  filePath: string,
  angle: number,
  pageIndices?: number[]
): Promise<void> {
  const validAngles = [90, 180, 270];
  if (!validAngles.includes(angle)) return;

  const ext = extname(filePath).toLowerCase();

  if (IMAGE_EXTS.has(ext)) {
    const buf = await Bun.file(filePath).arrayBuffer();
    const rotated = await sharp(Buffer.from(buf)).rotate(angle).toBuffer();
    await Bun.write(filePath, rotated);
    console.log(`[rotate] image rotated ${angle}°`);
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
        console.log(`[rotate] pdf page ${i + 1}/${numPages} rotated ${angle}°`);
      } else {
        console.log(`[rotate] pdf page ${i + 1}/${numPages} kept`);
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
export async function extractPdfPages(
  filePath: string,
  pageIndices: number[]
): Promise<string> {
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

function cleanFile(path: string) {
  try {
    unlinkSync(path);
  } catch {
    /* ignore */
  }
}

function buildForm(
  filePath: string,
  originalName: string,
  options: ParseOptions
): FormData {
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
  if (options.table_enable !== undefined)
    form.append("table_enable", String(options.table_enable));
  if (options.start_page_id !== undefined)
    form.append("start_page_id", String(options.start_page_id));
  if (options.end_page_id !== undefined)
    form.append("end_page_id", String(options.end_page_id));

  return form;
}

const POLL_INTERVAL = 2000;
const POLL_TIMEOUT = 600_000;

type ProgressCallback = (progress: {
  state: string;
  message?: string;
}) => void;

async function submitAndPoll(
  mineruUrl: string,
  form: FormData,
  onProgress?: ProgressCallback
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

  const queuedAhead =
    typeof submitJson.queued_ahead === "number" ? submitJson.queued_ahead : 0;
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
      const qa =
        typeof statusJson.queued_ahead === "number"
          ? statusJson.queued_ahead
          : 0;
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
        throw new Error(
          `MineRU result fetch failed ${resultRes.status}: ${text}`
        );
      }
      return (await resultRes.json()) as Record<string, unknown>;
    }

    if (state === "failed" || state === "error") {
      const errMsg =
        statusJson.error || statusJson.message || "MineRU task failed";
      throw new Error(String(errMsg));
    }
  }

  throw new Error("MineRU task timed out");
}

async function extractResults(
  json: Record<string, unknown>,
  filePath: string
): Promise<ParseResult> {
  let markdown = "";
  let contentList: ContentBlock[] = [];
  let pages: { width: number; height: number }[] = [];

  const results = json.results as
    | Record<string, Record<string, unknown>>
    | undefined;

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
        typeof entry.middle_json === "string"
          ? JSON.parse(entry.middle_json)
          : entry.middle_json;
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
          if (!match) continue;
          const imgExt = match[1] === "jpeg" ? "jpg" : match[1];
          const imgFilename = `${uuid()}.${imgExt}`;
          const imgPath = join(imgDir, imgFilename);
          await Bun.write(imgPath, Buffer.from(match[2]!, "base64"));
          urlMap[key] = `/files/img/${imgFilename}`;
        }

        for (const block of contentList) {
          if (block.img_path) {
            const key = block.img_path.replace(/^images\//, "");
            if (urlMap[key]) {
              block.img_url = urlMap[key];
            }
          }
        }

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
  options: ParseOptions = {}
): Promise<ParseResult> {
  const mineruUrl = options.mineru_url || DEFAULT_MINERU_URL;

  if (options.auto_rotate) {
    await autoRotateFile(filePath);
  }

  const form = buildForm(filePath, originalName, options);
  const json = await submitAndPoll(mineruUrl, form, options.onProgress);
  return extractResults(json, filePath);
}
