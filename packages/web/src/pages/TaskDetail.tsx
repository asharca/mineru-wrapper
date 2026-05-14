import { Allotment } from "allotment";
import {
  ArrowLeft,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  LayoutList,
  Loader2,
  PanelLeft,
  PanelLeftClose,
  Pencil,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Link, useParams } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  type ContentBlock,
  fileUrl,
  getTask,
  type OcrTask,
  reprocessTask,
  updateTaskContent,
} from "../api.ts";
import { BlockView } from "../components/task-detail/BlockView.tsx";
import { CopyButton } from "../components/task-detail/CopyButton.tsx";
import { ImageOverlay } from "../components/task-detail/ImageOverlay.tsx";
import { PdfViewer } from "../components/task-detail/PdfViewer.tsx";
import { RenderedView } from "../components/task-detail/RenderedView.tsx";
import { useDebounce } from "../components/task-detail/utils.tsx";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

// ---- Status config ----

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
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
  // Pages (1-indexed) currently being re-OCR'd after rotation (no global progress bar)
  const [rotatingPageNums, setRotatingPageNums] = useState<number[]>([]);

  // Re-OCR dialog
  const [reprocessDialogOpen, setReprocessDialogOpen] = useState(false);

  // File version key to force reload after server-side rotation
  const [fileVersion, setFileVersion] = useState(0);

  // In-document search
  const [docSearch, setDocSearch] = useState("");
  const [docSearchOpen, setDocSearchOpen] = useState(false);
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debouncedDocSearch = useDebounce(docSearch, 200);

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
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  const blocks = (task?.content_list || []).filter((b) => b.type !== "discarded");

  // Keyboard shortcut: Ctrl/Cmd+F opens in-document search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f" && task?.status === "completed") {
        e.preventDefault();
        setDocSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
      if (e.key === "Escape" && docSearchOpen) {
        setDocSearchOpen(false);
        setDocSearch("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [docSearchOpen, task?.status]);

  // Focus search input when opened
  useEffect(() => {
    if (docSearchOpen) setTimeout(() => searchInputRef.current?.focus(), 50);
  }, [docSearchOpen]);

  // Reset match index when search query changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: debouncedDocSearch is the intentional trigger
  useEffect(() => {
    setSearchMatchIndex(0);
    setSearchMatchCount(0);
  }, [debouncedDocSearch]);

  // Navigate marks after render: count, style active, scroll into view
  // biome-ignore lint/correctness/useExhaustiveDependencies: task?.result_md and viewMode are intentional triggers
  useEffect(() => {
    if (!rightPanelRef.current || !debouncedDocSearch) {
      setSearchMatchCount(0);
      return;
    }
    const t = setTimeout(() => {
      if (!rightPanelRef.current) return;
      const marks = Array.from(
        rightPanelRef.current.querySelectorAll<HTMLElement>("mark.search-highlight"),
      );
      const count = marks.length;
      setSearchMatchCount(count);
      if (count === 0) return;
      const idx = searchMatchIndex % count;
      marks.forEach((m, i) => {
        m.style.background = i === idx ? "#ea580c" : "#fde047";
        m.style.color = i === idx ? "#fff" : "inherit";
      });
      marks[idx]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    return () => clearTimeout(t);
  }, [debouncedDocSearch, searchMatchIndex, task?.result_md, viewMode]);

  const scrollToBlock = useCallback((i: number) => {
    blockRefs.current.get(i)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const goToBlock = useCallback(
    (i: number) => {
      setActiveBlock(i);
      setViewMode("blocks");
      scrollToBlock(i);
      const pageIdx = blocks[i]?.page_idx ?? 0;
      setPdfPage(pageIdx + 1);
    },
    [scrollToBlock, blocks],
  );

  const handleHover = useCallback(
    (i: number | null) => {
      setActiveBlock(i);
      if (i !== null && viewMode === "blocks") scrollToBlock(i);
    },
    [scrollToBlock, viewMode],
  );

  const handleBlockHover = useCallback(
    (i: number | null) => {
      setActiveBlock(i);
      if (i !== null) {
        const pageIdx = blocks[i]?.page_idx ?? 0;
        setPdfPage(pageIdx + 1);
      }
    },
    [blocks],
  );

  // ---- Edit handlers ----

  const startEditing = () => {
    setEditMd(task?.result_md || "");
    setEditBlocks(
      blocks.map((b) => ({ ...b, list_items: b.list_items ? [...b.list_items] : undefined })),
    );
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

  // Poll for page-rotation re-OCR without showing the global progress bar.
  // Keeps task.status as "completed" in the UI until done, then navigates to targetPage.
  const pollPageRotationUntilDone = useCallback(async (taskId: string, targetPage: number) => {
    try {
      const t = await getTask(taskId);
      if (t.status === "pending" || t.status === "processing") {
        setTimeout(() => pollPageRotationUntilDone(taskId, targetPage), 2000);
      } else {
        setTask(t);
        setFileVersion((v) => v + 1);
        setRotating(false);
        setRotatingPageNums([]);
        setPdfPage(targetPage);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rotation failed");
      setRotating(false);
      setRotatingPageNums([]);
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
    // Collect all pages that have been rotated
    const rotations: Record<string, number> = {};
    const rotatedPageNums: number[] = [];
    for (const [pageIdx, angle] of Object.entries(pageRotations)) {
      if (angle !== 0) {
        rotations[pageIdx] = angle;
        rotatedPageNums.push(parseInt(pageIdx, 10) + 1);
      }
    }
    if (Object.keys(rotations).length === 0) return;

    const targetPage = pdfPage;
    setRotating(true);
    setEditing(false);
    setRotatingPageNums(rotatedPageNums);
    try {
      await reprocessTask(task.id, { rotations });
      setPageRotations({});
      // Use page-rotation poll: no global progress bar, navigates to target page when done
      setTimeout(() => pollPageRotationUntilDone(task.id, targetPage), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rotation failed");
      setRotating(false);
      setRotatingPageNums([]);
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

  if (error)
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );

  if (!task)
    return (
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

  const fileSrc = `${fileUrl(task.filename)}?v=${fileVersion}`;

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
              task.status === "completed" && "border-success text-success bg-success/10",
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
            size="sm"
            className="h-7 px-2.5 gap-1.5 text-xs"
            onClick={() => setViewMode("document")}
          >
            <FileText className="h-3.5 w-3.5" />
            Document
          </Button>
          <Button
            variant={viewMode === "blocks" ? "default" : "ghost"}
            size="sm"
            className="h-7 px-2.5 gap-1.5 text-xs"
            onClick={() => setViewMode("blocks")}
          >
            <LayoutList className="h-3.5 w-3.5" />
            Blocks
          </Button>
        </div>

        <Separator orientation="vertical" className="h-5" />

        {/* Edit / Save / Cancel */}
        {task.status === "completed" && !editing && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={startEditing}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        )}
        {editing && (
          <>
            <Button
              variant="default"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={saveEdits}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={cancelEditing}
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
          </>
        )}

        {/* Re-OCR (full) */}
        {task.status === "completed" && !editing && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setReprocessDialogOpen(true)}
            disabled={rotating}
          >
            {rotating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Re-OCR
          </Button>
        )}

        {/* In-document search toggle */}
        {task.status === "completed" && !editing && (
          <Button
            variant={docSearchOpen ? "default" : "ghost"}
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={() => {
              setDocSearchOpen((v) => !v);
              if (docSearchOpen) setDocSearch("");
            }}
          >
            <Search className="h-4 w-4" />
          </Button>
        )}

        {/* Toggle document panel */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={() => setDocPanelOpen(!docPanelOpen)}
        >
          {docPanelOpen ? (
            <PanelLeftClose className="h-4 w-4" />
          ) : (
            <PanelLeft className="h-4 w-4" />
          )}
        </Button>

        {!editing && <CopyButton text={task.result_md || ""} label="Copy MD" />}
      </div>

      {/* In-document search bar */}
      {docSearchOpen && task.status === "completed" && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b bg-muted/30 shrink-0">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="在文档中搜索…"
            value={docSearch}
            onChange={(e) => setDocSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (e.shiftKey) {
                  setSearchMatchIndex((i) =>
                    searchMatchCount > 0 ? (i - 1 + searchMatchCount) % searchMatchCount : 0,
                  );
                } else {
                  setSearchMatchIndex((i) =>
                    searchMatchCount > 0 ? (i + 1) % searchMatchCount : 0,
                  );
                }
              }
              if (e.key === "Escape") {
                setDocSearchOpen(false);
                setDocSearch("");
              }
            }}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {debouncedDocSearch && (
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              {searchMatchCount > 0
                ? `${(searchMatchIndex % searchMatchCount) + 1} / ${searchMatchCount}`
                : "无匹配"}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            disabled={searchMatchCount === 0}
            onClick={() =>
              setSearchMatchIndex((i) =>
                searchMatchCount > 0 ? (i - 1 + searchMatchCount) % searchMatchCount : 0,
              )
            }
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            disabled={searchMatchCount === 0}
            onClick={() =>
              setSearchMatchIndex((i) => (searchMatchCount > 0 ? (i + 1) % searchMatchCount : 0))
            }
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => {
              setDocSearchOpen(false);
              setDocSearch("");
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Processing / error states */}
      {isProcessing && rotatingPageNums.length === 0 && (
        <div className="mx-4 mt-3 rounded-lg border border-warning/50 bg-warning/5 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="h-4 w-4 animate-spin text-warning" />
            Recognizing...
          </div>
        </div>
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
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground"
                            onClick={handleRotateImage}
                            disabled={rotating}
                          >
                            <RotateCw className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Rotate 90° (preview)</TooltipContent>
                      </Tooltip>

                      {imageRotation > 0 && (
                        <>
                          <Badge variant="outline" className="text-[11px] h-6 gap-1">
                            {imageRotation}°
                          </Badge>
                          <Button
                            variant="default"
                            size="sm"
                            className="h-7 px-2.5 gap-1 text-xs"
                            onClick={confirmRotateImage}
                            disabled={rotating}
                          >
                            {rotating ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle className="h-3.5 w-3.5" />
                            )}
                            Re-OCR
                          </Button>
                        </>
                      )}

                      <Separator orientation="vertical" className="h-4 mx-1" />
                      <Tooltip>
                        <TooltipTrigger>
                          <a href={fileSrc} target="_blank" rel="noreferrer">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground"
                            >
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
                      <ImageOverlay
                        src={fileSrc}
                        blocks={blocks}
                        activeIndex={activeBlock}
                        onHover={handleHover}
                        onClick={goToBlock}
                        rotation={imageRotation}
                      />
                    ) : isPdf ? (
                      <PdfViewer
                        src={fileSrc}
                        blocks={blocks}
                        activeIndex={activeBlock}
                        onHover={handleHover}
                        onClick={goToBlock}
                        pageWidths={pageWidths}
                        pageHeights={pageHeights}
                        currentPage={pdfPage}
                        onPageChange={setPdfPage}
                        pageRotation={currentPageRotation}
                        totalRotatedPages={
                          Object.values(pageRotations).filter((a) => a !== 0).length
                        }
                        onRotate={handleRotatePdfPage}
                        onConfirmRotate={confirmRotatePdfPage}
                        rotating={rotating}
                        rotatingPageNums={rotatingPageNums}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                        <a
                          href={fileSrc}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          Download file
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </Allotment.Pane>

              <Allotment.Pane minSize={300}>
                <div ref={rightPanelRef} className="h-full overflow-auto">
                  <div
                    className={cn(
                      "mx-auto",
                      viewMode === "document" ? "max-w-3xl px-8 py-6" : "max-w-4xl px-4 py-3",
                    )}
                  >
                    {viewMode === "document" ? (
                      <RenderedView
                        blocks={blocks}
                        resultMd={task.result_md}
                        editing={editing}
                        editMd={editMd}
                        onEditMdChange={setEditMd}
                        searchQuery={debouncedDocSearch || undefined}
                      />
                    ) : (
                      <BlockView
                        blocks={blocks}
                        activeBlock={activeBlock}
                        blockRefs={blockRefs}
                        onBlockHover={handleBlockHover}
                        editing={editing}
                        editBlocks={editBlocks}
                        onEditBlock={handleEditBlock}
                        searchQuery={debouncedDocSearch || undefined}
                      />
                    )}
                  </div>
                </div>
              </Allotment.Pane>
            </Allotment>
          ) : (
            <div ref={rightPanelRef} className="h-full overflow-auto">
              <div
                className={cn(
                  "mx-auto",
                  viewMode === "document" ? "max-w-3xl px-8 py-6" : "max-w-4xl px-4 py-3",
                )}
              >
                {viewMode === "document" ? (
                  <RenderedView
                    blocks={blocks}
                    resultMd={task.result_md}
                    editing={editing}
                    editMd={editMd}
                    onEditMdChange={setEditMd}
                    searchQuery={debouncedDocSearch || undefined}
                  />
                ) : (
                  <BlockView
                    blocks={blocks}
                    activeBlock={activeBlock}
                    blockRefs={blockRefs}
                    onBlockHover={handleBlockHover}
                    editing={editing}
                    editBlocks={editBlocks}
                    onEditBlock={handleEditBlock}
                    searchQuery={debouncedDocSearch || undefined}
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
              This will re-process the entire document. The current recognized content will be
              replaced with new results.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReprocessDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleReprocess}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
