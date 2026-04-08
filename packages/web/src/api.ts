export interface ContentBlock {
  type: string;
  bbox: [number, number, number, number];
  text?: string;
  text_level?: number;
  page_idx?: number;
  img_path?: string;
  img_data?: string;
}

export interface PageSize {
  width: number;
  height: number;
}

export interface OcrTask {
  id: string;
  filename: string;
  original_name: string;
  status: "pending" | "processing" | "completed" | "failed";
  source: "web" | "api";
  backend: string;
  lang: string;
  result_md: string | null;
  content_list: ContentBlock[] | null;
  pages: PageSize[] | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  file_size: number;
}

export interface TaskListResponse {
  tasks: OcrTask[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

export function fileUrl(filename: string): string {
  return `/files/${filename}`;
}

export interface UploadOptions {
  backend?: string;
  lang?: string;
  parse_method?: string;
  formula_enable?: boolean;
  table_enable?: boolean;
  auto_rotate?: boolean;
  mineru_url?: string;
}

export async function uploadFile(
  file: File,
  options: UploadOptions
): Promise<{ id: string }> {
  const form = new FormData();
  form.append("file", file);
  if (options.backend) form.append("backend", options.backend);
  if (options.lang) form.append("lang", options.lang);
  if (options.parse_method) form.append("parse_method", options.parse_method);
  if (options.formula_enable !== undefined) form.append("formula_enable", String(options.formula_enable));
  if (options.table_enable !== undefined) form.append("table_enable", String(options.table_enable));
  if (options.auto_rotate) form.append("auto_rotate", "true");
  if (options.mineru_url) form.append("mineru_url", options.mineru_url);

  const res = await fetch("/upload", { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getTasks(
  page = 1,
  limit = 20,
  source?: string
): Promise<TaskListResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (source) params.set("source", source);
  const res = await fetch(`/tasks?${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getTask(id: string): Promise<OcrTask> {
  const res = await fetch(`/tasks/${id}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteTask(id: string): Promise<void> {
  const res = await fetch(`/tasks/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}
