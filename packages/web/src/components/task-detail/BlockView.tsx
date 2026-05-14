import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ContentBlock } from "../../api.ts";
import { CopyButton } from "./CopyButton.tsx";
import { HighlightText, typeColor } from "./utils.tsx";

interface BlockViewProps {
  blocks: ContentBlock[];
  activeBlock: number | null;
  blockRefs: React.RefObject<Map<number, HTMLDivElement>>;
  onBlockHover: (i: number | null) => void;
  editing: boolean;
  editBlocks: ContentBlock[];
  onEditBlock: (index: number, text: string) => void;
  searchQuery?: string;
}

export function BlockView({
  blocks,
  activeBlock,
  blockRefs,
  onBlockHover,
  editing,
  editBlocks,
  onEditBlock,
  searchQuery,
}: BlockViewProps) {
  const displayBlocks = editing ? editBlocks : blocks;

  if (displayBlocks.length === 0) {
    return <div className="text-center py-12 text-muted-foreground">No regions detected</div>;
  }

  return (
    <div className="flex flex-col gap-1">
      {displayBlocks.map((block, i) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: highlight-on-hover for visual sync with PDF overlay
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: block list is stable for a given task
          key={i}
          ref={(el) => {
            if (el) blockRefs.current?.set(i, el);
          }}
          className={cn(
            "px-4 py-3 rounded-lg border transition-all",
            activeBlock === i
              ? "bg-primary/5 border-primary/40 shadow-sm"
              : "border-transparent hover:bg-muted/50",
          )}
          onMouseEnter={() => onBlockHover(i)}
          onMouseLeave={() => onBlockHover(null)}
        >
          <div className="flex items-center gap-2 mb-1">
            <span
              className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold text-white shrink-0"
              style={{ background: typeColor(block.type) }}
            >
              {i + 1}
            </span>
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px] font-semibold uppercase px-1.5 py-0",
                `block-type-${block.type}`,
              )}
            >
              {block.type}
              {block.text_level ? ` h${block.text_level}` : ""}
            </Badge>
            {!editing && (block.text || block.list_items) && (
              <span className="ml-auto">
                <CopyButton text={block.text || (block.list_items ?? []).join("\n")} />
              </span>
            )}
          </div>

          <div className="text-sm leading-relaxed pl-7">
            {editing &&
            (block.type === "text" ||
              block.type === "title" ||
              block.type === "formula" ||
              block.type === "interline_equation") ? (
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
                    <img
                      src={block.img_url}
                      alt={block.img_path || "extracted image"}
                      className="max-w-full h-auto rounded"
                    />
                  ) : (
                    <em className="text-muted-foreground">(image region)</em>
                  )
                ) : block.type === "table" && block.table_body ? (
                  <div
                    className="overflow-x-auto"
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: server-provided sanitized table HTML
                    dangerouslySetInnerHTML={{ __html: block.table_body }}
                  />
                ) : block.type === "list" && block.list_items ? (
                  <ul className="list-disc pl-5 space-y-1">
                    {block.list_items.map((item, li) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: list items are stable
                      <li key={li}>
                        {searchQuery ? <HighlightText text={item} query={searchQuery} /> : item}
                      </li>
                    ))}
                  </ul>
                ) : searchQuery && block.text ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    <HighlightText text={block.text} query={searchQuery} />
                  </p>
                ) : (
                  <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                    {block.text || ""}
                  </Markdown>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
