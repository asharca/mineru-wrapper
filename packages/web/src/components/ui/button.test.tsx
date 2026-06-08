import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders its children", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });

  it("shows a spinner and is disabled when loading", () => {
    render(<Button loading>Saving</Button>);
    const button = screen.getByRole("button", { name: /saving/i });
    expect(button).toBeDisabled();
    expect(button.querySelector("svg.animate-spin")).toBeInTheDocument();
  });

  it("has no spinner when not loading", () => {
    render(<Button>Go</Button>);
    const button = screen.getByRole("button", { name: "Go" });
    expect(button.querySelector("svg.animate-spin")).not.toBeInTheDocument();
  });

  it("respects an explicit disabled prop", () => {
    render(<Button disabled>Nope</Button>);
    expect(screen.getByRole("button", { name: "Nope" })).toBeDisabled();
  });
});
