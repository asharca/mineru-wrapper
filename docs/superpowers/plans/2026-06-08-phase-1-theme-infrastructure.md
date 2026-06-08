# Phase 1: Dark Theme Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add light/dark/system tri-state theme switching to the web frontend, fix existing dark-mode rendering gaps, with no FOUC.

**Architecture:** React Context `ThemeProvider` manages tri-state preference (persisted in `localStorage`), resolves to binary `light|dark` (system → reads `prefers-color-scheme`), and applies/removes `dark` class on `<html>`. A tiny inline script in `index.html` runs before React mounts to set the class synchronously and prevent FOUC. ShadCN-style `ThemeToggle` segmented control lives in the app header.

**Tech Stack:** React 19, Tailwind v4 (`@custom-variant dark` already configured in `index.css`), Vitest + Testing Library, lucide-react icons.

**Spec:** [`docs/superpowers/specs/2026-06-08-dark-theme-and-ui-polish-design.md`](../specs/2026-06-08-dark-theme-and-ui-polish-design.md) §4 (Phase 1)

---

## File Structure

**New files:**
- `packages/web/src/contexts/ThemeContext.tsx` — Provider + `useTheme()` hook
- `packages/web/src/contexts/ThemeContext.test.tsx` — Vitest tests
- `packages/web/src/components/ui/theme-toggle.tsx` — Tri-state segmented toggle

**Modified files:**
- `packages/web/index.html` — Add FOUC inline script
- `packages/web/src/main.tsx` — Wrap with `<ThemeProvider>`
- `packages/web/src/App.tsx` — Render `<ThemeToggle />` in header
- `packages/web/src/index.css` — Fix code-block + block-type + Allotment dark variants
- `packages/web/src/components/task-detail/PdfViewer.tsx` — White-bg container
- `packages/web/src/components/task-detail/ImageOverlay.tsx` — White-bg wrapper

**Boundary rule:** The DOM-mutating side effect (toggling `dark` class) lives in **two** places — the FOUC script (synchronous, before React) and `ThemeProvider`'s `useEffect` (after React mounts). They must agree on the storage key (`mineru.theme`) and the predicate (`theme === 'dark' || (theme === 'system' && systemPrefersDark())`).

---

## Task 1: ThemeContext + ThemeProvider

**Files:**
- Create: `packages/web/src/contexts/ThemeContext.tsx`
- Create: `packages/web/src/contexts/ThemeContext.test.tsx`

- [ ] **Step 1.1: Write the failing tests**

Create `packages/web/src/contexts/ThemeContext.test.tsx`:

```tsx
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
      <button type="button" onClick={() => setTheme("dark")}>Set Dark</button>
      <button type="button" onClick={() => setTheme("light")}>Set Light</button>
      <button type="button" onClick={() => setTheme("system")}>Set System</button>
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
});
```

- [ ] **Step 1.2: Verify the tests fail**

Run: `bun run --cwd packages/web test -- ThemeContext`
Expected: FAIL — module `./ThemeContext` not found.

- [ ] **Step 1.3: Implement `ThemeContext.tsx`**

Create `packages/web/src/contexts/ThemeContext.tsx`:

```tsx
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (next: Theme) => void;
}

const STORAGE_KEY = "mineru.theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "system";
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function resolve(theme: Theme): ResolvedTheme {
  if (theme === "dark") return "dark";
  if (theme === "light") return "light";
  return systemPrefersDark() ? "dark" : "light";
}

function applyDarkClass(dark: boolean) {
  const cls = document.documentElement.classList;
  if (dark) cls.add("dark");
  else cls.remove("dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolve(theme));

  useEffect(() => {
    applyDarkClass(resolvedTheme === "dark");
  }, [resolvedTheme]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolvedTheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
    setResolvedTheme(resolve(next));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
```

- [ ] **Step 1.4: Verify tests pass**

Run: `bun run --cwd packages/web test -- ThemeContext`
Expected: PASS — all 6 tests green.

- [ ] **Step 1.5: Commit**

```bash
git add packages/web/src/contexts/ThemeContext.tsx packages/web/src/contexts/ThemeContext.test.tsx
git commit -m "feat(web): 添加 ThemeProvider 三态主题（light/dark/system）"
```

---

## Task 2: FOUC prevention script

