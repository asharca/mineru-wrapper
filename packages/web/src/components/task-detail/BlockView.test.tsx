import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ContentBlock } from "../../api.ts";
import { BlockView } from "./BlockView";

const blocks: ContentBlock[] = [
  { type: "text", text: "first", bbox: [0, 0, 1, 1], page_idx: 0 },
  { type: "text", text: "second", bbox: [0, 0, 1, 1], page_idx: 0 },
];

function noop() {}

function refs() {
  return { current: new Map<number, HTMLDivElement>() };
}

describe("BlockView", () => {
  it("rings exactly the active block", () => {
    const { container } = render(
      <BlockView
        blocks={blocks}
        activeBlock={0}
        blockRefs={refs()}
        onBlockHover={noop}
        editing={false}
        editBlocks={[]}
        onEditBlock={noop}
      />,
    );
    expect(container.querySelectorAll(".ring-2").length).toBe(1);
  });

  it("rings no block when none is active", () => {
    const { container } = render(
      <BlockView
        blocks={blocks}
        activeBlock={null}
        blockRefs={refs()}
        onBlockHover={noop}
        editing={false}
        editBlocks={[]}
        onEditBlock={noop}
      />,
    );
    expect(container.querySelectorAll(".ring-2").length).toBe(0);
  });

  it("shows an empty message when there are no blocks", () => {
    const { getByText } = render(
      <BlockView
        blocks={[]}
        activeBlock={null}
        blockRefs={refs()}
        onBlockHover={noop}
        editing={false}
        editBlocks={[]}
        onEditBlock={noop}
      />,
    );
    expect(getByText("No regions detected")).toBeInTheDocument();
  });
});
