import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFormSubmit } from "./use-form-submit";

function fakeEvent() {
  return { preventDefault: () => {} } as React.FormEvent;
}

describe("useFormSubmit", () => {
  it("starts with loading false and empty error", () => {
    const { result } = renderHook(() => useFormSubmit());
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("");
  });

  it("clears error and runs the submitted fn", async () => {
    const { result } = renderHook(() => useFormSubmit());
    let ran = false;
    await act(async () => {
      await result.current.submit(async () => {
        ran = true;
      })(fakeEvent());
    });
    expect(ran).toBe(true);
    expect(result.current.error).toBe("");
    expect(result.current.loading).toBe(false);
  });

  it("captures a thrown error message", async () => {
    const { result } = renderHook(() => useFormSubmit());
    await act(async () => {
      await result.current.submit(async () => {
        throw new Error("boom");
      })(fakeEvent());
    });
    await waitFor(() => expect(result.current.error).toBe("boom"));
    expect(result.current.loading).toBe(false);
  });
});
