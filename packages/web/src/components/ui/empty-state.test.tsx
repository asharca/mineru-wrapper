import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("renders the title", () => {
    render(<EmptyState title="No records yet" />);
    expect(screen.getByText("No records yet")).toBeInTheDocument();
  });

  it("renders the description when provided", () => {
    render(<EmptyState title="Empty" description="Upload a document to get started" />);
    expect(screen.getByText("Upload a document to get started")).toBeInTheDocument();
  });

  it("renders an action node when provided", () => {
    render(<EmptyState title="Empty" action={<button type="button">Do thing</button>} />);
    expect(screen.getByRole("button", { name: "Do thing" })).toBeInTheDocument();
  });

  it("renders the icon when provided", () => {
    render(<EmptyState title="Empty" icon={Inbox} />);
    // lucide icons render an <svg>; assert one exists inside the container
    expect(document.querySelector("svg")).toBeInTheDocument();
  });
});
