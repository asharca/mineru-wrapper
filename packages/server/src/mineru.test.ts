import { describe, expect, it } from "bun:test";
import type { ContentBlock } from "./db.ts";
import { applyImageUrls } from "./mineru.ts";

describe("applyImageUrls", () => {
  it("returns new objects — does not mutate the input blocks", () => {
    const original: ContentBlock = {
      type: "image",
      bbox: [0, 0, 100, 100],
      img_path: "images/fig1.png",
    };
    const result = applyImageUrls([original], { "fig1.png": "/files/img/abc.png" });
    expect(original.img_url).toBeUndefined();
    expect(result[0]).not.toBe(original);
    expect(result[0]?.img_url).toBe("/files/img/abc.png");
  });

  it("passes through blocks with no img_path unchanged", () => {
    const block: ContentBlock = { type: "text", bbox: [0, 0, 100, 20], text: "hello" };
    const result = applyImageUrls([block], {});
    expect(result[0]).toBe(block);
  });

  it("passes through blocks whose key is not in the urlMap", () => {
    const block: ContentBlock = {
      type: "image",
      bbox: [0, 0, 100, 100],
      img_path: "images/missing.png",
    };
    const result = applyImageUrls([block], {});
    expect(result[0]).toBe(block);
    expect(result[0]?.img_url).toBeUndefined();
  });
});
