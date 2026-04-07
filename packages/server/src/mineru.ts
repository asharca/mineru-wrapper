import type { ContentBlock } from "./db.ts";

const MINERU_URL = process.env.MINERU_URL || "http://10.0.10.2:8001";

export interface ParseOptions {
  backend?: string;
  lang_list?: string[];
  parse_method?: string;
  formula_enable?: boolean;
  table_enable?: boolean;
  start_page_id?: number;
  end_page_id?: number;
}

export interface ParseResult {
  markdown: string;
  contentList: ContentBlock[];
  pages: { width: number; height: number }[];
  raw: unknown;
}

export async function parseFile(
  filePath: string,
  originalName: string,
  options: ParseOptions = {}
): Promise<ParseResult> {
  const form = new FormData();

  const fileBlob = Bun.file(filePath);
  form.append("files", fileBlob, originalName);
  form.append("return_md", "true");
  form.append("return_content_list", "true");
  form.append("return_middle_json", "true");
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

  const res = await fetch(`${MINERU_URL}/file_parse`, {
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
    }
  }

  if (!markdown) {
    markdown = JSON.stringify(json, null, 2);
  }

  return { markdown, contentList, pages, raw: json };
}
