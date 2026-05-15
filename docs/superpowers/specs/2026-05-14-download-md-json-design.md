# Download MD / JSON — Design Spec

**Date:** 2026-05-14  
**Status:** Approved

## Overview

Add two download buttons to the `TaskDetail` page toolbar so users can export OCR results as a Markdown file or a JSON file directly from the browser.

## Architecture

Pure frontend implementation. No backend changes required. Both `result_md` and `content_list` are already loaded into page state when a task is `completed`. Downloads are triggered via the browser's Blob URL API.

## Components

### DownloadButton (new, `packages/web/src/components/task-detail/DownloadButton.tsx`)

A small reusable component following the same pattern as `CopyButton`.

**Props:**
```typescript
interface DownloadButtonProps {
  content: string;
  filename: string;
  label: string;
  mimeType: string;
}
```

**Behavior:**
- Creates a `Blob` from `content` with the given `mimeType`
- Generates a temporary object URL, clicks an invisible `<a>` element, then revokes the URL
- Renders a `Button` (ghost, size icon or sm) with a `Download` icon and label, wrapped in a `Tooltip`

### TaskDetail.tsx (modified)

Add two `DownloadButton` instances to the toolbar, immediately after the existing `CopyButton` on line 550:

```tsx
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

## Filename Logic

Strip the file extension from `original_name` using a local `basename` helper:

```typescript
function basename(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}
```

Example: `report.pdf` → `report.md` / `report.json`

## Visibility Rules

- Both buttons only render when `!editing`
- MD button only renders when `task.result_md` is non-null
- JSON button only renders when `task.content_list` is non-null
- No additional `status === "completed"` guard needed — data nullability already handles it

## Placement

Top toolbar, after the existing `CopyButton` (line 550 of `TaskDetail.tsx`).

## Error Handling

No async errors possible — all data is already in memory. If `Blob` or `URL.createObjectURL` fails (extremely rare browser error), the download silently no-ops. No user-facing error state needed.

## Testing

Unit tests for `DownloadButton`:
- Renders with correct label
- Triggers download with correct filename and content on click
- Does not render when `content` is falsy (guard at call site)