**Files:**
- Modify: `packages/web/index.html`

- [ ] **Step 2.1: Add inline script to `<head>`**

Open `packages/web/index.html`. Replace the `<head>` block with:

```html
<head>
  <meta charset="UTF-8" />
  <link rel="icon" type="image/svg+xml" href="/vite.svg" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>OCR Center</title>
  <script>
    (function () {
      try {
        var t = localStorage.getItem('mineru.theme') || 'system';
        var dark = t === 'dark' || (t === 'system' &&
          window.matchMedia('(prefers-color-scheme: dark)').matches);
        if (dark) document.documentElement.classList.add('dark');
      } catch (e) {}
    })();
  </script>
</head>
```

- [ ] **Step 2.2: Verify typecheck still clean**

Run: `bun run typecheck`
Expected: PASS — no errors.

- [ ] **Step 2.3: Commit**

```bash
git add packages/web/index.html
git commit -m "feat(web): 防 FOUC 的内联主题脚本"
```

---

## Task 3: ThemeToggle component

**Files:**
- Create: `packages/web/src/components/ui/theme-toggle.tsx`

- [ ] **Step 3.1: Implement the component**

Create `packages/web/src/components/ui/theme-toggle.tsx`:

```tsx
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-background/60 p-0.5"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center rounded transition-colors",
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3.2: Verify typecheck clean**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3.3: Commit**

```bash
git add packages/web/src/components/ui/theme-toggle.tsx
git commit -m "feat(web): 添加 ThemeToggle 三态分段选择器"
```

---

## Task 4: Wire ThemeProvider and ThemeToggle into the app

**Files:**
- Modify: `packages/web/src/main.tsx`
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 4.1: Wrap with `ThemeProvider` in `main.tsx`**

Open `packages/web/src/main.tsx`. Replace entire contents with:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { SettingsProvider } from "./SettingsContext.tsx";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <SettingsProvider>
            <TooltipProvider>
              <App />
            </TooltipProvider>
          </SettingsProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
```

Rationale: `ThemeProvider` is outermost so login/register pages also benefit from theme.

- [ ] **Step 4.2: Render `ThemeToggle` in `App.tsx` header**

Open `packages/web/src/App.tsx`.

In the import block (line 1-12), add:
```tsx
import { ThemeToggle } from "@/components/ui/theme-toggle";
```

Then in `AuthHeader`, just before the `<a href="/docs">` block (around line 55), insert:
```tsx
<ThemeToggle />
```

The updated `AuthHeader` should look like:

```tsx
function AuthHeader() {
  const { user, logout } = useAuth();
  return (
    <div className="flex items-center gap-3">
      {user ? (
        <>
          <span className="text-sm text-muted-foreground flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" />
            {user.email}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={logout}
          >
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </>
      ) : (
        <NavLink to="/login">
          <Button variant="ghost" size="sm">
            Sign In
          </Button>
        </NavLink>
      )}
      <ThemeToggle />
      <a href="/docs" target="_blank" rel="noreferrer">
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
          <BookOpen className="h-4 w-4" />
          API Docs
        </Button>
      </a>
    </div>
  );
}
```

> Note: Header redesign (dropdown menu) belongs to Phase 3b. This task only adds the toggle in its current position.

- [ ] **Step 4.3: Verify typecheck + tests pass**

Run: `bun run typecheck && bun run test`
Expected: PASS.

- [ ] **Step 4.4: Commit**

```bash
git add packages/web/src/main.tsx packages/web/src/App.tsx
git commit -m "feat(web): 在 main.tsx/App.tsx 接入 ThemeProvider 与 ThemeToggle"
```

---

## Task 5: Fix hard-coded code-block colors to use theme variables

**Files:**
- Modify: `packages/web/src/index.css`

- [ ] **Step 5.1: Update `.rendered-md pre` rule**

Open `packages/web/src/index.css`. Find lines 220-227 (the `.rendered-md pre` block):

```css
.rendered-md pre {
  background: oklch(0.205 0.006 247);
  color: oklch(0.922 0 0);
  padding: 16px;
  border-radius: var(--radius);
  overflow-x: auto;
  margin: 1em 0;
}
```

Replace with:

```css
.rendered-md pre {
  background: var(--muted);
  color: var(--foreground);
  padding: 16px;
  border-radius: var(--radius);
  overflow-x: auto;
  margin: 1em 0;
  border: 1px solid var(--border);
}
```

