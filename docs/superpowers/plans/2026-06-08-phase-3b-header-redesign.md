# Phase 3b: Header Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the header's email/API Docs/Logout into a user-menu dropdown, keeping the ThemeToggle as a separate segmented control, reducing top-bar density.

**Architecture:** A new shadcn-style `DropdownMenu` wrapper around `@base-ui/react`'s `Menu` primitive (same wrapping pattern as the existing `tooltip.tsx`). Then `App.tsx`'s `AuthHeader` is rebuilt: a `UserMenu` shows an avatar initial + chevron trigger; the dropdown holds the email (label), API Docs, and Logout. ThemeToggle stays visible next to it.

**Tech Stack:** React 19, `@base-ui/react` Menu (v1.3.0, already a dependency), lucide-react, Tailwind v4.

**Spec:** [`docs/superpowers/specs/2026-06-08-dark-theme-and-ui-polish-design.md`](../specs/2026-06-08-dark-theme-and-ui-polish-design.md) §6.3 (Phase 3b)

---

## File Structure

**New files:**
- `packages/web/src/components/ui/dropdown-menu.tsx` — shadcn-style wrapper around base-ui Menu (Root/Trigger/Content/Item/Separator/Label)

**Modified files:**
- `packages/web/src/App.tsx` — rebuild `AuthHeader`, add a `UserMenu` component, drop the flat email span + API Docs + Logout buttons

