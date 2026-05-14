import { CheckCircle, ChevronLeft, ChevronRight, Download, Loader2, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Document, Page } from "react-pdf";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ContentBlock } from "../../api.ts";
import { typeColor } from "./utils.tsx";

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
  totalRotatedPages: number;
  onRotate: () => void;
  onConfirmRotate: () => void;
  rotating: boolean;
  rotatingPageNums?: number[];
}

export function PdfViewer({
  src,
  blocks,
  activeIndex,
  onHover,
  onClick,
  pageWidths,
  pageHeights,
  currentPage,
  onPageChange,
  pageRotation,
  totalRotatedPages,
  onRotate,
  onConfirmRotate,
  rotating,
  rotatingPageNums,
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
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={currentPage <= 1}
                onClick={() => onPageChange(currentPage - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums min-w-[60px] text-center">
                {currentPage} / {numPages}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={currentPage >= numPages}
                onClick={() => onPageChange(currentPage + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Separator orientation="vertical" className="h-4 mx-1" />
            </>
          )}

          <Tooltip>
            <TooltipTrigger>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground"
                onClick={onRotate}
                disabled={rotating}
              >
                <RotateCw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Rotate 90° (preview)</TooltipContent>
          </Tooltip>

          {pageRotation > 0 && (
            <Badge variant="outline" className="text-[11px] h-6 gap-1">
              {pageRotation}°
            </Badge>
          )}
          {totalRotatedPages > 0 && (
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 px-2.5 gap-1 text-xs"
                  onClick={onConfirmRotate}
                  disabled={rotating}
                >
                  {rotating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle className="h-3.5 w-3.5" />
                  )}
                  Re-OCR {totalRotatedPages === 1 ? "1 page" : `${totalRotatedPages} pages`}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Rotate and re-recognize only the rotated pages</TooltipContent>
            </Tooltip>
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
        <Document
          file={src}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading PDF...
            </div>
          }
        >
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
            {rotatingPageNums?.includes(currentPage) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/75 z-10 gap-2 rounded">
                <Loader2 className="h-7 w-7 animate-spin text-warning" />
                <span className="text-sm font-medium text-muted-foreground">Recognizing...</span>
              </div>
            )}
            {pageRotation === 0 && pageBlocks.length > 0 && pageSize && (
              // biome-ignore lint/a11y/noSvgWithoutTitle: decorative overlay rendered above the PDF page
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
                  const x0 = bx0 * sx,
                    y0 = by0 * sy,
                    x1 = bx1 * sx,
                    y1 = by1 * sy;
                  const isActive = activeIndex === globalIdx;
                  const c = typeColor(block.type);
                  const labelW = Math.round(overlayW * 0.02);
                  const labelH = Math.round(overlayH * 0.02);
                  const fs = Math.round(Math.min(overlayW, overlayH) * 0.012);
                  return (
                    // biome-ignore lint/a11y/noStaticElementInteractions: SVG group used as interactive bbox overlay
                    <g
                      key={globalIdx}
                      style={{ cursor: "pointer", pointerEvents: "all" }}
                      onMouseEnter={() => onHover(globalIdx)}
                      onMouseLeave={() => onHover(null)}
                      onClick={() => onClick(globalIdx)}
                    >
                      <rect
                        x={x0}
                        y={y0}
                        width={x1 - x0}
                        height={y1 - y0}
                        fill={isActive ? `${c}33` : "transparent"}
                        stroke={c}
                        strokeWidth={isActive ? 3 : 1.5}
                        strokeOpacity={isActive ? 1 : 0.5}
                        rx={2}
                      />
                      <rect
                        x={x0}
                        y={Math.max(0, y0 - labelH)}
                        width={labelW}
                        height={labelH}
                        fill={c}
                        rx={3}
                      />
                      <text
                        x={x0 + labelW / 2}
                        y={Math.max(0, y0 - labelH) + labelH / 2}
                        fill="white"
                        fontSize={fs}
                        fontWeight="bold"
                        textAnchor="middle"
                        dominantBaseline="central"
                      >
                        {globalIdx + 1}
                      </text>
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