Rationale: `var(--muted)` resolves to a light gray in light mode and a near-black in dark mode (see `:root` and `.dark` in the same file). Adds a `border` so code blocks remain distinguishable on both light/dark backgrounds.

- [ ] **Step 5.2: Verify typecheck + tests + lint pass**

Run: `bun run typecheck && bun run test && bun run lint`
Expected: PASS.

- [ ] **Step 5.3: Commit**

```bash
git add packages/web/src/index.css
git commit -m "fix(web): Markdown 代码块改用 --muted/--foreground 变量，适配暗色"
```

---

## Task 6: Add dark variants for block-type tags

**Files:**
- Modify: `packages/web/src/index.css`

- [ ] **Step 6.1: Add dark variants after the existing block-type rules**

Open `packages/web/src/index.css`. Locate the block-type rules (lines 146-171). Immediately after `.block-type-list { ... }` (around line 171), append the following dark variants:

```css
/* Block type tags — dark mode variants */
.dark .block-type-title {
  background-color: oklch(0.32 0.06 25);
  color: oklch(0.85 0.15 25);
}
.dark .block-type-text {
  background-color: oklch(0.32 0.05 260);
  color: oklch(0.85 0.15 260);
}
.dark .block-type-table {
  background-color: oklch(0.32 0.06 150);
  color: oklch(0.85 0.13 150);
}
.dark .block-type-figure,
.dark .block-type-image {
  background-color: oklch(0.32 0.06 300);
  color: oklch(0.85 0.15 300);
}
.dark .block-type-formula,
.dark .block-type-interline_equation {
  background-color: oklch(0.32 0.06 70);
  color: oklch(0.85 0.13 70);
}
.dark .block-type-list {
  background-color: oklch(0.32 0.05 230);
  color: oklch(0.85 0.11 230);
}
```

Rationale: original rules use very light `oklch(0.95 ...)` backgrounds which look fine in light mode but completely wash out in dark mode. Dark variants use deeper desaturated backgrounds (`L=0.32`) with bright tinted text (`L=0.85`) for contrast.

- [ ] **Step 6.2: Verify build still works**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 6.3: Commit**

```bash
git add packages/web/src/index.css
git commit -m "fix(web): block-type 彩色标签加暗色变体"
```

---

## Task 7: White background for PDF + Image viewers

**Files:**
- Modify: `packages/web/src/components/task-detail/PdfViewer.tsx`
- Modify: `packages/web/src/components/task-detail/ImageOverlay.tsx`

- [ ] **Step 7.1: Add `bg-white` to PDF scroll area**

Open `packages/web/src/components/task-detail/PdfViewer.tsx`. Find line 163:

```tsx
      <div className="flex-1 overflow-auto">
```

Replace with:

```tsx
      <div className="flex-1 overflow-auto bg-white">
```

Rationale: PDF pages are inherently white; in dark mode the surrounding container becomes dark, leaving page edges floating without contrast. Forcing white preserves the document's natural appearance regardless of theme.

- [ ] **Step 7.2: Wrap ImageOverlay return in white-bg container**

Open `packages/web/src/components/task-detail/ImageOverlay.tsx`. Find the return at line 45:

```tsx
  return (
    <TransformWrapper minScale={0.5} maxScale={8} initialScale={1} centerZoomedOut>
```

Replace with:

```tsx
  return (
    <div className="h-full bg-white">
      <TransformWrapper minScale={0.5} maxScale={8} initialScale={1} centerZoomedOut>
```

Then at the end of the component (after `</TransformWrapper>`, line ~117), add a closing `</div>`:

```tsx
      </TransformWrapper>
    </div>
  );
}
```

Also update the early `if (!imgSize)` return at line 31-36 to keep the white background:

```tsx
  if (!imgSize)
    return (
      <div className="flex h-full items-center justify-center bg-white text-muted-foreground">
        Loading image...
      </div>
    );
```

- [ ] **Step 7.3: Verify typecheck + tests + lint pass**

Run: `bun run typecheck && bun run test && bun run lint`
Expected: PASS.

- [ ] **Step 7.4: Commit**

