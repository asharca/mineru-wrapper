import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { Allotment } from "allotment";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  ArrowLeft, Copy, Check, Loader2, ChevronLeft, ChevronRight,
  Download, FileText, LayoutList, PanelLeftClose, PanelLeft,
  RotateCw, Pencil, Save, X, RefreshCw, CheckCircle,
} from "lucide-react";
import {
  getTask, fileUrl, updateTaskContent, reprocessTask,
  type ContentBlock, type OcrTask,
} from "../api.ts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

// ---- Copy button ----

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <Tooltip>
      <TooltipTrigger>
        <Button
          variant={copied ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-6 px-2 text-[11px] gap-1",
            copied && "bg-success text-success-foreground hover:bg-success/90"
          )}
          onClick={handleCopy}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied!" : label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Copy to clipboard</TooltipContent>
    </Tooltip>
  );
}

// ---- Block type colors ----

const TYPE_COLORS: Record<string, string> = {
  text: "#3b82f6", title: "#ef4444", table: "#22c55e",
  figure: "#a855f7", image: "#a855f7",
  formula: "#f59e0b", interline_equation: "#f59e0b",
  list: "#0ea5e9",
};

function typeColor(type: string): string {
  return TYPE_COLORS[type] || "#6b7280";
}

// ---- Image overlay ----

interface ImageOverlayProps {
  src: string;
  blocks: ContentBlock[];
  activeIndex: number | null;
  onHover: (i: number | null) => void;
  onClick: (i: number) => void;
  rotation: number;
}

function ImageOverlay({ src, blocks, activeIndex, onHover, onClick, rotation }: ImageOverlayProps) {
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = src;
  }, [src]);

  if (!imgSize) return <div className="flex items-center justify-center h-full text-muted-foreground">Loading image...</div>;

  const { w, h } = imgSize;
  const sx = w / 1000;
  const sy = h / 1000;
  const labelW = Math.round(w * 0.02);
  const labelH = Math.round(h * 0.02);
  const fontSize = Math.round(Math.min(w, h) * 0.012);

  return (
    <TransformWrapper minScale={0.5} maxScale={8} initialScale={1} centerZoomedOut>
      <TransformComponent
        wrapperStyle={{ width: "100%", height: "100%", overflow: "auto" }}
        contentStyle={{ width: "100%", display: "flex", justifyContent: "center" }}
      >
        <svg
          viewBox={`0 0 ${w} ${h}`}
          style={{
            width: "100%", height: "auto", display: "block",
            transform: `rotate(${rotation}deg)`,
            transition: "transform 0.3s ease",
          }}
        >
          <image href={src} x={0} y={0} width={w} height={h} />
          {rotation === 0 && blocks.map((block, i) => {
            const [bx0, by0, bx1, by1] = block.bbox;
            const x0 = bx0 * sx, y0 = by0 * sy, x1 = bx1 * sx, y1 = by1 * sy;
            const isActive = activeIndex === i;
            const c = typeColor(block.type);
            return (
              <g key={i} style={{ cursor: "pointer" }}
                onMouseEnter={() => onHover(i)} onMouseLeave={() => onHover(null)} onClick={() => onClick(i)}
              >
                <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0}
                  fill={isActive ? `${c}33` : "transparent"}
                  stroke={c} strokeWidth={isActive ? 3 : 1.5} strokeOpacity={isActive ? 1 : 0.5} rx={2}
                />
                <rect x={x0} y={Math.max(0, y0 - labelH)} width={labelW} height={labelH} fill={c} rx={3} />
                <text x={x0 + labelW / 2} y={Math.max(0, y0 - labelH) + labelH / 2}
                  fill="white" fontSize={fontSize} fontWeight="bold" textAnchor="middle" dominantBaseline="central"
                >{i + 1}</text>
              </g>
            );
          })}
        </svg>
      </TransformComponent>
    </TransformWrapper>
  );
}

// ---- PDF viewer ----

