import { z } from "@hono/zod-openapi";

export const ErrorSchema = z
  .object({
    error: z.string(),
  })
  .openapi("Error");

export const TaskStatusSchema = z
  .enum(["pending", "processing", "completed", "failed"])
  .openapi("TaskStatus");

export const ContentBlockSchema = z
  .object({
    type: z.string(),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    text: z.string().optional(),
    text_level: z.number().optional(),
    page_idx: z.number().optional(),
    img_path: z.string().optional(),
    img_url: z.string().optional(),
    table_body: z.string().optional(),
    list_items: z.array(z.string()).optional(),
  })
  .openapi("ContentBlock");

export const PageSizeSchema = z
  .object({
    width: z.number(),
    height: z.number(),
  })
  .openapi("PageSize");

export const TaskSchema = z
  .object({
    id: z.string().uuid(),
    filename: z.string(),
    original_name: z.string(),
    status: TaskStatusSchema,
    source: z.enum(["web", "api"]),
    backend: z.string(),
    lang: z.string(),
    result_md: z.string().nullable(),
    content_list: z.array(ContentBlockSchema).nullable(),
    pages: z.array(PageSizeSchema).nullable(),
    progress: z.string().nullable().optional(),
    error: z.string().nullable(),
    created_at: z.string(),
    completed_at: z.string().nullable(),
    file_size: z.number(),
    user_id: z.string().nullable().optional(),
  })
  .openapi("Task");

export const TaskSummarySchema = z
  .object({
    id: z.string().uuid(),
    filename: z.string(),
    original_name: z.string(),
    status: TaskStatusSchema,
    source: z.enum(["web", "api"]),
    backend: z.string(),
    lang: z.string(),
    progress: z.string().nullable().optional(),
    error: z.string().nullable(),
    created_at: z.string(),
    completed_at: z.string().nullable(),
    file_size: z.number(),
    snippet: z.string().nullable().optional(),
  })
  .openapi("TaskSummary");

export const PaginationSchema = z
  .object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    pages: z.number(),
  })
  .openapi("Pagination");

export const TaskListSchema = z
  .object({
    tasks: z.array(TaskSummarySchema),
    pagination: PaginationSchema,
  })
  .openapi("TaskList");

export const TaskCreatedSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(["pending", "completed"]),
    message: z.string(),
  })
  .openapi("TaskCreated");

export const SyncResultSchema = z
  .object({
    id: z.string().uuid(),
    status: z.literal("completed"),
    markdown: z.string(),
    content_list: z.array(ContentBlockSchema),
    pages: z.array(PageSizeSchema),
  })
  .openapi("SyncResult");

export const UploadRequestSchema = z
  .object({
    file: z.any(),
    backend: z
      .enum([
        "pipeline",
        "vlm-auto-engine",
        "hybrid-auto-engine",
        "vlm-http-client",
        "hybrid-http-client",
      ])
      .optional(),
    lang: z
      .enum(["ch", "en", "japan", "korean", "latin", "arabic", "cyrillic", "devanagari"])
      .optional(),
    parse_method: z.enum(["auto", "ocr", "txt"]).optional(),
    formula_enable: z.enum(["true", "false"]).optional(),
    table_enable: z.enum(["true", "false"]).optional(),
    auto_rotate: z.enum(["true", "false"]).optional(),
    mineru_url: z.string().optional(),
  })
  .openapi("UploadRequest", {
    description: "Upload a PDF, image (PNG/JPG/TIFF/BMP/GIF), DOCX, XLSX, XLS, PPTX, or CSV file.",
  });

export const ApiParseRequestSchema = z
  .object({
    file: z.any(),
    backend: z
      .enum([
        "pipeline",
        "vlm-auto-engine",
        "hybrid-auto-engine",
        "vlm-http-client",
        "hybrid-http-client",
      ])
      .optional(),
    lang_list: z.union([z.string(), z.array(z.string())]).optional(),
    parse_method: z.enum(["auto", "ocr", "txt"]).optional(),
    formula_enable: z.enum(["true", "false"]).optional(),
    table_enable: z.enum(["true", "false"]).optional(),
    start_page_id: z.string().optional(),
    end_page_id: z.string().optional(),
    auto_rotate: z.enum(["true", "false"]).optional(),
    mineru_url: z.string().optional(),
  })
  .openapi("ApiParseRequest");

export const UpdateTaskRequestSchema = z
  .object({
    result_md: z.string().optional(),
    content_list: z.array(ContentBlockSchema).optional(),
  })
  .openapi("UpdateTaskRequest");

export const ReprocessRequestSchema = z
  .object({
    rotate: z.number().optional(),
    rotate_pages: z.array(z.number()).optional(),
    rotations: z.record(z.string(), z.number()).optional(),
    page_indices: z.array(z.number()).optional(),
    backend: z.string().optional(),
    lang: z.string().optional(),
    parse_method: z.string().optional(),
    formula_enable: z.boolean().optional(),
    table_enable: z.boolean().optional(),
    auto_rotate: z.boolean().optional(),
    mineru_url: z.string().optional(),
  })
  .openapi("ReprocessRequest");

export const BatchDeleteRequestSchema = z.object({ ids: z.array(z.string().uuid()) });
export const ApiKeyCreateRequestSchema = z.object({ name: z.string().optional() });