```bash
git add packages/web/src/components/task-detail/PdfViewer.tsx packages/web/src/components/task-detail/ImageOverlay.tsx
git commit -m "fix(web): TaskDetail 预览区固定白底（暗色模式下保持文档原貌）"
```

---

## Task 8: Allotment splitter visibility in dark mode

**Files:**
- Modify: `packages/web/src/index.css`

- [ ] **Step 8.1: Append Allotment dark-mode overrides**

Open `packages/web/src/index.css`. Append at the very end of the file (after the `@keyframes progress-indeterminate` block):

```css
/* Allotment splitter visibility in dark mode.
   CSS modules hash the class names per build; partial-class selectors
   keep these rules stable across allotment versions. */
.dark [class*="sash-module_sash__"]:hover {
  background-color: var(--border);
}
.dark [class*="sash-module_active"] {
  background-color: var(--primary);
}
```

- [ ] **Step 8.2: Verify typecheck + lint pass**

Run: `bun run typecheck && bun run lint`
Expected: PASS.

- [ ] **Step 8.3: Commit**

```bash
git add packages/web/src/index.css
git commit -m "fix(web): Allotment 拖动条暗色可见（partial class selector）"
```

---

## Task 9: End-to-end manual verification

**Files:** None (verification only).

- [ ] **Step 9.1: Run full check suite**

Run: `bun run typecheck && bun run lint && bun run test`
Expected: all green.

- [ ] **Step 9.2: Start dev server**

Run: `bun run dev`
Expected: server starts on `http://localhost:5173`.

- [ ] **Step 9.3: Manual checklist (in browser)**

Open `http://localhost:5173` and verify each item below. Take screenshots in light + dark for the record.

1. **No FOUC**: Hard refresh the page. If system preference is dark or `localStorage.mineru.theme === "dark"`, the dark background must be present from frame 1 (no white flash).
2. **Toggle behavior**: Click Sun → page goes light; click Moon → page goes dark; click Monitor → page follows system. Refresh; selection persists.
3. **Login page in dark**: Log out (or open `/login` in incognito), confirm form/inputs are readable in dark mode.
4. **History page in dark**: Confirm table rows, status badges, hover states all readable.
5. **Settings page in dark**: Confirm Select/Switch/Input controls visible.
6. **TaskDetail in dark** (open any completed task):
   - PDF/image area remains white-bg
   - Allotment splitter visible on hover (between left/right panes)
   - Markdown code blocks have visible dark background with border
   - Block-type colored tags readable (not washed out)
7. **System change**: With theme set to Monitor, toggle OS dark mode — page should follow.

- [ ] **Step 9.4: Document any visual issues**

If any of the above check items fail, capture screenshot + add a TODO note in a new file `docs/superpowers/phase-1-followups.md`. Do NOT silently leave issues.

- [ ] **Step 9.5: Commit verification doc if created**

```bash
# Only if phase-1-followups.md was created in Step 9.4:
git add docs/superpowers/phase-1-followups.md
git commit -m "docs: Phase 1 已知遗留项"
```

---

## Phase 1 Completion Criteria

- [ ] All 9 tasks committed
- [ ] `bun run typecheck && bun run lint && bun run test` all pass
- [ ] Browser verification (Step 9.3) all 7 items pass on the dev server
- [ ] No FOUC observable across 5 hard refreshes
- [ ] Light/dark/system toggle persists across reloads

## Self-Review Checklist (already performed)

- ✅ **Spec coverage:** spec §4.1 → Task 1; §4.2 → Task 2; §4.3 → Task 3,4; §4.4 → Tasks 5-8; §4.5 file list ↔ "File Structure" matches; §4.6 tests → Task 1; §4.7 exit criteria → Task 9.
- ✅ **No placeholders:** every code step has complete code; every command step shows exact command + expected outcome.
- ✅ **Type consistency:** `ThemeContextValue` shape used identically in `ThemeContext.tsx`, `theme-toggle.tsx`, and test consumer. `STORAGE_KEY = "mineru.theme"` matches the FOUC script literal in `index.html`.

## What Phase 1 does NOT cover

Out of scope (next plans):
- **Phase 2**: API integration tests audit + black-list. Plan to be written after Phase 1 ships.
- **Phase 3**: Visual polish (state primitives, header redesign, form consistency, TaskDetail rework). Each sub-PR plan to be written sequentially after Phase 2 ships.
