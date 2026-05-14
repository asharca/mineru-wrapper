import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadButton } from "./DownloadButton";

const mockCreateObjectURL = vi.fn(() => "blob:mock-url");
const mockRevokeObjectURL = vi.fn();
const mockAnchorClick = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  global.URL.createObjectURL = mockCreateObjectURL;
  global.URL.revokeObjectURL = mockRevokeObjectURL;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(mockAnchorClick);
});

describe("DownloadButton", () => {
  it("renders with the given label", () => {
    render(
      <DownloadButton
        content="# Hello"
        filename="report.md"
        label="Download MD"
        mimeType="text/markdown"
      />,
    );
    expect(screen.getByRole("button", { name: /download md/i })).toBeInTheDocument();
  });

  it("creates a blob and triggers a download on click", async () => {
    const user = userEvent.setup();
    render(
      <DownloadButton
        content="# Hello"
        filename="report.md"
        label="Download MD"
        mimeType="text/markdown"
      />,
    );

    await user.click(screen.getByRole("button", { name: /download md/i }));

    expect(mockCreateObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(mockAnchorClick).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("sets the correct filename on the anchor element", async () => {
    const user = userEvent.setup();
    const originalCreateElement = document.createElement.bind(document);
    let capturedAnchor: HTMLAnchorElement | null = null;
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "a") capturedAnchor = el as HTMLAnchorElement;
      return el;
    });

    render(
      <DownloadButton
        content="# Hello"
        filename="report.md"
        label="Download MD"
        mimeType="text/markdown"
      />,
    );

    await user.click(screen.getByRole("button", { name: /download md/i }));

    expect(capturedAnchor?.download).toBe("report.md");
  });

  it("creates a blob with the correct mime type", async () => {
    const user = userEvent.setup();
    render(
      <DownloadButton
        content="[]"
        filename="report.json"
        label="Download JSON"
        mimeType="application/json"
      />,
    );

    await user.click(screen.getByRole("button", { name: /download json/i }));

    const blob: Blob = mockCreateObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("application/json");
  });
});
