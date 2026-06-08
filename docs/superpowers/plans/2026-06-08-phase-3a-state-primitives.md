# Phase 3a: State Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three reusable state-display primitives (`EmptyState`, `LoadingSkeleton`, `ErrorState`) and land them into the History and Upload pages, replacing today's bare-text loading/empty/error states.

**Architecture:** Three small presentational components under `packages/web/src/components/ui/`, each with a focused prop interface and a Vitest unit test. They use existing theme tokens (`bg-muted`, `text-muted-foreground`, `border-destructive`) so light/dark both work automatically. `LoadingSkeleton` uses Tailwind's built-in `animate-pulse` (no new dependency). Then History.tsx swaps its "Loading..." text for `LoadingSkeleton` and its empty `Card` for `EmptyState`; Upload.tsx swaps its error `Alert` for `ErrorState`.

**Tech Stack:** React 19, Tailwind v4, lucide-react icons, Vitest + Testing Library.

**Spec:** [`docs/superpowers/specs/2026-06-08-dark-theme-and-ui-polish-design.md`](../specs/2026-06-08-dark-theme-and-ui-polish-design.md) §6.2 (Phase 3a)

---

## File Structure

**New files:**
- `packages/web/src/components/ui/empty-state.tsx` — icon + title + description + optional action
- `packages/web/src/components/ui/empty-state.test.tsx`
- `packages/web/src/components/ui/loading-skeleton.tsx` — N pulse rows
- `packages/web/src/components/ui/loading-skeleton.test.tsx`
- `packages/web/src/components/ui/error-state.tsx` — AlertCircle + title + description + optional retry
- `packages/web/src/components/ui/error-state.test.tsx`

**Modified files:**
- `packages/web/src/pages/History.tsx` — loading → `LoadingSkeleton`; empty → `EmptyState`
- `packages/web/src/pages/Upload.tsx` — error `Alert` → `ErrorState`

**Boundary rule:** All three primitives are pure presentational components — no data fetching, no router, no context. Icon props are typed as `ComponentType<{ className?: string }>` to match how `App.tsx` already passes lucide icons (`icon: typeof Upload`).

---

## Task 1: EmptyState component

**Files:**
- Create: `packages/web/src/components/ui/empty-state.tsx`
- Create: `packages/web/src/components/ui/empty-state.test.tsx`

- [ ] **Step 1.1: Write the failing test**

Create `packages/web/src/components/ui/empty-state.test.tsx`:

