export interface ContentBlock {
  type: string;
  bbox: [number, number, number, number];
  text?: string;
  text_level?: number;
  page_idx?: number;
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

export async function uploadFile(
  file: File,
  options: { backend?: string; lang?: string; parse_method?: string }
): Promise<{ id: string }> {
  const form = new FormData();
  form.append("file", file);
  if (options.backend) form.append("backend", options.backend);
  if (options.lang) form.append("lang", options.lang);
  if (options.parse_method) form.append("parse_method", options.parse_method);

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
