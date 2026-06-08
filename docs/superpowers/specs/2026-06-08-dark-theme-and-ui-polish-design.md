# 暗黑主题 + UI 打磨 + API 集成测试 设计文档

**日期**：2026-06-08
**作者**：协作设计（ashark + Claude）
**状态**：设计已对齐，待用户审阅

---

## 1. 背景

`mineru-wrapper` Web 前端目前在 `index.css` 已经定义了完整的 `.dark` 调色板和 `@custom-variant dark (&:is(.dark *))` 变体，shadcn 风格组件也都带 `dark:` 类，但缺少：

- **没有 ThemeProvider / 切换器**，`.dark` 类永远不会被挂到 `<html>` 上
- **PDF/图片预览**、**Markdown 代码块**、**block-type 彩色标签**、**Allotment 拖动条** 等几处暗色细节未适配
- 后端 `auth/apikeys/tasks/settings/db/mineru` 已有测试，但黑名单场景（错误路径、权限边界、上传限制）覆盖不均
- 几个页面的空/加载/错误态仅为文字，TaskDetail（29KB）高密信息区域可读性一般

## 2. 目标 & 非目标

### 目标

1. 加入 **light/dark/system** 三态主题切换，默认跟随系统，选择存 localStorage
2. 修补暗色模式下 4 处已知细节缺陷
3. 4 个方向的视觉打磨：状态原语 / Header / 表单一致性 / TaskDetail
4. 梳理现有后端测试并按黑名单清单补全错误路径与权限边界

### 非目标

- **不**重构信息架构（导航、页面结构、路由不动）
- **不**重新设计调色板（沿用现有 oklch token）
- **不**引入新依赖（react-hook-form、Playwright 等）
- **不**改动后端业务逻辑（除非测试发现真 bug）

## 3. 整体执行策略

按 **B 方案：分阶段串行** 推进：

```
Phase 1 (主题基础设施)  →  Phase 2 (API 测试补全)  →  Phase 3 (视觉打磨 a-d)
       1 个 PR                   1 个 PR                  4 个 sub-PR
```

理由：
- 主题基础设施一旦落地，视觉打磨阶段所有 `dark:` 类才有意义，先后顺序天然
- 先把 API 测试梳理补全再动 UI，能在视觉打磨期间一直跑 `bun run test` 当回归网
- TaskDetail 是最重的页面，放最后单独一个 sub-PR，避免污染前面的小改动

---

## 4. Phase 1 · 暗黑主题基础设施

### 4.1 数据流

```
        localStorage("mineru.theme")
                 │
                 ▼
   ┌─────────────────────────────────────┐
   │ ThemeProvider                       │
   │   resolvedTheme: 'light' | 'dark'   │
   │   theme:        'light'|'dark'|'system'
   │   setTheme(next)                    │
   └────┬───────────────────────────┬────┘
        │ class on <html>           │ subscribe
        ▼                           ▼
   :root / .dark CSS vars      matchMedia('(prefers-color-scheme: dark)')
   (已存在)                     → 当 theme==='system' 跟随系统切换
```

- 单文件 `src/contexts/ThemeContext.tsx`
- 初始值：从 localStorage 读 `theme`（缺省 `'system'`）→ 用 `prefers-color-scheme` 求 `resolvedTheme`
- `setTheme(next)` 写 localStorage + 同步 `<html>` 的 `dark` 类
- 当 `theme === 'system'` 时，订阅 `matchMedia` 的 `change` 事件

### 4.2 FOUC 防护

在 `index.html` `<head>` 加内联脚本，在 React 挂载前同步设置 `<html>.dark`：

```js
(function () {
  try {
    var t = localStorage.getItem('mineru.theme') || 'system';
    var dark = t === 'dark' || (t === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
```

### 4.3 ThemeToggle 组件

`src/components/ui/theme-toggle.tsx` — 三态分段选择（Sun / Monitor / Moon 图标），放在 `AppHeader` 右侧，紧邻 User 菜单。

### 4.4 暗色细节修补清单

| 位置 | 现状问题 | 修补 |
|---|---|---|
| `index.css` `.rendered-md pre` | 背景硬编码 `oklch(0.205 …)` | 改成 `bg-muted text-foreground`，亮色暗色都自适应 |
| `index.css` `.block-type-*` 6 条 | 没 `.dark` 变体 | 加 6 条 `.dark .block-type-*` 降饱和、降亮度 |
| `PdfViewer.tsx` 容器 | 暗色下 PDF 边缘融进背景 | 容器固定 `bg-white`，确保 PDF 永远白底 |
| `ImageOverlay.tsx` 容器 | 同上 | 同上 |
| `allotment/dist/style.css` 拖动条 | 暗色下不可见 | 在 `index.css` 末尾加 `.dark .allotment-module_sash__hHKZv { ... }`（实际类名需确认） |

### 4.5 文件改动清单