interface PdfViewerProps {
  src: string;
  blocks: ContentBlock[];
  activeIndex: number | null;
  onHover: (i: number | null) => void;
  onClick: (i: number) => void;
  pageWidths?: number[];
  pageHeights?: number[];
  currentPage: number;
  onPageChange: (page: number) => void;
  pageRotation: number;
  onRotate: () => void;
  onConfirmRotate: () => void;
  rotating: boolean;
}

function PdfViewer({
  src, blocks, activeIndex, onHover, onClick,
  pageWidths, pageHeights, currentPage, onPageChange,
  pageRotation, onRotate, onConfirmRotate, rotating,
}: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const onDocumentLoadSuccess = ({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
  };

  const onPageLoadSuccess = (page: { width: number; height: number }) => {
    setPageSize({ w: page.width, h: page.height });
  };

  const pageBlocks = blocks.filter((b) => (b.page_idx ?? 0) === currentPage - 1);

  const pw = pageWidths?.[currentPage - 1];
  const ph = pageHeights?.[currentPage - 1];
  const overlayW = pw || pageSize?.w || 1;
  const overlayH = ph || pageSize?.h || 1;

  const [containerWidth, setContainerWidth] = useState(600);
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) setContainerWidth(e.contentRect.width);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  return (
    <div className="flex flex-col h-full" ref={containerRef}>
      {numPages > 0 && (
        <div className="flex items-center justify-center gap-1.5 py-1.5 px-3 bg-muted/50 border-b shrink-0 flex-wrap">
          {numPages > 1 && (
            <>
              <Button variant="ghost" size="icon" className="h-7 w-7"
                disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums min-w-[60px] text-center">
                {currentPage} / {numPages}
              </span>
              <Button variant="ghost" size="icon" className="h-7 w-7"
                disabled={currentPage >= numPages} onClick={() => onPageChange(currentPage + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Separator orientation="vertical" className="h-4 mx-1" />
            </>
          )}

          {/* Rotate preview button */}
          <Tooltip>
            <TooltipTrigger>
              <Button
                variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground"
                onClick={onRotate} disabled={rotating}
              >
                <RotateCw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Rotate 90° (preview)</TooltipContent>
          </Tooltip>

          {/* Rotation indicator + confirm */}
          {pageRotation > 0 && (
            <>
              <Badge variant="outline" className="text-[11px] h-6 gap-1">
                {pageRotation}°
              </Badge>
              <Tooltip>
                <TooltipTrigger>
                  <Button
                    variant="default" size="sm"
                    className="h-7 px-2.5 gap-1 text-xs"
                    onClick={onConfirmRotate}
                    disabled={rotating}
                  >
                    {rotating
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <CheckCircle className="h-3.5 w-3.5" />
                    }
                    Re-OCR this page
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Rotate and re-recognize this page only</TooltipContent>
              </Tooltip>
            </>
          )}

          <Separator orientation="vertical" className="h-4 mx-1" />

          <Tooltip>
            <TooltipTrigger>
              <a href={src} target="_blank" rel="noreferrer">
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                  <Download className="h-4 w-4" />
                </Button>
              </a>
            </TooltipTrigger>
            <TooltipContent>Download PDF</TooltipContent>
          </Tooltip>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <Document file={src} onLoadSuccess={onDocumentLoadSuccess} loading={
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading PDF...
          </div>
        }>
          <div
            className="relative inline-block"
            style={{
              transform: `rotate(${pageRotation}deg)`,
              transition: "transform 0.3s ease",
              transformOrigin: "center center",
            }}
          >
            <Page
              pageNumber={currentPage}
              width={containerWidth}
              onLoadSuccess={onPageLoadSuccess}
              renderTextLayer={false}
              renderAnnotationLayer={false}
            />
            {/* Hide overlays when rotated (they won't match) */}
            {pageRotation === 0 && pageBlocks.length > 0 && pageSize && (
              <svg
                className="absolute top-0 left-0"
                width={containerWidth}
                height={containerWidth * (overlayH / overlayW)}
                viewBox={`0 0 ${overlayW} ${overlayH}`}
                style={{ pointerEvents: "none" }}
              >
                {pageBlocks.map((block) => {
                  const globalIdx = blocks.indexOf(block);
                  const [bx0, by0, bx1, by1] = block.bbox;
                  const sx = overlayW / 1000;
                  const sy = overlayH / 1000;
                  const x0 = bx0 * sx, y0 = by0 * sy, x1 = bx1 * sx, y1 = by1 * sy;
                  const isActive = activeIndex === globalIdx;
                  const c = typeColor(block.type);
                  const labelW = Math.round(overlayW * 0.02);
                  const labelH = Math.round(overlayH * 0.02);
                  const fs = Math.round(Math.min(overlayW, overlayH) * 0.012);
                  return (
                    <g key={globalIdx} style={{ cursor: "pointer", pointerEvents: "all" }}
                      onMouseEnter={() => onHover(globalIdx)} onMouseLeave={() => onHover(null)}
                      onClick={() => onClick(globalIdx)}
                    >
                      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0}
                        fill={isActive ? `${c}33` : "transparent"}
                        stroke={c} strokeWidth={isActive ? 3 : 1.5} strokeOpacity={isActive ? 1 : 0.5} rx={2}
                      />
                      <rect x={x0} y={Math.max(0, y0 - labelH)} width={labelW} height={labelH} fill={c} rx={3} />
                      <text x={x0 + labelW / 2} y={Math.max(0, y0 - labelH) + labelH / 2}
                        fill="white" fontSize={fs} fontWeight="bold" textAnchor="middle" dominantBaseline="central"
                      >{globalIdx + 1}</text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        </Document>
      </div>
    </div>
  );
}

// ---- Rendered document view ----

interface RenderedViewProps {
  blocks: ContentBlock[];
  resultMd: string | null;
  editing: boolean;
  editMd: string;
  onEditMdChange: (md: string) => void;
}

function RenderedView({ blocks, resultMd, editing, editMd, onEditMdChange }: RenderedViewProps) {
  if (editing) {
    return (
      <Textarea
        value={editMd}
        onChange={(e) => onEditMdChange(e.target.value)}
        className="min-h-[600px] font-mono text-sm leading-relaxed resize-none"
        placeholder="Edit markdown content..."
      />
    );
  }

  if (blocks.length === 0 && !resultMd) {
    return <div className="text-center py-12 text-muted-foreground">No result</div>;
  }

  if (resultMd) {
    return (
      <article className="rendered-md max-w-none prose-container">
        <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{resultMd}</Markdown>
      </article>
    );
  }

  return (
    <article className="rendered-md max-w-none prose-container">
      {blocks.map((block, i) => {
        if (block.type === "image") {
          return block.img_url ? (
            <figure key={i} className="my-4">
              <img src={block.img_url} alt={block.img_path || "extracted image"} className="max-w-full h-auto rounded-lg" />
            </figure>
          ) : null;
        }
        if (block.type === "table" && block.table_body) {
          return <div key={i} className="overflow-x-auto my-4" dangerouslySetInnerHTML={{ __html: block.table_body }} />;
        }
        if (block.type === "list" && block.list_items) {
          return (
            <ul key={i} className="list-disc pl-6 space-y-1 my-3">
              {block.list_items.map((item, li) => <li key={li}>{item}</li>)}
            </ul>
          );
        }
        return (
          <Markdown key={i} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
            {block.text || ""}
          </Markdown>
        );
      })}
    </article>
  );
}

// ---- Block view ----

interface BlockViewProps {
  blocks: ContentBlock[];
  activeBlock: number | null;
  blockRefs: React.RefObject<Map<number, HTMLDivElement>>;
  onBlockHover: (i: number | null) => void;
  editing: boolean;
  editBlocks: ContentBlock[];
  onEditBlock: (index: number, text: string) => void;
}

function BlockView({ blocks, activeBlock, blockRefs, onBlockHover, editing, editBlocks, onEditBlock }: BlockViewProps) {
  const displayBlocks = editing ? editBlocks : blocks;

  if (displayBlocks.length === 0) {
    return <div className="text-center py-12 text-muted-foreground">No regions detected</div>;
  }

  return (
    <div className="flex flex-col gap-1">
      {displayBlocks.map((block, i) => (
        <div
          key={i}
          ref={(el) => { if (el) blockRefs.current.set(i, el); }}
          className={cn(
            "px-4 py-3 rounded-lg border transition-all",
            activeBlock === i
              ? "bg-primary/5 border-primary/40 shadow-sm"
              : "border-transparent hover:bg-muted/50"
          )}
          onMouseEnter={() => onBlockHover(i)}
          onMouseLeave={() => onBlockHover(null)}
        >
          <div className="flex items-center gap-2 mb-1">
            <span
              className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold text-white shrink-0"
              style={{ background: typeColor(block.type) }}
            >{i + 1}</span>
            <Badge variant="secondary" className={cn(
              "text-[10px] font-semibold uppercase px-1.5 py-0",
              `block-type-${block.type}`
            )}>
              {block.type}{block.text_level ? ` h${block.text_level}` : ""}
            </Badge>
            {!editing && (block.text || block.list_items) && (
              <span className="ml-auto">
                <CopyButton text={block.text || (block.list_items ?? []).join("\n")} />
              </span>
            )}
          </div>

          <div className="text-sm leading-relaxed pl-7">
            {editing && (block.type === "text" || block.type === "title" || block.type === "formula" || block.type === "interline_equation") ? (
              <Textarea
                value={block.text || ""}
                onChange={(e) => onEditBlock(i, e.target.value)}
                className="min-h-[40px] text-sm resize-none"
                rows={Math.max(1, (block.text || "").split("\n").length)}
              />
            ) : editing && block.type === "list" && block.list_items ? (
              <Textarea
                value={block.list_items.join("\n")}
                onChange={(e) => onEditBlock(i, e.target.value)}
                className="min-h-[40px] text-sm resize-none"
                rows={Math.max(1, block.list_items.length)}
              />
            ) : (
              <div className="rendered-md">
                {block.type === "image" ? (
                  block.img_url ? (
                    <img src={block.img_url} alt={block.img_path || "extracted image"}
                      className="max-w-full h-auto rounded" />
                  ) : <em className="text-muted-foreground">(image region)</em>
                ) : block.type === "table" && block.table_body ? (
                  <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: block.table_body }} />
                ) : block.type === "list" && block.list_items ? (
                  <ul className="list-disc pl-5 space-y-1">
                    {block.list_items.map((item, li) => <li key={li}>{item}</li>)}
                  </ul>
                ) : (
                  <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{block.text || ""}</Markdown>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Status config ----

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pending", variant: "secondary" },
  processing: { label: "Processing", variant: "outline" },
  completed: { label: "Completed", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
};

// ---- Main component ----

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const [task, setTask] = useState<OcrTask | null>(null);
  const [error, setError] = useState("");
  const [activeBlock, setActiveBlock] = useState<number | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [viewMode, setViewMode] = useState<"document" | "blocks">("document");
  const [docPanelOpen, setDocPanelOpen] = useState(true);
  const blockRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editMd, setEditMd] = useState("");
  const [editBlocks, setEditBlocks] = useState<ContentBlock[]>([]);
  const [saving, setSaving] = useState(false);

  // Rotation preview state (client-side only, no server call)
  // For images: single rotation angle
  // For PDFs: per-page rotation angles
  const [imageRotation, setImageRotation] = useState(0);
  const [pageRotations, setPageRotations] = useState<Record<number, number>>({});
  const [rotating, setRotating] = useState(false);

  // Re-OCR dialog
  const [reprocessDialogOpen, setReprocessDialogOpen] = useState(false);

  // File version key to force reload after server-side rotation
  const [fileVersion, setFileVersion] = useState(0);

  // ---- Polling ----

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const t = await getTask(id);
        if (cancelled) return;
        setTask(t);
        if (t.status === "pending" || t.status === "processing") timer = setTimeout(poll, 2000);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      }
    };
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id]);

  const blocks = (task?.content_list || []).filter((b) => b.type !== "discarded");

  const scrollToBlock = useCallback((i: number) => {
    blockRefs.current.get(i)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const goToBlock = useCallback((i: number) => {
    setActiveBlock(i);
    setViewMode("blocks");
    scrollToBlock(i);
    const pageIdx = blocks[i]?.page_idx ?? 0;
    setPdfPage(pageIdx + 1);
  }, [scrollToBlock, blocks]);

  const handleHover = useCallback((i: number | null) => {
    setActiveBlock(i);
    if (i !== null && viewMode === "blocks") scrollToBlock(i);
  }, [scrollToBlock, viewMode]);

  const handleBlockHover = useCallback((i: number | null) => {
    setActiveBlock(i);
    if (i !== null) {
      const pageIdx = blocks[i]?.page_idx ?? 0;
      setPdfPage(pageIdx + 1);
    }
  }, [blocks]);

  // ---- Edit handlers ----

  const startEditing = () => {
    setEditMd(task?.result_md || "");
    setEditBlocks(blocks.map((b) => ({ ...b, list_items: b.list_items ? [...b.list_items] : undefined })));
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
  };

  const saveEdits = async () => {
    if (!task) return;
    setSaving(true);
    try {
      if (viewMode === "document") {
        const updated = await updateTaskContent(task.id, { result_md: editMd });
        setTask(updated);
      } else {
        const updated = await updateTaskContent(task.id, { content_list: editBlocks });
        setTask(updated);
      }
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleEditBlock = (index: number, text: string) => {
    setEditBlocks((prev) => {
      const next = [...prev];
      const block = { ...next[index] };
      if (block.type === "list") {
        block.list_items = text.split("\n");
      } else {
        block.text = text;
      }
      next[index] = block;
      return next;
    });
  };

  // ---- Rotation handlers (client-side preview only) ----

  const handleRotateImage = () => {
    setImageRotation((prev) => (prev + 90) % 360);
  };

  const handleRotatePdfPage = () => {
    const pageIdx = pdfPage - 1;
    setPageRotations((prev) => ({
      ...prev,
      [pageIdx]: ((prev[pageIdx] || 0) + 90) % 360,
    }));
  };

  const currentPageRotation = pageRotations[pdfPage - 1] || 0;

  // ---- Confirm rotation + re-OCR ----

  const pollUntilDone = useCallback(async (taskId: string) => {
    const t = await getTask(taskId);
    setTask(t);
    if (t.status === "pending" || t.status === "processing") {
      setTimeout(() => pollUntilDone(taskId), 2000);
    } else {
      setFileVersion((v) => v + 1);
      setRotating(false);
    }
  }, []);

  const confirmRotateImage = async () => {
    if (!task || imageRotation === 0) return;
    setRotating(true);
    setEditing(false);
    try {
      await reprocessTask(task.id, { rotate: imageRotation });
      setTask({ ...task, status: "processing" } as OcrTask);
      setImageRotation(0);
      setTimeout(() => pollUntilDone(task.id), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rotation failed");
      setRotating(false);
    }
  };

  const confirmRotatePdfPage = async () => {
    if (!task) return;
    const pageIdx = pdfPage - 1;
    const angle = pageRotations[pageIdx] || 0;
    if (angle === 0) return;

    setRotating(true);
    setEditing(false);
    try {
      await reprocessTask(task.id, {
        rotate: angle,
        rotate_pages: [pageIdx],
        page_index: pageIdx,
      });
      setTask({ ...task, status: "processing" } as OcrTask);
      // Clear this page's rotation preview
      setPageRotations((prev) => {
        const next = { ...prev };
        delete next[pageIdx];
        return next;
      });
      setTimeout(() => pollUntilDone(task.id), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rotation failed");
      setRotating(false);
    }
  };

  // Full re-OCR (no rotation)
  const handleReprocess = async () => {
    if (!task) return;
    setReprocessDialogOpen(false);
    setRotating(true);
    setEditing(false);
    try {
      await reprocessTask(task.id);
      setTask({ ...task, status: "processing" } as OcrTask);
      setTimeout(() => pollUntilDone(task.id), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reprocess failed");
      setRotating(false);
    }
  };

  // ---- Render ----

  if (error) return (
    <div className="p-6">
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    </div>
  );

  if (!task) return (
    <div className="flex items-center justify-center h-[calc(100vh-3.5rem)] text-muted-foreground gap-2">
      <Loader2 className="h-5 w-5 animate-spin" />
      Loading...
    </div>
  );

  const isProcessing = task.status === "pending" || task.status === "processing";
  const isImage = /\.(png|jpe?g|gif|bmp|tiff)$/i.test(task.filename);
  const isPdf = /\.pdf$/i.test(task.filename);
  const status = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;

  const pageWidths = task.pages?.map((p) => p.width);
  const pageHeights = task.pages?.map((p) => p.height);

  const fileSrc = fileUrl(task.filename) + `?v=${fileVersion}`;

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Compact top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-background shrink-0">
        <Link to="/history">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>

        <div className="flex items-center gap-2 min-w-0 flex-1">
          <h2 className="text-sm font-semibold truncate">{task.original_name}</h2>
          <Badge
            variant={status.variant}
            className={cn(
              "shrink-0",
              task.status === "processing" && "border-warning text-warning",
              task.status === "completed" && "border-success text-success bg-success/10"
            )}
          >
            {status.label}
          </Badge>
          <span className="text-xs text-muted-foreground shrink-0">{task.backend}</span>
          {blocks.length > 0 && (
            <span className="text-xs text-muted-foreground shrink-0">{blocks.length} regions</span>
          )}
        </div>

        <Separator orientation="vertical" className="h-5" />

        {/* View mode toggle */}
        <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
          <Button
            variant={viewMode === "document" ? "default" : "ghost"}
            size="sm" className="h-7 px-2.5 gap-1.5 text-xs"
            onClick={() => setViewMode("document")}
          >
            <FileText className="h-3.5 w-3.5" />
            Document
          </Button>
          <Button
            variant={viewMode === "blocks" ? "default" : "ghost"}
            size="sm" className="h-7 px-2.5 gap-1.5 text-xs"
            onClick={() => setViewMode("blocks")}
          >
            <LayoutList className="h-3.5 w-3.5" />
            Blocks
          </Button>
        </div>

        <Separator orientation="vertical" className="h-5" />

        {/* Edit / Save / Cancel */}
        {task.status === "completed" && !editing && (
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={startEditing}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        )}
        {editing && (
          <>
            <Button
              variant="default" size="sm" className="h-7 gap-1.5 text-xs"
              onClick={saveEdits} disabled={saving}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save
            </Button>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={cancelEditing}>
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
          </>
        )}

        {/* Re-OCR (full) */}
        {task.status === "completed" && !editing && (
          <Button
            variant="outline" size="sm" className="h-7 gap-1.5 text-xs"
            onClick={() => setReprocessDialogOpen(true)}
            disabled={rotating}
          >
            {rotating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Re-OCR
          </Button>
        )}

        {/* Toggle document panel */}
        <Button
          variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"
          onClick={() => setDocPanelOpen(!docPanelOpen)}
        >
          {docPanelOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
        </Button>

        {!editing && <CopyButton text={task.result_md || ""} label="Copy MD" />}
      </div>

      {/* Processing / error states */}
      {isProcessing && (
        <Alert className="mx-4 mt-3 border-warning/50 bg-warning/5">
          <Loader2 className="h-4 w-4 animate-spin text-warning" />
          <AlertDescription>Processing your document...</AlertDescription>
        </Alert>
      )}

      {task.status === "failed" && (
        <Alert variant="destructive" className="mx-4 mt-3">
          <AlertDescription>{task.error}</AlertDescription>
        </Alert>
      )}

      {/* Main content area */}
      {task.status === "completed" && (
        <div className="flex-1 overflow-hidden">
          {docPanelOpen ? (
            <Allotment defaultSizes={[35, 65]}>
              <Allotment.Pane minSize={200}>
                <div className="flex flex-col h-full border-r">
                  {/* Image toolbar */}
                  {isImage && (
                    <div className="flex items-center justify-center gap-1.5 py-1.5 px-3 bg-muted/50 border-b shrink-0">
                      <Tooltip>
                        <TooltipTrigger>
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground"
                            onClick={handleRotateImage} disabled={rotating}
                          >
                            <RotateCw className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Rotate 90° (preview)</TooltipContent>
                      </Tooltip>

                      {imageRotation > 0 && (
                        <>
                          <Badge variant="outline" className="text-[11px] h-6 gap-1">{imageRotation}°</Badge>
                          <Button
                            variant="default" size="sm" className="h-7 px-2.5 gap-1 text-xs"
                            onClick={confirmRotateImage} disabled={rotating}
                          >
                            {rotating
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <CheckCircle className="h-3.5 w-3.5" />
                            }
                            Re-OCR
                          </Button>
                        </>
                      )}

                      <Separator orientation="vertical" className="h-4 mx-1" />
                      <Tooltip>
                        <TooltipTrigger>
                          <a href={fileSrc} target="_blank" rel="noreferrer">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                              <Download className="h-4 w-4" />
                            </Button>
                          </a>
                        </TooltipTrigger>
                        <TooltipContent>Download image</TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                  <div className="flex-1 overflow-auto relative bg-muted/30">
                    {isImage ? (
                      <ImageOverlay src={fileSrc} blocks={blocks}
                        activeIndex={activeBlock} onHover={handleHover} onClick={goToBlock}
                        rotation={imageRotation}
                      />
                    ) : isPdf ? (
                      <PdfViewer src={fileSrc} blocks={blocks}
                        activeIndex={activeBlock} onHover={handleHover} onClick={goToBlock}
                        pageWidths={pageWidths} pageHeights={pageHeights}
                        currentPage={pdfPage} onPageChange={setPdfPage}
                        pageRotation={currentPageRotation}
                        onRotate={handleRotatePdfPage}
                        onConfirmRotate={confirmRotatePdfPage}
                        rotating={rotating}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                        <a href={fileSrc} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                          Download file
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </Allotment.Pane>

              <Allotment.Pane minSize={300}>
                <div className="h-full overflow-auto">
                  <div className={cn(
                    "mx-auto",
                    viewMode === "document" ? "max-w-3xl px-8 py-6" : "max-w-4xl px-4 py-3"
                  )}>
                    {viewMode === "document" ? (
                      <RenderedView
                        blocks={blocks} resultMd={task.result_md}
                        editing={editing} editMd={editMd} onEditMdChange={setEditMd}
                      />
                    ) : (
                      <BlockView
                        blocks={blocks} activeBlock={activeBlock} blockRefs={blockRefs}
                        onBlockHover={handleBlockHover}
                        editing={editing} editBlocks={editBlocks} onEditBlock={handleEditBlock}
                      />
                    )}
                  </div>
                </div>
              </Allotment.Pane>
            </Allotment>
          ) : (
            <div className="h-full overflow-auto">
              <div className={cn(
                "mx-auto",
                viewMode === "document" ? "max-w-3xl px-8 py-6" : "max-w-4xl px-4 py-3"
              )}>
                {viewMode === "document" ? (
                  <RenderedView
                    blocks={blocks} resultMd={task.result_md}
                    editing={editing} editMd={editMd} onEditMdChange={setEditMd}
                  />
                ) : (
                  <BlockView
                    blocks={blocks} activeBlock={activeBlock} blockRefs={blockRefs}
                    onBlockHover={handleBlockHover}
                    editing={editing} editBlocks={editBlocks} onEditBlock={handleEditBlock}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Re-OCR confirmation dialog */}
      <Dialog open={reprocessDialogOpen} onOpenChange={setReprocessDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-run OCR</DialogTitle>
            <DialogDescription>
              This will re-process the entire document. The current recognized content will be replaced with new results.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReprocessDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleReprocess}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
