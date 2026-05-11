export interface ContentBlock {
  type: string;
  bbox: [number, number, number, number];
  text?: string;
  text_level?: number;
  page_idx?: number;
  img_path?: string;
  img_url?: string;
  table_body?: string;
  list_items?: string[];
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
  progress: string | null; // JSON: { state, percent?, message? }
  error: string | null;
  created_at: string;
  completed_at: string | null;
  file_size: number;
  snippet?: string | null;
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

async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    credentials: "include",
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  return res;
}

export async function uploadFile(file: File, options: UploadOptions): Promise<{ id: string }> {
  const form = new FormData();
  form.append("file", file);
  if (options.backend) form.append("backend", options.backend);
  if (options.lang) form.append("lang", options.lang);
  if (options.parse_method) form.append("parse_method", options.parse_method);
  if (options.formula_enable !== undefined)
    form.append("formula_enable", String(options.formula_enable));
  if (options.table_enable !== undefined) form.append("table_enable", String(options.table_enable));
  if (options.auto_rotate) form.append("auto_rotate", "true");
  if (options.mineru_url) form.append("mineru_url", options.mineru_url);

  const res = await apiFetch("/upload", { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getTasks(
  page = 1,
  limit = 20,
  source?: string,
  search?: string,
): Promise<TaskListResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (source) params.set("source", source);
  if (search) params.set("search", search);
  const res = await apiFetch(`/tasks?${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getTask(id: string): Promise<OcrTask> {
  const res = await apiFetch(`/tasks/${id}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteTask(id: string): Promise<void> {
  const res = await apiFetch(`/tasks/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export async function batchDeleteTasks(ids: string[]): Promise<{ deleted: number }> {
  const res = await apiFetch("/tasks/batch-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateTaskContent(
  id: string,
  updates: { result_md?: string; content_list?: ContentBlock[] },
): Promise<OcrTask> {
  const res = await apiFetch(`/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface ReprocessOptions {
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
}

export async function reprocessTask(
  id: string,
  options: ReprocessOptions = {},
): Promise<{ id: string; status: string; message: string }> {
  const res = await apiFetch(`/tasks/${id}/reprocess`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// API Key management
export interface ApiKey {
  id: string;
  key_prefix: string;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
}

export async function listApiKeys(): Promise<ApiKey[]> {
  const res = await apiFetch("/api/api-keys");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createApiKey(name?: string): Promise<{ key: string; prefix: string }> {
  const res = await apiFetch("/api/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function revokeApiKey(id: string): Promise<void> {
  const res = await apiFetch(`/api/api-keys/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}