| 文件 | 操作 |
|---|---|
| `packages/web/src/contexts/ThemeContext.tsx` | 新增（约 60 行）|
| `packages/web/src/components/ui/theme-toggle.tsx` | 新增（约 40 行）|
| `packages/web/src/main.tsx` | 增加 `<ThemeProvider>` 包裹 |
| `packages/web/index.html` | 加 FOUC 脚本 |
| `packages/web/src/App.tsx` | Header 增加 `<ThemeToggle />` |
| `packages/web/src/index.css` | 修补代码块、block-type、Allotment 暗色样式 |
| `packages/web/src/components/task-detail/PdfViewer.tsx` | 容器加白底 |
| `packages/web/src/components/task-detail/ImageOverlay.tsx` | 容器加白底 |
| `.gitignore` | 加 `.superpowers/` |

### 4.6 测试

新增 `packages/web/src/contexts/ThemeContext.test.tsx`（Vitest + Testing Library）：

- 默认 `system` 时跟随 `prefers-color-scheme`
- 切换到 `dark` 后 localStorage 写入 `dark`，`<html>` 获得 `dark` 类
- 切回 `system` 后取消 localStorage 写入并恢复跟随系统

### 4.7 退出条件

- `bun run typecheck` / `bun run lint` / `bun run test` 全绿
- 浏览器手动验证：light → dark → system 三态切换，刷新后保持，无 FOUC

---

## 5. Phase 2 · API 集成测试梳理与补全

### 5.1 现状

| 测试文件 | 体积 | 已覆盖 |
|---|---|---|
| `auth.test.ts` | 5.2K | 注册、登录、会话隔离、多用户数据隔离 |
| `apikeys.test.ts` | 8.5K | 创建、撤销、鉴权、跨用户隔离 |
| `tasks.test.ts` | 18.7K | 上传、查询、去重缓存、下载、删除 |
| `settings.test.ts` | 4.2K | 待审 |
| `db.test.ts` | 5.9K | 待审 |
| `mineru.test.ts` | 1.2K | 较薄 |

### 5.2 工作流（两步）

**Step A · 审计报告（不改代码）**
逐文件读完，输出 `docs/superpowers/test-audit.md`，每个测试文件列出：当前覆盖路径 / 缺口 / 优先级（P0 安全、P1 错误路径、P2 边界）。

**Step B · 按优先级补黑名单**
优先 P0、P1，能补到 P2 就补。不动产品代码（除非发现真 bug）。

### 5.3 黑名单场景清单（候选）

| ID | 场景 | 涉及路由 | 优先级 |
|---|---|---|---|
| BL-1 | 无 session 调受保护接口 → 401 | `/tasks/*` `/upload` `/api/apikeys` `/api/settings` | P0 |
| BL-2 | 持有 session 访问别人的任务/key/settings → 404（不暴露资源存在性） | `/tasks/{id}` `/api/apikeys/{id}` | P0 |
| BL-3 | 错误的 API Key 调 `/api/parse*` → 401 | `/api/parse` `/api/parse/sync` | P0 |
| BL-4 | API Key 被 revoke 后立即使用 → 401 | `/api/parse` | P0 |
| BL-5 | 上传非白名单 MIME → 400 | `/upload` `/api/parse` | P1 |
| BL-6 | 上传超过限制大小 → 413（若未实现则记为已知缺口） | `/upload` `/api/parse` | P1 |
| BL-7 | 提交无 file 字段的 multipart → 400 | `/upload` `/api/parse` | P1 |
| BL-8 | `GET /tasks/{bad-uuid}` → 404 | `/tasks/{id}` | P1 |
| BL-9 | 删除不存在的任务 → 404，不是 500 | `DELETE /tasks/{id}` | P1 |
| BL-10 | 错误响应统一形状（`{ error: string }` 或 OpenAPI 定义的） | 全部错误路径 | P1 |
| BL-11 | mineru 上游 500 时本地任务标记 `failed` 而非 `processing` 卡死 | `/api/parse` 后台逻辑 | P1 |
| BL-12 | 注册重复 email → 400/409 | `/api/auth/sign-up` | P2 |
| BL-13 | 注销后旧 cookie 调接口 → 401 | 任意受保护路由 | P2 |

> 审计后用实际情况校准清单 — 已覆盖的从清单划掉，发现新缺口再补。

### 5.4 测试基础设施

- **不改** `test-preload.ts` 隔离机制
- 若 `mineru` 调用尚未 mock，新增 `src/test-helpers/mineru-mock.ts`，用 `bun:test` mock + fetch interceptor
- 若部分场景需要"已撤销的 key"等夹具，新增 `src/test-helpers/fixtures.ts`

### 5.5 文件改动清单

| 文件 | 操作 |
|---|---|
| `docs/superpowers/test-audit.md` | 新增（审计报告） |
| `packages/server/src/test-helpers/mineru-mock.ts` | 新增（按需） |
| `packages/server/src/test-helpers/fixtures.ts` | 新增（按需） |
| `packages/server/src/auth.test.ts` | 追加 BL-1, BL-12, BL-13 |
| `packages/server/src/apikeys.test.ts` | 追加 BL-3, BL-4 |
| `packages/server/src/tasks.test.ts` | 追加 BL-1, BL-2, BL-5~BL-10 |
| `packages/server/src/mineru.test.ts` | 追加 BL-11 |