```tsx
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
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `bun run --cwd packages/web test -- empty-state`
Expected: FAIL — module `./empty-state` not found.

- [ ] **Step 1.3: Implement `empty-state.tsx`**

Create `packages/web/src/components/ui/empty-state.tsx`:

```tsx
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl bg-muted/40 py-16 text-center",
        className,
      )}
    >
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <div className="space-y-1">
        <p className="font-medium text-foreground">{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `bun run --cwd packages/web test -- empty-state`
Expected: PASS — 4 tests green.

- [ ] **Step 1.5: Commit**

```bash
git add packages/web/src/components/ui/empty-state.tsx packages/web/src/components/ui/empty-state.test.tsx
git commit -m "feat(web): 添加 EmptyState 状态原语"
```

---

## Task 2: LoadingSkeleton component

**Files:**
- Create: `packages/web/src/components/ui/loading-skeleton.tsx`
- Create: `packages/web/src/components/ui/loading-skeleton.test.tsx`

- [ ] **Step 2.1: Write the failing test**

Create `packages/web/src/components/ui/loading-skeleton.test.tsx`:

```tsx
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
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `bun run --cwd packages/web test -- loading-skeleton`
Expected: FAIL — module `./loading-skeleton` not found.

- [ ] **Step 2.3: Implement `loading-skeleton.tsx`**

Create `packages/web/src/components/ui/loading-skeleton.tsx`:

```tsx
import { cn } from "@/lib/utils";

interface LoadingSkeletonProps {
  rows?: number;
  className?: string;
}

export function LoadingSkeleton({ rows = 5, className }: LoadingSkeletonProps) {
  return (
    <div className={cn("space-y-2", className)} data-testid="loading-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static placeholder list
          key={i}
          className="h-12 w-full animate-pulse rounded-lg bg-muted"
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `bun run --cwd packages/web test -- loading-skeleton`
Expected: PASS — 3 tests green.

- [ ] **Step 2.5: Commit**

```bash
git add packages/web/src/components/ui/loading-skeleton.tsx packages/web/src/components/ui/loading-skeleton.test.tsx
git commit -m "feat(web): 添加 LoadingSkeleton 状态原语"
```

---

## Task 3: ErrorState component

**Files:**
- Create: `packages/web/src/components/ui/error-state.tsx`
- Create: `packages/web/src/components/ui/error-state.test.tsx`

- [ ] **Step 3.1: Write the failing test**

Create `packages/web/src/components/ui/error-state.test.tsx`:

```tsx
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
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `bun run --cwd packages/web test -- error-state`
Expected: FAIL — module `./error-state` not found.

- [ ] **Step 3.3: Implement `error-state.tsx`**

Create `packages/web/src/components/ui/error-state.tsx`:

```tsx
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title?: string;
  description?: string;
  retry?: () => void;
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  description,
  retry,
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 py-12 text-center",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="font-medium text-destructive">{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {retry && (
        <Button variant="outline" size="sm" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 3.4: Run test to verify it passes**

Run: `bun run --cwd packages/web test -- error-state`
Expected: PASS — 4 tests green.

- [ ] **Step 3.5: Commit**

```bash
git add packages/web/src/components/ui/error-state.tsx packages/web/src/components/ui/error-state.test.tsx
git commit -m "feat(web): 添加 ErrorState 状态原语"
```

---

## Task 4: Land LoadingSkeleton + EmptyState into History.tsx

**Files:**
- Modify: `packages/web/src/pages/History.tsx`

- [ ] **Step 4.1: Add imports**

Open `packages/web/src/pages/History.tsx`. The current lucide import (line 2) is:

```tsx
import { AlertCircle, ChevronLeft, ChevronRight, Search, Trash2, X } from "lucide-react";
```

Replace it with (adds `Inbox`):

```tsx
import { AlertCircle, ChevronLeft, ChevronRight, Inbox, Search, Trash2, X } from "lucide-react";
```

Then, after the existing `import { Card } from "@/components/ui/card";` line (line 7), add two new imports:

```tsx
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
```

- [ ] **Step 4.2: Replace the loading + empty branches**

In `History.tsx`, find this block (around lines 280-285):

```tsx
      {loading ? (
        <div className="text-center py-16 text-muted-foreground">Loading...</div>
      ) : !data || tasks.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">{search ? `No results for "${search}"` : "No records yet"}</p>
        </Card>
      ) : (
```

Replace ONLY those two branches (keep the `) : (` that opens the table branch) with:

```tsx
      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : !data || tasks.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={search ? "No results found" : "No records yet"}
          description={
            search
              ? `Nothing matched "${search}"`
              : "Upload a document and it will appear here"
          }
        />
      ) : (
```

- [ ] **Step 4.3: Verify typecheck + tests pass**

Run: `bun run typecheck && bun run test`
Expected: PASS. (The `Card` import is still used by the table branch, so it stays.)

- [ ] **Step 4.4: Commit**

```bash
git add packages/web/src/pages/History.tsx
git commit -m "feat(web): History 页 loading/empty 改用状态原语"
```

---

## Task 5: Land ErrorState into Upload.tsx

**Files:**
- Modify: `packages/web/src/pages/Upload.tsx`

- [ ] **Step 5.1: Swap the Alert import for ErrorState**

Open `packages/web/src/pages/Upload.tsx`. Find the import (line 5):

```tsx
import { Alert, AlertDescription } from "@/components/ui/alert";
```

Replace it with:

```tsx
import { ErrorState } from "@/components/ui/error-state";
```

- [ ] **Step 5.2: Replace the error block**

Find the error block at the bottom of the component (around lines 110-114):

```tsx
      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
```

Replace with:

```tsx
      {error && <ErrorState className="mt-4" title="Upload failed" description={error} />}
```

Rationale: the upload error is recoverable by re-dragging a file, so no `retry` handler is wired — the dropzone itself is the retry affordance.

- [ ] **Step 5.3: Verify typecheck + tests + lint pass**

Run: `bun run typecheck && bun run test`
Expected: PASS. The `Alert`/`AlertDescription` imports are fully removed and no longer referenced anywhere in `Upload.tsx`.

- [ ] **Step 5.4: Commit**

```bash
git add packages/web/src/pages/Upload.tsx
git commit -m "feat(web): Upload 页错误态改用 ErrorState"
```

---

## Task 6: End-to-end verification

**Files:** None (verification only).

- [ ] **Step 6.1: Run full check suite**

Run: `bun run typecheck && bun run test`
Expected: all green. Web test count rises from 12 → 23 (4 EmptyState + 3 LoadingSkeleton + 4 ErrorState).

- [ ] **Step 6.2: Start dev server**

Run: `bun run dev`
Expected: web on `http://localhost:5173`, server on `http://localhost:3001`.

- [ ] **Step 6.3: Manual checklist (browser)**

Sign in (or register a throwaway user), then verify in BOTH light and dark mode:

1. **History loading skeleton**: Navigate to `/history`. On first load (before data arrives) you should briefly see 6 pulsing gray bars instead of the old "Loading..." text. (If data loads too fast to see, throttle network in devtools or just confirm no "Loading..." text remains.)
2. **History empty state**: With a brand-new user that has no tasks, `/history` shows the `EmptyState` — an Inbox icon, "No records yet", and the description line. Confirm readable in dark mode (muted background, not washed out).
3. **History empty search**: Type a query that matches nothing in the search box. The empty state title becomes "No results found" with `Nothing matched "<query>"`.
4. **Upload error state**: On `/`, force an upload failure (e.g. stop the backend server, then drop a file). The error renders as the `ErrorState` block (AlertCircle in a red circle, "Upload failed", the error message) below the dropzone. Confirm the red tint is visible but not harsh in dark mode.

- [ ] **Step 6.4: Record any issues**

If any check fails, capture a screenshot and note it in `docs/superpowers/phase-3a-followups.md`. Do NOT silently leave issues.

- [ ] **Step 6.5: Commit verification doc if created**

```bash
# Only if phase-3a-followups.md was created in Step 6.4:
git add docs/superpowers/phase-3a-followups.md
git commit -m "docs: Phase 3a 已知遗留项"
```

---

## Phase 3a Completion Criteria

- [ ] All 6 tasks committed
- [ ] `bun run typecheck && bun run test` all pass (web 12 → 23 tests)
- [ ] Browser verification (Step 6.3) all 4 items pass in light + dark
- [ ] No bare "Loading..." text or raw `Alert` error left in History/Upload

## Self-Review Checklist (already performed)

- ✅ **Spec coverage:** spec §6.2 — `EmptyState` → Task 1; `LoadingSkeleton` → Task 2; `ErrorState` → Task 3; History landing → Task 4; Upload landing → Task 5; verification → Task 6.
- ✅ **No placeholders:** every component + test has complete code; every command shows expected result.
- ✅ **Type consistency:** `EmptyStateProps.icon` and the lucide `Inbox` passed in Task 4 both use `ComponentType<{ className?: string }>`-compatible shape. `ErrorState` prop names (`title`, `description`, `retry`, `className`) are identical between Task 3 definition and Task 5 usage. `LoadingSkeleton` `rows` prop used in Task 4 matches Task 2 definition.

## What Phase 3a does NOT cover

Out of scope (later sub-PRs of Phase 3):
- **3b**: Header redesign (user-menu dropdown, ThemeToggle relocation).
- **3c**: Form consistency (`FormField`, `useFormSubmit`, Button `loading` prop).
- **3d**: TaskDetail rework (toolbar, panel borders, block selection state).
