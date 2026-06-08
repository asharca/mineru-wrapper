# Phase 3c: Form Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the auth/settings forms consistent by adding a `loading` prop to `Button` (spinner + disabled), a `FormField` label/control wrapper, and a `useFormSubmit` hook, then applying them to Login, Register, and the Settings "Create Key" button.

**Architecture:** Three small reusable units — `Button.loading` (spinner via `Loader2`), `FormField` (vertical Label + control + optional hint/error), `useFormSubmit` (wraps an async submit fn, managing `loading`/`error`). Login and Register adopt all three; Settings adopts only `Button.loading` for its async "Create Key" action (its horizontal `SettingRow` layout is a separate, already-good pattern and is left untouched).

**Tech Stack:** React 19, `@base-ui/react` Button, lucide-react, Tailwind v4, Vitest + Testing Library (`renderHook`).

**Spec:** [`docs/superpowers/specs/2026-06-08-dark-theme-and-ui-polish-design.md`](../specs/2026-06-08-dark-theme-and-ui-polish-design.md) §6.4 (Phase 3c)

---

## File Structure

**New files:**
- `packages/web/src/components/ui/form-field.tsx` — Label + children + optional hint/error
- `packages/web/src/components/ui/form-field.test.tsx`
- `packages/web/src/components/ui/button.test.tsx` — covers the new `loading` prop
- `packages/web/src/hooks/use-form-submit.ts` — submit-wrapper hook
- `packages/web/src/hooks/use-form-submit.test.ts`

**Modified files:**
- `packages/web/src/components/ui/button.tsx` — add `loading?: boolean`
- `packages/web/src/pages/Login.tsx` — use FormField + useFormSubmit + Button loading
- `packages/web/src/pages/Register.tsx` — same
- `packages/web/src/pages/Settings.tsx` — Button loading on "Create Key"

**Boundary rule:** `FormField` is purely presentational (no state). `useFormSubmit` owns only `loading`/`error` for one async submit; per-form validation lives in the caller (thrown as `Error` inside the submitted fn). Settings' `SettingRow` is NOT replaced — it's a different (horizontal) layout serving auto-save rows.

---

## Task 1: Add `loading` prop to Button

**Files:**
- Modify: `packages/web/src/components/ui/button.tsx`
- Create: `packages/web/src/components/ui/button.test.tsx`

- [ ] **Step 1.1: Write the failing test**

Create `packages/web/src/components/ui/button.test.tsx`:

```tsx
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
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `bun run --cwd packages/web test -- button`
Expected: FAIL — the `loading` test fails (no spinner rendered yet) because the prop isn't handled.

- [ ] **Step 1.3: Add the `loading` prop**

Open `packages/web/src/components/ui/button.tsx`. Replace the import line (line 1-4) — add the `Loader2` import:

```tsx
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
```

Then replace the `Button` function (lines 43-56) with:

```tsx
function Button({
  className,
  variant = "default",
  size = "default",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants> & { loading?: boolean }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={loading || disabled}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" />}
      {children}
    </ButtonPrimitive>
  );
}
```

Rationale: `buttonVariants` already sizes bare SVGs (`[&_svg:not([class*='size-'])]:size-4`), so `Loader2` with only `animate-spin` inherits the right size. `disabled={loading || disabled}` preserves existing `disabled` usages (default `loading=false` → unchanged).

- [ ] **Step 1.4: Run test to verify it passes**

Run: `bun run --cwd packages/web test -- button`
Expected: PASS — 4 tests green.

- [ ] **Step 1.5: Commit**

```bash
git add packages/web/src/components/ui/button.tsx packages/web/src/components/ui/button.test.tsx
git commit -m "feat(web): Button 增加 loading 态（spinner + 禁用）"
```

---

## Task 2: FormField component

**Files:**
- Create: `packages/web/src/components/ui/form-field.tsx`
- Create: `packages/web/src/components/ui/form-field.test.tsx`

- [ ] **Step 2.1: Write the failing test**

Create `packages/web/src/components/ui/form-field.test.tsx`:

```tsx
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
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `bun run --cwd packages/web test -- form-field`
Expected: FAIL — module `./form-field` not found.

- [ ] **Step 2.3: Implement `form-field.tsx`**

Create `packages/web/src/components/ui/form-field.tsx`:

