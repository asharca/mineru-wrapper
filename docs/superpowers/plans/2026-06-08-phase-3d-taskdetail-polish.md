# Phase 3d: TaskDetail Block Selection Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the one outstanding TaskDetail visual item from spec §6.5 — the block selection state — by giving the active block a clear `ring-2 ring-primary` + `bg-primary/5` treatment that reads well in both light and dark, and lock it with a unit test.

**Architecture:** A single, surgical change to `BlockView.tsx`'s active-block class set, plus a focused `BlockView.test.tsx`. No structural changes to the 868-line `TaskDetail.tsx` toolbar (spec §6.5 says "结构不动，视觉与密度调整"). This plan is intentionally lean: the other 3d items (PDF/image white-bg containers, block-type dark-mode tag variants) were already delivered in Phase 1 and merged.

**Tech Stack:** React 19, Tailwind v4, Vitest + Testing Library.

**Spec:** [`docs/superpowers/specs/2026-06-08-dark-theme-and-ui-polish-design.md`](../specs/2026-06-08-dark-theme-and-ui-polish-design.md) §6.5 (Phase 3d)

---

## Scope Note (read first)

Spec §6.5 listed four 3d items. Three are already DONE (merged in Phase 1):

| §6.5 item | Status |
|---|---|
| 左面板：暗色下白底容器 | ✅ Phase 1 — `PdfViewer`/`ImageOverlay` got `bg-white` |
| 右面板：block 标签复用 dark variant | ✅ Phase 1 — `.dark .block-type-*` variants in `index.css` |
| Allotment 拖动条暗色可见 | ✅ Phase 1 — `.dark [class*="sash-module_..."]` |
| **Block 选中态：ring-2 ring-primary + bg-primary/5** | ❌ outstanding — THIS plan |

The toolbar reorg ("顶部工具栏重新梳理") is deliberately NOT attempted: `TaskDetail.tsx`'s top bar already has filename+status on the left and the tool cluster on the right, and it carries many conditional states (editing / processing / search / rotation). Rewriting it is high-risk, low-reward, and violates the spec's "结构不动" directive. It is left as-is.

---

## File Structure

**New files:**
- `packages/web/src/components/task-detail/BlockView.test.tsx` — focused test for the active-block ring

**Modified files:**
- `packages/web/src/components/task-detail/BlockView.tsx` — active-block class: ring instead of border+shadow

**Boundary rule:** Only the active-block `className` expression changes. The block rendering (number badge, type badge, copy button, edit textareas, markdown/table/list/image branches) is untouched.

---

## Task 1: Ring-based block selection state + test

**Files:**
- Modify: `packages/web/src/components/task-detail/BlockView.tsx`
- Create: `packages/web/src/components/task-detail/BlockView.test.tsx`

- [ ] **Step 1.1: Write the failing test**

Create `packages/web/src/components/task-detail/BlockView.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ContentBlock } from "../../api.ts";
import { BlockView } from "./BlockView";

const blocks: ContentBlock[] = [
  { type: "text", text: "first", bbox: [0, 0, 1, 1], page_idx: 0 },
  { type: "text", text: "second", bbox: [0, 0, 1, 1], page_idx: 0 },
];

function noop() {}

function refs() {
  return { current: new Map<number, HTMLDivElement>() };
}

describe("BlockView", () => {
  it("rings exactly the active block", () => {
    const { container } = render(
      <BlockView
        blocks={blocks}
        activeBlock={0}
        blockRefs={refs()}
        onBlockHover={noop}
        editing={false}
        editBlocks={[]}
        onEditBlock={noop}
      />,
    );
    expect(container.querySelectorAll(".ring-2").length).toBe(1);
  });

  it("rings no block when none is active", () => {
    const { container } = render(
      <BlockView
        blocks={blocks}
        activeBlock={null}
        blockRefs={refs()}
        onBlockHover={noop}
        editing={false}
        editBlocks={[]}
        onEditBlock={noop}
      />,
    );
    expect(container.querySelectorAll(".ring-2").length).toBe(0);
  });

  it("shows an empty message when there are no blocks", () => {
    const { getByText } = render(
      <BlockView
        blocks={[]}
        activeBlock={null}
        blockRefs={refs()}
        onBlockHover={noop}
        editing={false}
        editBlocks={[]}
        onEditBlock={noop}
      />,
    );
    expect(getByText("No regions detected")).toBeInTheDocument();
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `bun run --cwd packages/web test -- BlockView`
Expected: FAIL — the "rings exactly the active block" test finds 0 `.ring-2` elements (current code uses `border-primary/40 shadow-sm`, no ring). The empty-message test passes; the no-active test passes (0 rings).

- [ ] **Step 1.3: Change the active-block class**

Open `packages/web/src/components/task-detail/BlockView.tsx`. Find the block container `className` (around lines 48-53):

```tsx
          className={cn(
            "px-4 py-3 rounded-lg border transition-all",
            activeBlock === i
              ? "bg-primary/5 border-primary/40 shadow-sm"
              : "border-transparent hover:bg-muted/50",
          )}
