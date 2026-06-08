import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormField } from "./form-field";

describe("FormField", () => {
  it("renders the label and children", () => {
    render(
      <FormField label="Email" htmlFor="email">
        <input id="email" />
      </FormField>,
    );
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("renders a hint when provided and no error", () => {
    render(
      <FormField label="URL" hint="Leave blank for default">
        <input />
      </FormField>,
    );
    expect(screen.getByText("Leave blank for default")).toBeInTheDocument();
  });

  it("renders an error and hides the hint when error is present", () => {
    render(
      <FormField label="URL" hint="a hint" error="Required field">
        <input />
      </FormField>,
    );
    expect(screen.getByText("Required field")).toBeInTheDocument();
    expect(screen.queryByText("a hint")).not.toBeInTheDocument();
  });
});
