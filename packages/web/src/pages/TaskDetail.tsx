import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Allotment } from "allotment";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { ArrowLeft, Copy, Check, Loader2, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { getTask, fileUrl, type ContentBlock } from "../api.ts";
import { cn } from "@/lib/utils";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border transition-colors",
        copied
          ? "bg-success text-white border-success"
          : "bg-white text-muted-foreground border-border hover:bg-muted"
      )}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied!" : label}
    </button>
  );
}

const TYPE_COLORS: Record<string, string> = {
  text: "#3b82f6", title: "#ef4444", table: "#22c55e",
  figure: "#a855f7", image: "#a855f7",
  formula: "#f59e0b", interline_equation: "#f59e0b",
};

function typeColor(type: string): string {
  return TYPE_COLORS[type] || "#6b7280";
}

// ---- Image overlay (unchanged) ----

interface ImageOverlayProps {
  src: string;
  blocks: ContentBlock[];
  activeIndex: number | null;
  onHover: (i: number | null) => void;
  onClick: (i: number) => void;
}

function ImageOverlay({ src, blocks, activeIndex, onHover, onClick }: ImageOverlayProps) {
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
        contentStyle={{ width: "100%" }}
      >
        <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto", display: "block" }}>
          <image href={src} x={0} y={0} width={w} height={h} />
          {blocks.map((block, i) => {
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
}

function PdfViewer({ src, blocks, activeIndex, onHover, onClick, pageWidths, pageHeights }: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const onDocumentLoadSuccess = ({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    setCurrentPage(1);
  };

  const onPageLoadSuccess = (page: { width: number; height: number }) => {
    setPageSize({ w: page.width, h: page.height });
  };

  // Filter blocks for current page
  const pageBlocks = blocks.filter((b) => (b.page_idx ?? 0) === currentPage - 1);

  // Get page dimensions from task metadata or rendered page
  const pw = pageWidths?.[currentPage - 1];
  const ph = pageHeights?.[currentPage - 1];
  const overlayW = pw || pageSize?.w || 1;
  const overlayH = ph || pageSize?.h || 1;

  // Container width for responsive sizing
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
      {/* Page navigation */}
      {numPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-1.5 px-3 bg-slate-50 border-b border-border shrink-0">
          <button
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((p) => p - 1)}
            className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-muted-foreground min-w-[60px] text-center">
            {currentPage} / {numPages}
          </span>
          <button
            disabled={currentPage >= numPages}
            onClick={() => setCurrentPage((p) => p + 1)}
            className="p-1 rounded hover:bg-muted disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            className="ml-2 p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
            title="Download PDF"
          >
            <Download className="w-4 h-4" />
          </a>
        </div>
      )}

      {/* PDF page + overlay */}
      <div className="flex-1 overflow-auto">
        <Document file={src} onLoadSuccess={onDocumentLoadSuccess} loading={
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading PDF...
          </div>
        }>
          <div className="relative inline-block">
            <Page
              pageNumber={currentPage}
              width={containerWidth}
              onLoadSuccess={onPageLoadSuccess}
              renderTextLayer={false}
              renderAnnotationLayer={false}
            />
            {/* Bbox overlay on top of PDF page */}
            {pageBlocks.length > 0 && pageSize && (
              <svg
                className="absolute top-0 left-0"
                width={containerWidth}
                height={containerWidth * (overlayH / overlayW)}
                viewBox={`0 0 ${overlayW} ${overlayH}`}
                style={{ pointerEvents: "none" }}
              >
                {pageBlocks.map((block, _ri) => {
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

// ---- Main component ----

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "text-muted-foreground" },
  processing: { label: "Processing", className: "text-warning" },
  completed: { label: "Completed", className: "text-success" },
  failed: { label: "Failed", className: "text-destructive" },
};

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const [task, setTask] = useState<Awaited<ReturnType<typeof getTask>> | null>(null);
  const [error, setError] = useState("");
  const [activeBlock, setActiveBlock] = useState<number | null>(null);
  const blockRefs = useRef<Map<number, HTMLDivElement>>(new Map());

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

  const scrollToBlock = useCallback((i: number) => {
    blockRefs.current.get(i)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const handleHover = useCallback((i: number | null) => {
    setActiveBlock(i);
    if (i !== null) scrollToBlock(i);
  }, [scrollToBlock]);

  if (error) return <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-destructive text-sm">{error}</div>;
  if (!task) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading...</div>;

  const isProcessing = task.status === "pending" || task.status === "processing";
  const blocks = (task.content_list || []).filter((b) => b.type !== "discarded");
  const isImage = /\.(png|jpe?g|gif|bmp|tiff)$/i.test(task.filename);
  const isPdf = /\.pdf$/i.test(task.filename);
  const status = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;

  const pageWidths = task.pages?.map((p) => p.width);
  const pageHeights = task.pages?.map((p) => p.height);

  return (
    <div>
      <div className="mb-5">
        <Link to="/history" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors mb-2">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        <h2 className="text-xl font-semibold break-all">{task.original_name}</h2>
        <div className="flex flex-wrap items-center gap-2 mt-1.5 text-sm">
          <span className={cn("font-medium", status.className)}>{status.label}</span>
          <span className={cn(
            "px-2 py-0.5 rounded-full text-[11px] font-semibold",
            task.source === "web" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
          )}>{task.source.toUpperCase()}</span>
          <span className="text-muted-foreground">{task.backend}</span>
          <span className="text-muted-foreground">Lang: {task.lang}</span>
          {blocks.length > 0 && <span className="text-muted-foreground">{blocks.length} regions</span>}
        </div>
      </div>

      {isProcessing && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg mb-4">
          <Loader2 className="w-5 h-5 text-warning animate-spin" />
          <span className="text-sm">Processing...</span>
        </div>
      )}

      {task.status === "failed" && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-destructive text-sm mb-4">{task.error}</div>
      )}

      {task.status === "completed" && (
        <div className="h-[calc(100vh-200px)] min-h-[500px] border border-border rounded-lg overflow-hidden bg-white">
          <Allotment defaultSizes={[50, 50]}>
            <Allotment.Pane minSize={250}>
              <div className="flex flex-col h-full">
                <div className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground bg-muted border-b border-border shrink-0">
                  Original Document
                </div>
                <div className="flex-1 overflow-auto relative">
                  {isImage ? (
                    <ImageOverlay src={fileUrl(task.filename)} blocks={blocks}
                      activeIndex={activeBlock} onHover={handleHover}
                      onClick={(i) => { setActiveBlock(i); scrollToBlock(i); }}
                    />
                  ) : isPdf ? (
                    <PdfViewer src={fileUrl(task.filename)} blocks={blocks}
                      activeIndex={activeBlock} onHover={handleHover}
                      onClick={(i) => { setActiveBlock(i); scrollToBlock(i); }}
                      pageWidths={pageWidths} pageHeights={pageHeights}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                      <a href={fileUrl(task.filename)} target="_blank" rel="noreferrer" className="text-primary hover:underline">Download file</a>
                    </div>
                  )}
                </div>
              </div>
            </Allotment.Pane>

            <Allotment.Pane minSize={250}>
              <div className="flex flex-col h-full">
                <div className="px-4 py-2 text-xs font-semibold uppercase text-muted-foreground bg-muted border-b border-border shrink-0 flex items-center justify-between">
                  Parsed Result
                  <CopyButton text={task.result_md || ""} label="Copy MD" />
                </div>
                <div className="flex-1 overflow-auto p-4">
                  {blocks.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      {blocks.map((block, i) => (
                        <div
                          key={i}
                          ref={(el) => { if (el) blockRefs.current.set(i, el); }}
                          className={cn(
                            "p-3 rounded-md border transition-all",
                            activeBlock === i
                              ? "bg-blue-50 border-primary shadow-[0_0_0_1px] shadow-primary"
                              : "border-border hover:bg-blue-50/50 hover:border-primary/50"
                          )}
                          onMouseEnter={() => setActiveBlock(i)}
                          onMouseLeave={() => setActiveBlock(null)}
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold text-white shrink-0"
                              style={{ background: typeColor(block.type) }}
                            >{i + 1}</span>
                            <span className={cn(
                              "px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase",
                              `block-type-${block.type}`
                            )}>
                              {block.type}{block.text_level ? ` h${block.text_level}` : ""}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-mono opacity-60">
                              [{block.bbox.join(", ")}]
                            </span>
                            {block.text && (
                              <span className="ml-auto">
                                <CopyButton text={block.text} />
                              </span>
                            )}
                          </div>
                          <div className="text-sm leading-relaxed rendered-md">
                            {block.type === "image" ? (
                              block.img_url ? (
                                <img src={block.img_url} alt={block.img_path || "extracted image"}
                                  className="max-w-full h-auto rounded" />
                              ) : <em className="text-muted-foreground">(image region)</em>
                            ) : (
                              <Markdown remarkPlugins={[remarkGfm]}>{block.text || ""}</Markdown>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : task.result_md ? (
                    <div className="rendered-md"><Markdown remarkPlugins={[remarkGfm]}>{task.result_md}</Markdown></div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">No result</div>
                  )}
                </div>
              </div>
            </Allotment.Pane>
          </Allotment>
        </div>
      )}
    </div>
  );
}