```

Replace the active branch (`"bg-primary/5 border-primary/40 shadow-sm"`) so the whole expression becomes:

```tsx
          className={cn(
            "px-4 py-3 rounded-lg border transition-all",
            activeBlock === i
              ? "bg-primary/5 ring-2 ring-primary/60 border-transparent"
              : "border-transparent hover:bg-muted/50",
          )}
```

Rationale: spec §6.5 calls for `ring-2 ring-primary` + `bg-primary/5`. The ring renders clearly on both light and dark backgrounds (the previous `border-primary/40 shadow-sm` was faint in dark mode). `ring-primary/60` softens it slightly so it doesn't overpower the content. `border-transparent` keeps the box size stable (no layout shift vs the inactive `border-transparent`).

- [ ] **Step 1.4: Run test to verify it passes**

Run: `bun run --cwd packages/web test -- BlockView`
Expected: PASS — 3 tests green.

- [ ] **Step 1.5: Commit**

```bash
git add packages/web/src/components/task-detail/BlockView.tsx packages/web/src/components/task-detail/BlockView.test.tsx
git commit -m "feat(web): TaskDetail block 选中态改用 ring-2 ring-primary"
```

---

## Task 2: Browser verification

**Files:** None (verification only).

- [ ] **Step 2.1: Run full check suite**

Run: `bun run typecheck && bun run test`
Expected: all green. Web test count rises from 33 → 36 (3 new BlockView tests).

- [ ] **Step 2.2: Start dev server**

Run: `bun run dev`
Expected: web on `http://localhost:5173`, server on `http://localhost:3001`.

- [ ] **Step 2.3: Manual checklist (browser)**

Sign in, open a completed task (History → click a row → TaskDetail). Verify in BOTH light and dark:

1. **Blocks view selection**: Click the "Blocks" toggle in the top bar. Hover/click a region in the left PDF/image panel → the corresponding block in the right list gets a visible primary-colored ring (`ring-2`) with a faint primary tint. Confirm the ring is clearly visible in dark mode (was faint before).
2. **Only one ring**: Only the active block is ringed; others have no ring.
3. **No layout shift**: Selecting a block does not nudge the layout (the ring sits inside the existing box; `border-transparent` keeps width stable).
4. **Document view unaffected**: Switch back to "Document" — the rendered markdown view is unchanged.
5. **Left panel still white**: The PDF/image preview area still has its white background (Phase 1) framed by the dark panel in dark mode.

- [ ] **Step 2.4: Record any issues**

If any check fails, capture a screenshot and note it in `docs/superpowers/phase-3d-followups.md`. Do NOT silently leave issues.

- [ ] **Step 2.5: Commit verification doc if created**

```bash
# Only if phase-3d-followups.md was created:
git add docs/superpowers/phase-3d-followups.md
git commit -m "docs: Phase 3d 已知遗留项"
```

---

## Phase 3d Completion Criteria

- [ ] Task 1 committed
- [ ] `bun run typecheck && bun run test` pass (web 33 → 36)
- [ ] Browser verification (Step 2.3) all 5 items pass in light + dark
- [ ] Active block uses `ring-2 ring-primary` + `bg-primary/5`

## Self-Review Checklist (already performed)

- ✅ **Spec coverage:** spec §6.5 block-selection-state → Task 1. The other §6.5 items were delivered in Phase 1 (documented in the Scope Note); the toolbar reorg is intentionally skipped per "结构不动".
- ✅ **No placeholders:** the test and the exact class change are fully specified; commands show expected output.
- ✅ **Type consistency:** the test constructs `ContentBlock[]` with `type`/`text`/`bbox`/`page_idx` and passes `blockRefs` as `{ current: new Map<number, HTMLDivElement>() }`, matching `BlockView`'s `React.RefObject<Map<number, HTMLDivElement>>` prop. `activeBlock` is `number | null` as in the component.

## What Phase 3d does NOT cover

- Toolbar structural rewrite (intentionally skipped — `TaskDetail.tsx` top bar stays as-is per spec "结构不动").
- PDF/image white-bg containers and block-type dark tag variants — already shipped in Phase 1.
- This is the final sub-PR of Phase 3; after it merges, the spec's three-phase initiative is complete.
