import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LoadingSkeleton } from "./loading-skeleton";

describe("LoadingSkeleton", () => {
  it("renders 5 rows by default", () => {
    render(<LoadingSkeleton />);
    const container = screen.getByTestId("loading-skeleton");
    expect(container.children.length).toBe(5);
  });

  it("respects the rows prop", () => {
    render(<LoadingSkeleton rows={3} />);
    const container = screen.getByTestId("loading-skeleton");
    expect(container.children.length).toBe(3);
  });

  it("applies the animate-pulse class to each row", () => {
    render(<LoadingSkeleton rows={2} />);
    const container = screen.getByTestId("loading-skeleton");
    for (const child of container.children) {
      expect(child.className).toContain("animate-pulse");
    }
  });
});
