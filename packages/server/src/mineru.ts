import sharp from "sharp";
import { PDFDocument, degrees } from "pdf-lib";
import * as mupdf from "mupdf";
import { extname, dirname, join } from "path";
import { mkdirSync } from "fs";
import { v4 as uuid } from "uuid";
import type { ContentBlock } from "./db.ts";

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
  auto_rotate?: boolean;
  mineru_url?: string;
}

export interface ParseResult {
  markdown: string;
  contentList: ContentBlock[];
  pages: { width: number; height: number }[];
  raw: unknown;
}

const ROTATION_CANDIDATES = [0, 90, 180, 270] as const;
const PROBE_MAX = 800;

/**
 * Send a small image to MineRU and return the length of recognized text.
 */
async function probeMineru(buf: Buffer, filename: string, mineruUrl: string): Promise<number> {
  try {
    const blob = new Blob([buf], { type: "image/png" });
    const form = new FormData();
    form.append("files", blob, filename);
    form.append("return_md", "true");
    form.append("backend", "pipeline");

    const res = await fetch(`${mineruUrl}/file_parse`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return 0;

    const json = (await res.json()) as Record<string, unknown>;
    const results = json.results as Record<string, Record<string, unknown>> | undefined;
    if (!results) return 0;

    let totalLen = 0;
    for (const entry of Object.values(results)) {
      totalLen += String(entry.md_content || "").trim().length;
    }
    return totalLen;
  } catch {
    return 0;
  }
}

/**
 * Try all 4 orientations via MineRU, pick the one that produces the most text.
 */
async function detectBestRotation(buf: Buffer, mineruUrl: string, label = "image"): Promise<number> {
  let thumb = buf;
  const meta = await sharp(buf).metadata();
  console.log(`[auto-rotate] ${label} input: ${meta.width}x${meta.height}, ${buf.length} bytes`);

  if ((meta.width ?? 0) > PROBE_MAX || (meta.height ?? 0) > PROBE_MAX) {
    thumb = await sharp(buf).resize({ width: PROBE_MAX, height: PROBE_MAX, fit: "inside" }).png().toBuffer();
    const thumbMeta = await sharp(thumb).metadata();
    console.log(`[auto-rotate] ${label} thumbnail: ${thumbMeta.width}x${thumbMeta.height}`);
  }

  const probes = await Promise.all(
    ROTATION_CANDIDATES.map(async (angle) => {
      const rotated = angle === 0 ? thumb : await sharp(thumb).rotate(angle).toBuffer();
      const score = await probeMineru(rotated, `probe_${angle}.png`, mineruUrl);
      return { angle, score };
    })
  );

  for (const p of probes) {
    console.log(`[auto-rotate] ${label} angle=${p.angle}° score=${p.score}`);
  }

  let bestAngle = 0;
  let bestScore = -1;
  for (const p of probes) {
    if (p.score > bestScore) {
      bestScore = p.score;
      bestAngle = p.angle;
    }
  }
  console.log(`[auto-rotate] ${label} → best angle=${bestAngle}° (score=${bestScore})`);
  return bestAngle;
}

/**
 * Auto-rotate an image:
 * 1. EXIF rotation via sharp
 * 2. Probe MineRU at 0/90/180/270, pick best orientation
 */
async function autoRotateImage(filePath: string, mineruUrl: string): Promise<void> {
  const buf = await Bun.file(filePath).arrayBuffer();
  let corrected = await sharp(Buffer.from(buf)).rotate().toBuffer();

  const angle = await detectBestRotation(corrected, mineruUrl);
  if (angle > 0) {
    corrected = await sharp(corrected).rotate(angle).toBuffer();
  }

  await Bun.write(filePath, corrected);
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
 * 1. Render first page to image via mupdf (real pixels, not metadata)
 * 2. Probe MineRU at 0/90/180/270 using image rotation (proven approach)
 * 3. If rotation needed, render all pages → rotate with sharp → rebuild PDF with pdf-lib
 */
async function autoRotatePdf(filePath: string, mineruUrl: string): Promise<void> {
  const pdfBytes = await Bun.file(filePath).arrayBuffer();

  // Step 1: Render first page to image and detect best rotation
  const firstPageImg = renderPdfPageToImage(pdfBytes, 0);
  const angle = await detectBestRotation(firstPageImg, mineruUrl, "pdf");
  if (angle === 0) return;

  console.log(`[auto-rotate] pdf: rotating all pages by ${angle}°`);

  // Step 2: Render all pages, rotate, rebuild PDF
  const doc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
  const numPages = doc.countPages();
  const matrix = mupdf.Matrix.scale(PDF_RENDER_SCALE, PDF_RENDER_SCALE);

  const newPdf = await PDFDocument.create();

  for (let i = 0; i < numPages; i++) {
    const page = doc.loadPage(i);
    const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
    const png = pixmap.asPNG();

    // Rotate with sharp (actual pixel rotation)
    const rotated = await sharp(Buffer.from(png)).rotate(angle).jpeg({ quality: 90 }).toBuffer();

    // Embed into new PDF
    const img = await newPdf.embedJpg(rotated);
    const newPage = newPdf.addPage([img.width, img.height]);
    newPage.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });

    console.log(`[auto-rotate] pdf: page ${i + 1}/${numPages} done (${img.width}x${img.height})`);
  }

  const rotatedBytes = await newPdf.save();
  await Bun.write(filePath, rotatedBytes);
}

