# Download MD / JSON Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Download MD" and "Download JSON" buttons to the TaskDetail toolbar so users can export OCR results as files directly from the browser.

**Architecture:** Pure frontend — both `result_md` and `content_list` are already loaded in page state. A new `DownloadButton` component creates a Blob URL and triggers a browser download. No backend changes needed.

**Tech Stack:** React 19, TypeScript, Vitest + jsdom + @testing-library/react (new), lucide-react, shadcn/ui Button + Tooltip

---

### Task 1: Set up Vitest for the web package

**Files:**
- Modify: `packages/web/package.json`
- Modify: `packages/web/vite.config.ts`
- Create: `packages/web/src/test-setup.ts`

- [ ] **Step 1: Install test dependencies**

```bash
cd packages/web && bun add -d vitest @vitest/ui jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

Expected: packages added to `devDependencies` in `packages/web/package.json`.

- [ ] **Step 2: Add test scripts to package.json**

In `packages/web/package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Configure vitest in vite.config.ts**

Replace the top of `packages/web/vite.config.ts` with a `/// <reference types="vitest" />` directive and add a `test` block:

```typescript
/// <reference types="vitest" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
  server: {
    port: 5173,
    proxy: {
      "/upload": "http://localhost:3001",
      "/api": "http://localhost:3001",
      "/tasks": "http://localhost:3001",
      "/files": "http://localhost:3001",
      "/docs": "http://localhost:3001",
      "/swagger": "http://localhost:3001",
    },
  },
});
```

- [ ] **Step 4: Create test setup file**

Create `packages/web/src/test-setup.ts`:
```typescript
import "@testing-library/jest-dom";
```

- [ ] **Step 5: Verify setup runs**

```bash
cd packages/web && bun test
```

Expected: `No test files found` (no error, zero tests run).

- [ ] **Step 6: Commit**

```bash
git add packages/web/package.json packages/web/bun.lock packages/web/vite.config.ts packages/web/src/test-setup.ts
git commit -m "chore: add vitest to web package"
```

---

### Task 2: Create DownloadButton component (TDD)

**Files:**
- Create: `packages/web/src/components/task-detail/DownloadButton.tsx`
- Create: `packages/web/src/components/task-detail/DownloadButton.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/task-detail/DownloadButton.test.tsx`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/web && bun test DownloadButton
```

Expected: FAIL — `Cannot find module './DownloadButton'`

- [ ] **Step 3: Implement DownloadButton**

Create `packages/web/src/components/task-detail/DownloadButton.tsx`:

```typescript
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface DownloadButtonProps {
  content: string;
  filename: string;
  label: string;
  mimeType: string;
}

export function DownloadButton({ content, filename, label, mimeType }: DownloadButtonProps) {
  const handleDownload = () => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[11px] gap-1"
          onClick={handleDownload}
        >
          <Download className="h-3 w-3" />
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/web && bun test DownloadButton
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/task-detail/DownloadButton.tsx packages/web/src/components/task-detail/DownloadButton.test.tsx
git commit -m "feat: add DownloadButton component"
```

---

### Task 3: Integrate DownloadButton into TaskDetail toolbar

**Files:**
- Modify: `packages/web/src/pages/TaskDetail.tsx`

- [ ] **Step 1: Add import and basename helper**

In `packages/web/src/pages/TaskDetail.tsx`, add the import after the existing `CopyButton` import (around line 48):

```typescript
import { DownloadButton } from "../components/task-detail/DownloadButton.tsx";
```

Add a module-level helper just before the `STATUS_CONFIG` constant (around line 56):

```typescript
function basename(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}
```

- [ ] **Step 2: Add the two download buttons to the toolbar**

Find the existing `CopyButton` line in the toolbar (line ~550):

```tsx
{!editing && <CopyButton text={task.result_md || ""} label="Copy MD" />}
```

Replace it with:

```tsx
{!editing && <CopyButton text={task.result_md || ""} label="Copy MD" />}
{!editing && task.result_md && (
  <DownloadButton
    content={task.result_md}
    filename={`${basename(task.original_name)}.md`}
    label="Download MD"
    mimeType="text/markdown"
  />
)}
{!editing && task.content_list && (
  <DownloadButton
    content={JSON.stringify(task.content_list, null, 2)}
    filename={`${basename(task.original_name)}.json`}
    label="Download JSON"
    mimeType="application/json"
  />
)}
```

- [ ] **Step 3: TypeScript check**

```bash
cd packages/web && bun run build 2>&1 | head -30
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Manual browser verification**

```bash
cd packages/web && bun run dev
```

1. Open `http://localhost:5173`
2. Navigate to a completed task
3. Verify "Download MD" button appears in the toolbar next to "Copy MD"
4. Verify "Download JSON" button appears next to "Download MD"
5. Click "Download MD" — browser should download a `.md` file named after the original document
6. Click "Download JSON" — browser should download a `.json` file named after the original document
7. Open both downloaded files and verify content is correct

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/pages/TaskDetail.tsx
git commit -m "feat: add download MD and JSON buttons to TaskDetail toolbar"
```
