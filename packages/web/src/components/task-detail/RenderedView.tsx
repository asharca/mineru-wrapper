import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { Textarea } from "@/components/ui/textarea";
import type { ContentBlock } from "../../api.ts";
import { highlightMarkdown } from "./utils.tsx";

interface RenderedViewProps {
  blocks: ContentBlock[];
  resultMd: string | null;
  editing: boolean;
  editMd: string;
  onEditMdChange: (md: string) => void;
  searchQuery?: string;
}

export function RenderedView({
  blocks,
  resultMd,
  editing,
  editMd,
  onEditMdChange,
  searchQuery,
}: RenderedViewProps) {
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
    const displayMd = searchQuery ? highlightMarkdown(resultMd, searchQuery) : resultMd;
    return (
      <article className="rendered-md max-w-none prose-container">
        <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
          {displayMd}
        </Markdown>
      </article>
    );
  }

  return (
    <article className="rendered-md max-w-none prose-container">
      {blocks.map((block, i) => {
        if (block.type === "image") {
          return block.img_url ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: block list is stable for a given task
            <figure key={i} className="my-4">
              <img
                src={block.img_url}
                alt={block.img_path || "extracted image"}
                className="max-w-full h-auto rounded-lg"
              />
            </figure>
          ) : null;
        }
        if (block.type === "table" && block.table_body) {
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: block list is stable for a given task
              key={i}
              className="overflow-x-auto my-4"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: server-provided sanitized table HTML
              dangerouslySetInnerHTML={{ __html: block.table_body }}
            />
          );
        }
        if (block.type === "list" && block.list_items) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: block list is stable for a given task
            <ul key={i} className="list-disc pl-6 space-y-1 my-3">
              {block.list_items.map((item, li) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: list items are stable
                <li key={li}>{item}</li>
              ))}
            </ul>
          );
        }
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: block list is stable for a given task
          <Markdown key={i} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
            {block.text || ""}
          </Markdown>
        );
      })}
    </article>
  );
}