/**
 * Auto-rotate entry point: handles both images and PDFs.
 */
async function autoRotateFile(filePath: string, mineruUrl: string): Promise<void> {
  const ext = extname(filePath).toLowerCase();
  if (IMAGE_EXTS.has(ext)) {
    await autoRotateImage(filePath, mineruUrl);
  } else if (ext === ".pdf") {
    await autoRotatePdf(filePath, mineruUrl);
  }
}

/**
 * Manually rotate a file by a specific angle.
 * For images: rotate with sharp.
 * For PDFs: render pages to images, rotate specified pages, rebuild PDF.
 */
export async function rotateFile(filePath: string, angle: number, pageIndices?: number[]): Promise<void> {
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

    // Which pages to rotate (default: all)
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

export async function parseFile(
  filePath: string,
  originalName: string,
  options: ParseOptions = {}
): Promise<ParseResult> {
  const mineruUrl = options.mineru_url || DEFAULT_MINERU_URL;

  // Pre-process: auto-rotate if enabled
  if (options.auto_rotate) {
    await autoRotateFile(filePath, mineruUrl);
  }
  const form = new FormData();

  const fileBlob = Bun.file(filePath);
  form.append("files", fileBlob, originalName);
  form.append("return_md", "true");
  form.append("return_content_list", "true");
  form.append("return_middle_json", "true");
  form.append("return_images", "true");
  form.append("backend", options.backend || "pipeline");

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

  const res = await fetch(`${mineruUrl}/file_parse`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(600_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MineRU returned ${res.status}: ${text}`);
  }

  const json = (await res.json()) as Record<string, unknown>;

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
      // Parse content_list (may be string or array)
      const cl = typeof entry.content_list === "string"
        ? JSON.parse(entry.content_list)
        : entry.content_list;
      if (Array.isArray(cl)) {
        contentList = contentList.concat(cl as ContentBlock[]);
      }

      // Extract page_size from middle_json
      const mj = typeof entry.middle_json === "string"
        ? JSON.parse(entry.middle_json)
        : entry.middle_json;
      if (mj?.pdf_info && Array.isArray(mj.pdf_info)) {
        for (const page of mj.pdf_info) {
          if (page.page_size) {
            pages.push({ width: page.page_size[0], height: page.page_size[1] });
          }
        }
      }

      // Extract images: save to disk and set URL references
      const images = entry.images as Record<string, string> | undefined;
      if (images && typeof images === "object") {
        const uploadDir = dirname(filePath);
        const imgDir = join(uploadDir, "img");
        mkdirSync(imgDir, { recursive: true });

        // Save each base64 image to disk and build URL map
        const urlMap: Record<string, string> = {};
        for (const [key, dataUri] of Object.entries(images)) {
          // dataUri is like "data:image/jpeg;base64,..."
          const match = dataUri.match(/^data:image\/(\w+);base64,(.+)$/);
          if (!match) continue;
          const imgExt = match[1] === "jpeg" ? "jpg" : match[1];
          const imgFilename = `${uuid()}.${imgExt}`;
          const imgPath = join(imgDir, imgFilename);
          await Bun.write(imgPath, Buffer.from(match[2]!, "base64"));
          urlMap[key] = `/files/img/${imgFilename}`;
        }

        // Set img_url on content_list image blocks
        for (const block of contentList) {
          if (block.img_path) {
            const key = block.img_path.replace(/^images\//, "");
            if (urlMap[key]) {
              block.img_url = urlMap[key];
            }
          }
        }

        // Replace markdown image paths with URLs
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
