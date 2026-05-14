import { useEffect, useState } from "react";

export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            // biome-ignore lint/suspicious/noArrayIndexKey: parts are derived from a stable regex split
            key={i}
            className="search-highlight"
            style={{ background: "#fde047", borderRadius: "2px", padding: "0 1px" }}
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function highlightMarkdown(md: string, query: string): string {
  if (!query || query.trim().length < 1) return md;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return md.replace(
    new RegExp(`(${escaped})`, "gi"),
    '<mark class="search-highlight" style="background:#fde047;border-radius:2px;padding:0 1px;">$1</mark>',
  );
}

export const TYPE_COLORS: Record<string, string> = {
  text: "#3b82f6",
  title: "#ef4444",
  table: "#22c55e",
  figure: "#a855f7",
  image: "#a855f7",
  formula: "#f59e0b",
  interline_equation: "#f59e0b",
  list: "#0ea5e9",
};

export function typeColor(type: string): string {
  return TYPE_COLORS[type] || "#6b7280";
}