### 5.6 退出条件

- `bun run test` 全绿
- 审计报告里 P0、P1 全部"已覆盖"或"已记为已知产品缺口"
- 不引入新依赖（保持 `bun:test` + Vitest）

---

## 6. Phase 3 · 视觉打磨

### 6.1 拆分顺序与 PR 边界

| 子 PR | 主题 | 工作量 | 改动文件数 |
|---|---|---|---|
| 3a | 状态原语：`EmptyState` / `LoadingSkeleton` / `ErrorState` + 落地 Upload/History | 小 | ~6 |
| 3b | Header 重构：用户菜单 dropdown、ThemeToggle 收纳 | 小 | ~2 |
| 3c | 表单一致性：`FormField` 模式 + Login/Register/Settings 统一 | 中 | ~4 |
| 3d | TaskDetail 重排：工具栏、面板边界、block 选中态 | 大 | ~3-5 |

每个 sub-PR：测试绿 + 浏览器截图验证 light/dark 双模式。

### 6.2 共享原语（3a）

新增三个 shadcn 风格组件到 `components/ui/`：

- **`EmptyState`** — `icon` + `title` + `description` + `action?`
- **`LoadingSkeleton`** — shimmer 占位条（复用已装的 `tw-animate-css`）
- **`ErrorState`** — `icon`(AlertCircle) + `title` + `description` + `retry?`

落地点：
- `History.tsx`：loading → `LoadingSkeleton` × 5；空列表 → `EmptyState`
- `Upload.tsx`：上传失败 → `ErrorState`

### 6.3 Header 重构（3b）

```
[Logo] OCR Center │ Upload  History  Settings   [Theme] [User ▾]
                                                          └─ user@email
                                                             ─────
                                                             API Docs
                                                             Logout
```

- ThemeToggle 单独显示（三态分段）
- Email / API Docs / Logout 收进 User dropdown（用 `@base-ui/react` Menu）
- 移除当前 Header 直接显示的 email / API Docs / Logout

### 6.4 表单一致性（3c）

- `components/ui/form-field.tsx`：`<Label>` + children + `<p class="text-destructive">`
- `useFormSubmit` 简单 hook：包住 `onSubmit`，统一 loading/error
- 在现有 `Button` 加 `loading?: boolean` prop（spinner + 禁用）

落地：`Login.tsx` / `Register.tsx` / `Settings.tsx`

### 6.5 TaskDetail 重排（3d）

**原则**：结构不动，视觉与密度调整。

- **顶部工具栏**：左 文件名 + 状态徽章；中 页码；右 工具组（下载/复制/删除）
- **左面板**：暗色下白底容器 + 圆角内嵌
- **右面板**：Tabs 间距收紧；block 标签复用 dark variant
- **Block 选中态**：`ring-2 ring-primary` + `bg-primary/5`

改动文件：`TaskDetail.tsx` / `BlockView.tsx` / `PdfViewer.tsx`（与 Phase 1 重合，按合并后改） / `ImageOverlay.tsx` / `RenderedView.tsx`

### 6.6 验证策略

每个 sub-PR 完成时：

| 检查 | 工具 |
|---|---|
| 类型 | `bun run typecheck` |
| 测试 | `bun run test` |
| Lint | `bun run lint` |
| 浏览器 | 启动 dev server，截图 light + dark 双模式 |

按 CLAUDE.md 要求，UI 改动必须在浏览器里验证（用 verify skill）。

---

## 7. 风险与回退

| 风险 | 缓解 |
|---|---|
| Allotment 第三方拖动条实际 CSS 类名与文档不同 | Phase 1 实现时先用 DevTools 确认类名，再写 override |
| FOUC 内联脚本读 localStorage 抛错（隐私模式） | `try/catch` 兜底，回退到亮色 |
| TaskDetail 改动太重影响功能 | 3d 独立 PR，回退只需 revert 该 PR |
| 黑名单测试发现真 bug | 记 issue，spec 不强制本期修复 |

## 8. 退出条件（整体）

- 三个 Phase 各自 PR 合并完毕
- `bun run typecheck` / `bun run lint` / `bun run test` 全绿
- 浏览器验证：所有页面 light/dark 双模式可用、无对比度问题、无 FOUC
- `docs/superpowers/test-audit.md` 报告归档

## 9. 已对齐的设计决策记录

| 决策 | 选择 | 时间 |
|---|---|---|
| 整体范围 | 暗黑 + 关键视觉打磨 + API 集成测试 | 2026-06-08 |
| 主题存储 | 默认 system，localStorage 持久化 | 2026-06-08 |
| 暗色细节 | PDF/图片白底、代码块/表格调色、block 标签暗变体、Allotment 拖动条 | 2026-06-08 |
| 打磨方向 | 状态原语 / Header / 表单一致性 / TaskDetail 全做 | 2026-06-08 |
| 测试范围 | 梳理现有 + 补黑名单 | 2026-06-08 |
| 推进策略 | B：分阶段串行 PR | 2026-06-08 |