```tsx
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FormFieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}

export function FormField({ label, htmlFor, hint, error, children, className }: FormFieldProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `bun run --cwd packages/web test -- form-field`
Expected: PASS — 3 tests green.

- [ ] **Step 2.5: Commit**

```bash
git add packages/web/src/components/ui/form-field.tsx packages/web/src/components/ui/form-field.test.tsx
git commit -m "feat(web): 添加 FormField 表单字段组件"
```

---

## Task 3: useFormSubmit hook

**Files:**
- Create: `packages/web/src/hooks/use-form-submit.ts`
- Create: `packages/web/src/hooks/use-form-submit.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `packages/web/src/hooks/use-form-submit.test.ts`:

```ts
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
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `bun run --cwd packages/web test -- use-form-submit`
Expected: FAIL — module `./use-form-submit` not found.

- [ ] **Step 3.3: Implement `use-form-submit.ts`**

Create `packages/web/src/hooks/use-form-submit.ts`:

```ts
import { type FormEvent, useCallback, useState } from "react";

interface UseFormSubmit {
  loading: boolean;
  error: string;
  setError: (message: string) => void;
  submit: (fn: () => Promise<void>) => (e: FormEvent) => Promise<void>;
}

export function useFormSubmit(): UseFormSubmit {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = useCallback(
    (fn: () => Promise<void>) => async (e: FormEvent) => {
      e.preventDefault();
      setError("");
      setLoading(true);
      try {
        await fn();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { loading, error, setError, submit };
}
```

- [ ] **Step 3.4: Run test to verify it passes**

Run: `bun run --cwd packages/web test -- use-form-submit`
Expected: PASS — 3 tests green.

- [ ] **Step 3.5: Commit**

```bash
git add packages/web/src/hooks/use-form-submit.ts packages/web/src/hooks/use-form-submit.test.ts
git commit -m "feat(web): 添加 useFormSubmit 表单提交 hook"
```

---

## Task 4: Adopt in Login.tsx

**Files:**
- Modify: `packages/web/src/pages/Login.tsx`

- [ ] **Step 4.1: Replace the whole file**

Open `packages/web/src/pages/Login.tsx`. Replace the ENTIRE file contents with:

```tsx
import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useFormSubmit } from "@/hooks/use-form-submit";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { login } = useAuth();
  const navigate = useNavigate();
  const { loading, error, submit } = useFormSubmit();

  const onSubmit = submit(async () => {
    await login(email, password);
    navigate("/");
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign In</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <FormField label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Password" htmlFor="password">
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </FormField>
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" loading={loading}>
              Sign In
            </Button>
            <p className="text-sm text-muted-foreground text-center">
              Don't have an account?{" "}
              <Link to="/register" className="text-primary hover:underline">
                Sign up
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4.2: Verify typecheck + tests pass**

Run: `bun run typecheck && bun run test`
Expected: PASS. (`Label` is no longer imported in Login — `FormField` owns it.)

- [ ] **Step 4.3: Commit**

```bash
git add packages/web/src/pages/Login.tsx
git commit -m "feat(web): Login 表单改用 FormField + useFormSubmit"
```

---

## Task 5: Adopt in Register.tsx

**Files:**
- Modify: `packages/web/src/pages/Register.tsx`

- [ ] **Step 5.1: Replace the whole file**

Open `packages/web/src/pages/Register.tsx`. Replace the ENTIRE file contents with:

```tsx
import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useFormSubmit } from "@/hooks/use-form-submit";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const { register } = useAuth();
  const navigate = useNavigate();
  const { loading, error, submit } = useFormSubmit();

  const onSubmit = submit(async () => {
    if (password !== confirmPassword) throw new Error("Passwords do not match");
    if (password.length < 8) throw new Error("Password must be at least 8 characters");
    await register(email, password, name);
    navigate("/");
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create Account</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <FormField label="Name (optional)" htmlFor="name">
              <Input
                id="name"
                type="text"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </FormField>
            <FormField label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Password" htmlFor="password">
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Confirm Password" htmlFor="confirm-password">
              <Input
                id="confirm-password"
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </FormField>
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" loading={loading}>
              Sign Up
            </Button>
            <p className="text-sm text-muted-foreground text-center">
              Already have an account?{" "}
              <Link to="/login" className="text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5.2: Verify typecheck + tests pass**

Run: `bun run typecheck && bun run test`
Expected: PASS.

- [ ] **Step 5.3: Commit**

```bash
git add packages/web/src/pages/Register.tsx
git commit -m "feat(web): Register 表单改用 FormField + useFormSubmit"
```

---

## Task 6: Button loading on Settings "Create Key"

**Files:**
- Modify: `packages/web/src/pages/Settings.tsx`

- [ ] **Step 6.1: Swap disabled → loading on the Create Key button**

Open `packages/web/src/pages/Settings.tsx`. Find the Create Key button (around lines 291-294):

```tsx
                <Button onClick={handleCreateKey} disabled={apiKeyLoading} className="gap-1.5">
                  <KeyRound className="h-4 w-4" />
                  Create Key
                </Button>
```

Replace with:

```tsx
                <Button onClick={handleCreateKey} loading={apiKeyLoading} className="gap-1.5">
                  {!apiKeyLoading && <KeyRound className="h-4 w-4" />}
                  Create Key
                </Button>
```

Rationale: `loading` shows the spinner and disables the button; hiding `KeyRound` while loading avoids a double icon (spinner + key).

- [ ] **Step 6.2: Verify typecheck + tests pass**

Run: `bun run typecheck && bun run test`
Expected: PASS. No other change to Settings.tsx — the auto-save `SettingRow` rows stay as-is.

- [ ] **Step 6.3: Commit**

```bash
git add packages/web/src/pages/Settings.tsx
git commit -m "feat(web): Settings 创建 Key 按钮使用 loading 态"
```

---

## Task 7: Browser verification

**Files:** None (verification only).

- [ ] **Step 7.1: Run full check suite**

Run: `bun run typecheck && bun run test`
Expected: all green. Web test count rises from 23 → 33 (4 Button + 3 FormField + 3 useFormSubmit).

- [ ] **Step 7.2: Start dev server**

Run: `bun run dev`
Expected: web on `http://localhost:5173`, server on `http://localhost:3001`.

- [ ] **Step 7.3: Manual checklist (browser)**

Verify in BOTH light and dark:

1. **Login layout intact**: `/login` shows Email + Password fields (FormField labels), submit button. Visually identical to before.
2. **Login error**: Submit with wrong credentials → the form-level error row (AlertCircle + message) appears; the submit button is NOT stuck disabled afterward.
3. **Login loading**: On submit, the button shows a spinner and is disabled while the request is in flight.
4. **Register validation**: On `/register`, enter mismatched passwords → "Passwords do not match" error; enter a <8-char password → "Password must be at least 8 characters". Both surface via the same error row.
5. **Register success**: A valid new account registers and redirects to `/`.
6. **Settings Create Key loading**: On `/settings`, click "Create Key" → the button shows a spinner (no key icon) while creating, then the new key panel appears.

- [ ] **Step 7.4: Record any issues**

If any check fails, capture a screenshot and note it in `docs/superpowers/phase-3c-followups.md`. Do NOT silently leave issues.

- [ ] **Step 7.5: Commit verification doc if created**

```bash
# Only if phase-3c-followups.md was created:
git add docs/superpowers/phase-3c-followups.md
git commit -m "docs: Phase 3c 已知遗留项"
```

---

## Phase 3c Completion Criteria

- [ ] All 6 code tasks committed
- [ ] `bun run typecheck && bun run test` pass (web 23 → 33)
- [ ] Browser verification (Step 7.3) all 6 items pass in light + dark
- [ ] Login/Register use FormField + useFormSubmit + Button loading; Settings "Create Key" uses Button loading

## Self-Review Checklist (already performed)

- ✅ **Spec coverage:** spec §6.4 — `FormField` → Task 2; `useFormSubmit` → Task 3; Button `loading` → Task 1; Login → Task 4; Register → Task 5; Settings → Task 6; verify → Task 7.
- ✅ **No placeholders:** every component/hook/page has complete code; commands show expected output.
- ✅ **Type consistency:** `useFormSubmit` returns `{ loading, error, setError, submit }`; Login/Register destructure `{ loading, error, submit }` — matches. `Button` `loading?: boolean` prop used identically in Login/Register/Settings. `FormField` props (`label`, `htmlFor`, `hint`, `error`, `children`, `className`) match all call sites (Login/Register pass `label` + `htmlFor` + children).

## What Phase 3c does NOT cover

Out of scope (final sub-PR of Phase 3):
- **3d**: TaskDetail rework (toolbar, panel borders, block selection state, dark PDF container alignment).
- Settings' `SettingRow` horizontal layout is intentionally left as-is (different concern from the vertical FormField).
