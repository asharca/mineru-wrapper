import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import Markdown from "react-markdown";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { getTask, fileUrl, type ContentBlock } from "../api.ts";

const TYPE_COLORS: Record<string, string> = {
  text: "#3b82f6",
  title: "#ef4444",
  table: "#22c55e",
  figure: "#a855f7",
  image: "#a855f7",
  formula: "#f59e0b",
  interline_equation: "#f59e0b",
};

function color(type: string): string {
  return TYPE_COLORS[type] || "#6b7280";
}

interface ImageOverlayProps {
  src: string;
  blocks: ContentBlock[];
  pageWidth: number;
  pageHeight: number;
  activeIndex: number | null;
  onHover: (i: number | null) => void;
  onClick: (i: number) => void;
}

function ImageOverlay({
  src, blocks, pageWidth, pageHeight, activeIndex, onHover, onClick,
}: ImageOverlayProps) {
  // Single SVG: image + rects share the same coordinate system — no alignment issues
  return (
    <TransformWrapper minScale={0.3} maxScale={8} centerOnInit>
      <TransformComponent
        wrapperStyle={{ width: "100%", height: "100%" }}
      >
        <svg
          viewBox={`0 0 ${pageWidth} ${pageHeight}`}
          style={{ width: "100%", height: "auto", display: "block" }}
        >
          {/* The original document as background */}
          <image
            href={src}
            x={0} y={0}
            width={pageWidth} height={pageHeight}
            preserveAspectRatio="none"
          />

          {/* Bounding box overlays */}
          {blocks.map((block, i) => {
            const [x0, y0, x1, y1] = block.bbox;
            const isActive = activeIndex === i;
            const c = color(block.type);
            const labelW = 36;
            const labelH = 28;
            return (
              <g
                key={i}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => onHover(i)}
                onMouseLeave={() => onHover(null)}
                onClick={() => onClick(i)}
              >
                <rect
                  x={x0} y={y0} width={x1 - x0} height={y1 - y0}
                  fill={isActive ? `${c}33` : "transparent"}
                  stroke={c}
                  strokeWidth={isActive ? 4 : 2}
                  strokeOpacity={isActive ? 1 : 0.5}
                  rx={2}
                />
                {/* Index label */}
                <rect
                  x={x0} y={Math.max(0, y0 - labelH)}
                  width={labelW} height={labelH}
                  fill={c} rx={4}
                />
                <text
                  x={x0 + labelW / 2}
                  y={Math.max(0, y0 - labelH) + labelH / 2}
                  fill="white" fontSize="18" fontWeight="bold"
                  textAnchor="middle" dominantBaseline="central"
                >
                  {i + 1}
                </text>
              </g>
            );
          })}
        </svg>
      </TransformComponent>
    </TransformWrapper>
  );
}

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
        if (t.status === "pending" || t.status === "processing") {
          timer = setTimeout(poll, 2000);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      }
    };
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id]);

  const scrollToBlock = useCallback((i: number) => {
    const el = blockRefs.current.get(i);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const handleHover = useCallback((i: number | null) => {
    setActiveBlock(i);
    if (i !== null) scrollToBlock(i);
  }, [scrollToBlock]);

  if (error) return <div className="error-msg">{error}</div>;
  if (!task) return <div className="loading">Loading...</div>;

  const isProcessing = task.status === "pending" || task.status === "processing";
  const blocks = (task.content_list || []).filter((b) => b.type !== "discarded");
  const pageSize = task.pages?.[0];
  const isImage = /\.(png|jpe?g|gif|bmp|tiff)$/i.test(task.filename);

  return (
    <div className="detail-page">
      <div className="detail-header">
        <Link to="/history" className="back-link">&larr; Back</Link>
        <h2>{task.original_name}</h2>
        <div className="detail-meta">
          <span className={`status status-${task.status}`}>{task.status}</span>
          <span className={`badge badge-${task.source}`}>{task.source.toUpperCase()}</span>
          <span>{task.backend}</span>
          <span>Lang: {task.lang}</span>
          {blocks.length > 0 && <span>{blocks.length} regions</span>}
        </div>
      </div>

      {isProcessing && (
        <div className="processing-banner">
          <div className="spinner" />
          <span>Processing...</span>
        </div>
      )}

      {task.status === "failed" && <div className="error-msg">{task.error}</div>}

      {task.status === "completed" && (
        <div className="split-container">
          <Allotment defaultSizes={[50, 50]}>
            {/* Left: Original + bbox overlay */}
            <Allotment.Pane minSize={250}>
              <div className="pane-wrapper">
                <div className="pane-title">Original Document</div>
                <div className="pane-content">
                  {isImage && pageSize ? (
                    <ImageOverlay
                      src={fileUrl(task.filename)}
                      blocks={blocks}
                      pageWidth={pageSize.width}
                      pageHeight={pageSize.height}
                      activeIndex={activeBlock}
                      onHover={handleHover}
                      onClick={(i) => { setActiveBlock(i); scrollToBlock(i); }}
                    />
                  ) : (
                    <div style={{ padding: 20, textAlign: "center", color: "#718096" }}>
                      {isImage ? "Loading..." : "PDF preview - "}
                      <a href={fileUrl(task.filename)} target="_blank" rel="noreferrer">Download</a>
                    </div>
                  )}
                </div>
              </div>
            </Allotment.Pane>

            {/* Right: Parsed regions */}
            <Allotment.Pane minSize={250}>
              <div className="pane-wrapper">
                <div className="pane-title">
                  Parsed Result
                  <button
                    className="copy-btn"
                    onClick={() => navigator.clipboard.writeText(task.result_md || "")}
                  >
                    Copy MD
                  </button>
                </div>
                <div className="pane-content result-pane">
                  {blocks.length > 0 ? (
                    <div className="block-list">
                      {blocks.map((block, i) => (
                        <div
                          key={i}
                          ref={(el) => { if (el) blockRefs.current.set(i, el); }}
                          className={`content-block ${activeBlock === i ? "active" : ""}`}
                          data-type={block.type}
                          onMouseEnter={() => setActiveBlock(i)}
                          onMouseLeave={() => setActiveBlock(null)}
                        >
                          <div className="block-header">
                            <span
                              className="block-index"
                              style={{ background: color(block.type) }}
                            >
                              {i + 1}
                            </span>
                            <span className="block-type-tag" data-type={block.type}>
                              {block.type}
                              {block.text_level ? ` h${block.text_level}` : ""}
                            </span>
                            <span className="block-bbox">
                              [{block.bbox.join(", ")}]
                            </span>
                          </div>
                          <div className="block-body rendered-md">
                            {block.type === "image" ? (
                              <em>(image region)</em>
                            ) : (
                              <Markdown>{block.text || ""}</Markdown>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : task.result_md ? (
                    <div className="rendered-md">
                      <Markdown>{task.result_md}</Markdown>
                    </div>
                  ) : (
                    <div className="empty">No result</div>
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