**Boundary rule:** `dropdown-menu.tsx` is a thin styling/composition wrapper over a trusted library (`@base-ui/react`), exactly like the existing `tooltip.tsx` — it gets NO unit test (jsdom portal/positioner tests are flaky and add no value over the library's own tests). Phase 3b is verified by browser interaction (Task 3), which is the real gate for menu open/close/click behavior.

---

## Task 1: DropdownMenu wrapper component

**Files:**
- Create: `packages/web/src/components/ui/dropdown-menu.tsx`

- [ ] **Step 1.1: Implement the wrapper**

Create `packages/web/src/components/ui/dropdown-menu.tsx`:

```tsx
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type * as React from "react";
import { cn } from "@/lib/utils";

function DropdownMenu(props: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root {...props} />;
}

function DropdownMenuTrigger({ className, ...props }: MenuPrimitive.Trigger.Props) {
  return (
    <MenuPrimitive.Trigger
      data-slot="dropdown-trigger"
      className={cn("outline-none", className)}
      {...props}
    />
  );
}

function DropdownMenuContent({
  className,
  align = "end",
  sideOffset = 6,
  children,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<MenuPrimitive.Positioner.Props, "align" | "sideOffset">) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner align={align} sideOffset={sideOffset} className="z-50">
        <MenuPrimitive.Popup
          data-slot="dropdown-content"
          className={cn(
            "min-w-[12rem] origin-(--transform-origin) rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function DropdownMenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-item"
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors select-none data-[highlighted]:bg-muted data-[highlighted]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-separator"
      className={cn("my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function DropdownMenuLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dropdown-label"
      className={cn("px-2.5 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
```

- [ ] **Step 1.2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: PASS — the `MenuPrimitive.*.Props` namespace types resolve (same pattern as `tooltip.tsx` uses for `TooltipPrimitive.*.Props`).

If typecheck fails on a `.Props` type not existing, inspect `packages/web/src/components/ui/tooltip.tsx` for the exact base-ui import/type convention and adapt. Do NOT use `any`.

- [ ] **Step 1.3: Commit**

```bash
git add packages/web/src/components/ui/dropdown-menu.tsx
git commit -m "feat(web): 添加 DropdownMenu 组件（base-ui Menu 封装）"
```

---

## Task 2: Rebuild AuthHeader with UserMenu

**Files:**
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 2.1: Update the lucide import**

Open `packages/web/src/App.tsx`. The current import (line 1) is:

```tsx
import { BookOpen, FileText, History, LogOut, Settings, Upload, User } from "lucide-react";
```

Replace it with (removes `User`, adds `ChevronDown`):

```tsx
import { BookOpen, ChevronDown, FileText, History, LogOut, Settings, Upload } from "lucide-react";
```

- [ ] **Step 2.2: Add the dropdown-menu import**

After the existing `import { ThemeToggle } from "@/components/ui/theme-toggle";` line (line 5), add:

```tsx
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
```

- [ ] **Step 2.3: Replace the AuthHeader function**

Find the entire `AuthHeader` function (lines 29-65, from `function AuthHeader() {` to its closing `}`):

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

Replace it with a `UserMenu` component + a slimmer `AuthHeader`:

```tsx
function UserMenu({ email, onLogout }: { email: string; onLogout: () => void }) {
  const initial = email.charAt(0).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg border border-border bg-background/60 px-2 py-1 text-sm transition-colors hover:bg-muted aria-expanded:bg-muted">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-primary to-chart-5 text-xs font-semibold text-primary-foreground">
          {initial}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => window.open("/docs", "_blank", "noopener,noreferrer")}>
          <BookOpen />
          API Docs
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onLogout}>
          <LogOut />
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AuthHeader() {
  const { user, logout } = useAuth();
  return (
    <div className="flex items-center gap-2">
      <ThemeToggle />
      {user ? (
        <UserMenu email={user.email} onLogout={logout} />
      ) : (
        <NavLink to="/login">
          <Button variant="ghost" size="sm">
            Sign In
          </Button>
        </NavLink>
      )}
    </div>
  );
}
```

Rationale: ThemeToggle stays a visible segmented control; email/API Docs/Logout collapse into the dropdown. The `Sign In` branch is retained for safety even though `AppHeader` only renders when `user` is set.

- [ ] **Step 2.4: Verify Button is still imported and used**

After the edit, `Button` is still used by the `Sign In` NavLink and by the nav items in `AppHeader`. Confirm the `import { Button } from "@/components/ui/button";` line (line 3) stays. `Separator` (line 4) is still used by `AppHeader`'s vertical divider — keep it too.

- [ ] **Step 2.5: Verify typecheck + tests pass**

Run: `bun run typecheck && bun run test`
Expected: PASS. Web tests stay at 23 (no test imports `App.tsx`). No unused-import lint errors (`User` removed, `ChevronDown` added and used).

- [ ] **Step 2.6: Commit**

```bash
git add packages/web/src/App.tsx
git commit -m "feat(web): Header 用户菜单收纳 email/API Docs/Logout"
```

---

## Task 3: Browser verification

**Files:** None (verification only).

- [ ] **Step 3.1: Run full check suite**

Run: `bun run typecheck && bun run test`
Expected: all green (server 95 + web 23).

- [ ] **Step 3.2: Start dev server**

Run: `bun run dev`
Expected: web on `http://localhost:5173`, server on `http://localhost:3001`.

- [ ] **Step 3.3: Manual checklist (browser)**

Sign in (or register a throwaway user), then verify in BOTH light and dark:

1. **Header density**: The top bar now shows ThemeToggle (segmented) + a compact avatar button with a chevron — NOT the old flat email text / API Docs / Logout buttons.
2. **Menu opens**: Click the avatar button → a dropdown opens, aligned to the right edge, showing: the email (muted label) on top, a separator, "API Docs", "Logout".
3. **Highlight state**: Hover/arrow-key through the items — the highlighted item gets a muted background. Readable in dark mode (popover background distinct from page background).
4. **API Docs**: Click "API Docs" → opens `/docs` in a new tab; menu closes.
5. **Logout**: Click "Logout" → session ends, redirected to `/login`.
6. **Keyboard**: Open with Enter/Space on the trigger; Escape closes; arrow keys move highlight. (base-ui handles this — just confirm nothing is broken.)

- [ ] **Step 3.4: Record any issues**

If any check fails, capture a screenshot and note it in `docs/superpowers/phase-3b-followups.md`. Do NOT silently leave issues.

- [ ] **Step 3.5: Commit verification doc if created**

```bash
# Only if phase-3b-followups.md was created:
git add docs/superpowers/phase-3b-followups.md
git commit -m "docs: Phase 3b 已知遗留项"
```

---

## Phase 3b Completion Criteria

- [ ] Both code tasks committed
- [ ] `bun run typecheck && bun run test` pass (web stays 23)
- [ ] Browser verification (Step 3.3) all 6 items pass in light + dark
- [ ] No flat email/API Docs/Logout buttons left in the header

## Self-Review Checklist (already performed)

- ✅ **Spec coverage:** spec §6.3 — DropdownMenu primitive → Task 1; ThemeToggle stays separate + email/API Docs/Logout collapsed into user dropdown → Task 2; verification → Task 3.
- ✅ **No placeholders:** every component + edit has complete code; commands show expected output.
- ✅ **Type consistency:** `dropdown-menu.tsx` export names (`DropdownMenu`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`, `DropdownMenuTrigger`) match exactly the import list in Task 2. `UserMenu` props (`email: string`, `onLogout: () => void`) match the call site `<UserMenu email={user.email} onLogout={logout} />`.

## What Phase 3b does NOT cover

Out of scope (later sub-PRs of Phase 3):
- **3c**: Form consistency (`FormField`, `useFormSubmit`, Button `loading` prop).
- **3d**: TaskDetail rework (toolbar, panel borders, block selection state).
