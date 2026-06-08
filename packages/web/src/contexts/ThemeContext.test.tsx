import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "./ThemeContext";

function TestConsumer() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button type="button" onClick={() => setTheme("dark")}>
        Set Dark
      </button>
      <button type="button" onClick={() => setTheme("light")}>
        Set Light
      </button>
      <button type="button" onClick={() => setTheme("system")}>
        Set System
      </button>
    </div>
  );
}

function stubMatchMedia(systemPrefersDark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("dark") ? systemPrefersDark : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    }),
  });
}

interface CapturingMatchMedia {
  setMatches: (next: boolean) => void;
  fireChange: () => void;
  readonly addListenerCalls: number;
  readonly removeListenerCalls: number;
}

function stubMatchMediaCapturing(initialDark: boolean): CapturingMatchMedia {
  let matches = initialDark;
  const handlers = new Set<(e: { matches: boolean }) => void>();
  const counters = { add: 0, remove: 0 };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      get matches() {
        return query === "(prefers-color-scheme: dark)" ? matches : false;
      },
      media: query,
      addEventListener: (_: string, h: (e: { matches: boolean }) => void) => {
        handlers.add(h);
        counters.add++;
      },
      removeEventListener: (_: string, h: (e: { matches: boolean }) => void) => {
        handlers.delete(h);
        counters.remove++;
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    }),
  });
  return {
    setMatches: (next: boolean) => {
      matches = next;
    },
    fireChange: () => {
      for (const h of handlers) h({ matches });
    },
    get addListenerCalls() {
      return counters.add;
    },
    get removeListenerCalls() {
      return counters.remove;
    },
  };
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    stubMatchMedia(false);
  });

  it("defaults to 'system' when nothing in localStorage", () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("system");
  });

  it("resolves 'system' to 'dark' when prefers-color-scheme is dark", () => {
    stubMatchMedia(true);
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("reads stored 'dark' on mount and applies the class", () => {
    localStorage.setItem("mineru.theme", "dark");
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("setTheme('dark') persists to localStorage and adds class", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    await user.click(screen.getByText("Set Dark"));
    expect(localStorage.getItem("mineru.theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("setTheme('system') falls back to system preference", async () => {
    const user = userEvent.setup();
    localStorage.setItem("mineru.theme", "dark");
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await user.click(screen.getByText("Set System"));
    expect(localStorage.getItem("mineru.theme")).toBe("system");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("useTheme throws when used outside provider", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow(/ThemeProvider/);
    consoleError.mockRestore();
  });

  it("ignores OS theme change when user picked explicit dark", async () => {
    const mq = stubMatchMediaCapturing(false);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    await user.click(screen.getByText("Set Dark"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    // After leaving "system" mode, the effect cleanup should have removed the listener.
    expect(mq.removeListenerCalls).toBeGreaterThanOrEqual(1);
    // OS flips to light — should be ignored since user is on explicit dark.
    mq.setMatches(false);
    mq.fireChange();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
  });

  it("removes media-query listener on unmount", () => {
    const mq = stubMatchMediaCapturing(false);
    const { unmount } = render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    // Theme is "system" by default, so addEventListener was called once.
    expect(mq.addListenerCalls).toBe(1);
    expect(mq.removeListenerCalls).toBe(0);
    unmount();
    expect(mq.removeListenerCalls).toBe(1);
  });
});
