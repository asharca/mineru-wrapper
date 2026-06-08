import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorState } from "./error-state";

describe("ErrorState", () => {
  it("renders the default title when none given", () => {
    render(<ErrorState />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("renders a custom title and description", () => {
    render(<ErrorState title="Upload failed" description="File too large" />);
    expect(screen.getByText("Upload failed")).toBeInTheDocument();
    expect(screen.getByText("File too large")).toBeInTheDocument();
  });

  it("does not render a retry button when no retry handler is given", () => {
    render(<ErrorState title="X" />);
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("calls retry when the button is clicked", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(<ErrorState title="X" retry={retry} />);
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
