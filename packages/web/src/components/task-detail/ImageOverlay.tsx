import { useEffect, useState } from "react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import type { ContentBlock } from "../../api.ts";
import { typeColor } from "./utils.tsx";

interface ImageOverlayProps {
  src: string;
  blocks: ContentBlock[];
  activeIndex: number | null;
  onHover: (i: number | null) => void;
  onClick: (i: number) => void;
  rotation: number;
}

export function ImageOverlay({
  src,
  blocks,
  activeIndex,
  onHover,
  onClick,
  rotation,
}: ImageOverlayProps) {
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = src;
  }, [src]);

  if (!imgSize)
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading image...
      </div>
    );

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
        {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative overlay rendered above the image */}
        <svg
          viewBox={`0 0 ${w} ${h}`}
          style={{
            width: "100%",
            height: "auto",
            display: "block",
            transform: `rotate(${rotation}deg)`,
            transition: "transform 0.3s ease",
          }}
        >
          <image href={src} x={0} y={0} width={w} height={h} />
          {rotation === 0 &&
            blocks.map((block, i) => {
              const [bx0, by0, bx1, by1] = block.bbox;
              const x0 = bx0 * sx,
                y0 = by0 * sy,
                x1 = bx1 * sx,
                y1 = by1 * sy;
              const isActive = activeIndex === i;
              const c = typeColor(block.type);
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: SVG group used as interactive bbox overlay
                <g
                  // biome-ignore lint/suspicious/noArrayIndexKey: block list is stable for a given task
                  key={i}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => onHover(i)}
                  onMouseLeave={() => onHover(null)}
                  onClick={() => onClick(i)}
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
                    fontSize={fontSize}
                    fontWeight="bold"
                    textAnchor="middle"
                    dominantBaseline="central"
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
