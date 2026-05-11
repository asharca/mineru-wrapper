# MineRU Wrapper 认证与数据隔离设计

**日期**: 2026-05-11
**主题**: better-auth 认证集成、用户数据隔离、lefthook Git 校验

---

## 1. 目标

为 MineRU Wrapper 项目引入用户认证系统，确保：
- Web 界面和 API 都需要认证才能使用
- 用户只能看到、操作自己上传/创建的任务和文件
- Git 提交前自动运行 lint、类型检查和测试
- 全链路有测试覆盖

---

## 2. 技术选型

| 组件 | 技术 | 说明 |
|------|------|------|
| 认证库 | [better-auth](https://www.better-auth.com/) | 支持 Hono 框架，提供邮箱+密码认证 |
| 密码哈希 | better-auth 内置 | bcrypt，无需额外配置 |
| Session | better-auth 内置 | 基于数据库的 session |
| 数据库 | Bun SQLite | 已有，新增 users 表和 user_id 字段 |
| Git Hook | [lefthook](https://github.com/evilmartians/lefthook) | 替代 husky，Go 编写，速度快 |
| 测试框架 | Bun Test | 项目已使用 Bun |

---

## 3. 数据库设计

### 3.1 新增表（better-auth 自动创建）

better-auth 会创建以下表：
- `user` - 用户信息
- `session` - session 记录
- `account` - 账号信息（邮箱密码登录时也会有一条记录）
- `verification` - 验证码（如需要邮箱验证）

### 3.2 API Keys 表

```sql
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key_hash TEXT NOT NULL,        -- API Key 的哈希值（不存明文）
  key_prefix TEXT NOT NULL,      -- 前缀，用于展示（如 mk_a1b2c3）
  name TEXT,                     -- 用户自定义名称（可选）
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,             -- 最后使用时间
  revoked_at TEXT,               -- 撤销时间（NULL 表示有效）
  FOREIGN KEY (user_id) REFERENCES user(id)
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
```

**安全设计**：
- 不存储 API Key 明文，只存储 SHA-256 哈希
- 用户创建时只显示一次完整 key，后续只显示前缀
- 支持撤销（软删除），保留审计记录

### 3.2 tasks 表改造

```sql
-- 新增 user_id 字段
ALTER TABLE tasks ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_created ON tasks(user_id, created_at DESC);
```

**注意**: 由于现有数据没有 user_id，需要迁移策略：
- 方案：部署时运行一次性迁移脚本，将现有任务的 user_id 设为某个默认系统用户 ID，或允许 NULL 后逐步填充
- **本方案选择**: 允许 `user_id` 为 NULL 表示"系统/未归属任务"，新任务必须关联用户

修正：
```sql
ALTER TABLE tasks ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_created ON tasks(user_id, created_at DESC);
```

### 3.3 数据库语句更新

所有 `stmt` 查询都需要增加 `user_id` 过滤：

- `insert` - 增加 `$user_id` 参数
- `insertCached` - 增加 `$user_id` 参数
- `findByHash` - 增加 `AND (user_id = ?2 OR user_id IS NULL)`（允许使用公共缓存，或仅查自己的）
- `getById` - 增加 `AND user_id = ?2`
- `list` → `listByUser` - `WHERE user_id = ?1`
- `listBySource` → `listByUserAndSource`
- `count` → `countByUser`
- `countBySource` → `countByUserAndSource`
- `listSearch` → `listByUserSearch`
- `listBySourceSearch` → `listByUserAndSourceSearch`
- `countSearch` → `countByUserSearch`
- `countBySourceSearch` → `countByUserAndSourceSearch`
- `updateContent` - 增加 `AND user_id = ?3` 校验
- `deleteById` - 增加 `AND user_id = ?2` 校验

---

## 4. 后端架构

### 4.1 better-auth 初始化

在 `packages/server/src/auth.ts` 中初始化：

```typescript
import { betterAuth } from "better-auth";
import { Database } from "bun:sqlite";

// 复用已有的 db 实例或创建新的
const auth = betterAuth({
  database: db, // Bun SQLite 实例
  emailAndPassword: {
    enabled: true,
    autoSignIn: true, // 注册后自动登录
  },
  advanced: {
    generateId: false, // 使用 better-auth 默认的 id 生成
  },
});

export { auth };
```

### 4.2 Hono 集成

在 `packages/server/index.ts` 中：

```typescript
import { auth } from "./src/auth.ts";

// better-auth 的 API 路由
app.on(["POST", "GET"], "/api/auth/**", (c) => auth.handler(c.req.raw));

// 受保护路由使用中间件
app.use("/upload", authMiddleware);
app.use("/api/parse/*", authMiddleware);
app.use("/tasks/*", authMiddleware);
app.use("/files/*", authMiddleware);
```

### 4.3 认证中间件

```typescript
// packages/server/src/middleware/auth.ts
import { createMiddleware } from "hono/factory";
import { auth } from "../auth.ts";

export const authMiddleware = createMiddleware(async (c, next) => {
  // 1. 先尝试 better-auth session
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session) {
    c.set("user", session.user);
    c.set("session", session.session);
    await next();
    return;
  }

  // 2. 再尝试 API Key
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const apiKey = authHeader.slice(7);
    const user = await validateApiKey(apiKey); // 查询 api_keys 表
    if (user) {
      c.set("user", user);
      await next();
      return;
    }
  }

  return c.json({ error: "Unauthorized" }, 401);
});
```

### 4.4 类型扩展

```typescript
// packages/server/src/types.ts
import type { User, Session } from "better-auth";

declare module "hono" {
  interface ContextVariableMap {
    user: User;
    session: Session;
  }
}
```

### 4.5 路由改造

#### `/upload` (Web 上传)
- 从 `c.get("user")` 获取当前用户
- 插入任务时设置 `user_id`
- 缓存命中时也设置当前用户的 `user_id`（复制缓存结果给当前用户）

#### `/api/parse` 和 `/api/parse/sync` (API 上传)
- 同样从 session 获取用户
- 插入任务时设置 `user_id`

#### `/tasks/{id}` (获取任务)
- 查询时附加 `user_id = ?`
- 返回 404（而非 403）避免信息泄露

#### `/tasks` (列表)
- 只返回 `user_id = ?` 的任务
- 分页参数不变

#### `/tasks/{id}` (DELETE)
- 删除时校验 `user_id`，不匹配则 404

#### `/tasks/{id}` (PATCH 更新内容)
- 校验 `user_id`，不匹配则 404

#### `/tasks/{id}/reprocess`
- 校验任务属于当前用户

#### `/files/{filename}` 和 `/files/img/{filename}`
- 通过文件名查找对应任务
- 校验任务 `user_id` 是否匹配当前用户
- 不匹配返回 404

### 4.6 公共路由（无需认证）

- `/api/auth/*` - better-auth 的认证路由（注册/登录/登出等）
- `/api/openapi` - OpenAPI 文档
- `/docs` - Scalar API 文档
- `/swagger` - Swagger UI（如果有）
- 前端静态文件

---

## 5. 前端架构

### 5.1 新增页面

- `/login` - 登录页面
- `/register` - 注册页面

### 5.2 认证状态管理

使用 React Context + State：

```typescript
// packages/web/src/contexts/AuthContext.tsx
interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
}
```

### 5.3 路由守卫

```typescript
// 在 App.tsx 或路由配置中
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <Loading />;
  if (!user) return <Navigate to="/login" />;
  return children;
}
```

### 5.4 API 请求改造

`packages/web/src/api.ts` 中：
- 从 `localStorage` 读取 `token`
- 所有请求附加 `Authorization: Bearer <token>` header
- 遇到 401 时清除 token 并跳转登录页

```typescript
async function apiFetch(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem("token");
  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 401) {
    localStorage.removeItem("token");
    window.location.href = "/login";
  }
  return res;
}
```

### 5.5 导航栏改造

- 右侧显示当前用户邮箱和登出按钮
- 未登录时显示"登录"/"注册"链接

---

## 6. API 认证方式

### 6.1 Web 端
- 登录后 better-auth 返回 session token
- 存储在 `localStorage`
- 每次请求通过 `Authorization: Bearer <token>` 传递

### 6.2 API 端（程序化调用）
- 同样使用 Bearer token
- 用户需要先调用 `/api/auth/sign-in/email` 获取 token
- 后续请求携带 token

### 6.3 API Key 机制

用户在 Web 端的 **Settings（设置）页面** 申请 API Key：
- 每个用户可拥有多个 API Key（或仅一个，视实现而定）
- API Key 格式：`mk_<random_string>`（例如 `mk_a1b2c3d4e5f6`）
- 存储在数据库 `api_keys` 表中，关联 `user_id`
- 申请时显示一次，之后不可再次查看（只显示前缀）
- 用户可随时撤销/删除 API Key

API 调用方式：
```
Authorization: Bearer <api-key>
```

后端中间件优先尝试 better-auth session，若不存在则尝试 API Key：
1. 从 `Authorization` header 提取 token
2. 尝试 better-auth session 验证
3. 若失败，查询 `api_keys` 表匹配 token
4. 匹配成功则设置对应的 user

这样 API 用户无需先调用登录接口获取 session，直接使用长期有效的 API Key 即可。

---

## 7. lefthook 配置

### 7.1 安装

```bash
bun add -D lefthook
```

### 7.2 配置 `lefthook.yml`

```yaml
pre-commit:
  parallel: true
  commands:
    lint:
      glob: "*.{ts,tsx}"
      run: bunx biome check --write {staged_files}
    typecheck:
      run: bun run typecheck
    test:
      run: bun test
```

### 7.3 安装 hook

```bash
bunx lefthook install
```

### 7.4 添加脚本到 package.json

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "lint": "biome check .",
    "lint:fix": "biome check --write ."
  }
}
```

**注意**: 如果项目没有 biome，需要先安装或改用 eslint：
```bash
bun add -D @biomejs/biome
```

---

## 8. 测试策略

### 8.1 后端测试

文件: `packages/server/src/auth.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import app from "../index.ts";

describe("Auth", () => {
  it("should register a new user", async () => {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email: "test@example.com", password: "password123" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toBeDefined();
  });

  it("should login", async () => {
    // ...
  });
});

describe("Protected routes", () => {
  it("should reject unauthenticated upload", async () => {
    const res = await app.request("/upload", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("should only return own tasks", async () => {
    // 创建用户A的任务
    // 创建用户B的任务
    // 用户A查询列表，只应看到自己的任务
  });

  it("should not access other user's task detail", async () => {
    // 用户A创建任务
    // 用户B查询该任务，应返回 404
  });

  it("should not delete other user's task", async () => {
    // 类似上面
  });

  it("should not access other user's file", async () => {
    // 用户A上传文件
    // 用户B访问 /files/{filename}，应返回 404
  });
});
```

### 8.2 前端测试

文件: `packages/web/src/pages/Login.test.tsx`

```typescript
import { describe, it, expect } from "bun:test";
import { render, screen, fireEvent } from "@testing-library/react";
import LoginPage from "./Login.tsx";

describe("LoginPage", () => {
  it("should render login form", () => {
    render(<LoginPage />);
    expect(screen.getByPlaceholderText("Email")).toBeDefined();
    expect(screen.getByPlaceholderText("Password")).toBeDefined();
  });
});
```

### 8.3 测试数据库隔离

- 测试使用独立的数据库文件（如 `./data/test.db`）
- 每个测试前清理数据
- 通过环境变量 `TEST_DB_PATH` 控制

---

## 9. 错误处理

### 9.1 认证错误
- 401 Unauthorized: 未提供 token 或 token 无效
- 前端收到 401 后清除 token 并跳转登录页

### 9.2 权限错误
- 404 Not Found: 用户尝试访问不属于自己的资源（避免暴露资源存在性）
- 不返回 403，防止信息泄露

### 9.3 注册错误
- 邮箱已存在: 返回 400，提示"该邮箱已被注册"
- 密码太短: better-auth 默认要求 8 位以上

---

## 10. 部署考虑

### 10.1 环境变量

新增：
- `BETTER_AUTH_SECRET` - better-auth 的加密密钥（生产环境必须设置）
- `BETTER_AUTH_URL` - 服务公网地址，用于生成回调链接

### 10.2 数据库迁移

首次部署需要：
1. 运行 `bun run db:migrate` 添加 `user_id` 字段
2. （可选）创建默认管理员账号

### 10.3 Docker

- Dockerfile 无需大幅修改
- 确保 `BETTER_AUTH_SECRET` 通过环境变量传入

---

## 11. 文件变更清单

### 新增文件
- `packages/server/src/auth.ts` - better-auth 配置
- `packages/server/src/middleware/auth.ts` - 认证中间件
- `packages/server/src/types.ts` - Hono Context 类型扩展
- `packages/server/src/auth.test.ts` - 认证测试
- `packages/server/src/apikey.ts` - API Key 管理逻辑
- `packages/server/src/apikey.test.ts` - API Key 测试
- `packages/web/src/contexts/AuthContext.tsx` - 前端认证状态
- `packages/web/src/pages/Login.tsx` - 登录页
- `packages/web/src/pages/Register.tsx` - 注册页
- `packages/web/src/pages/Login.test.tsx` - 登录页测试
- `lefthook.yml` - lefthook 配置

### 修改文件
- `packages/server/package.json` - 添加 better-auth 依赖
- `packages/server/index.ts` - 集成 better-auth 路由和中间件
- `packages/server/src/db.ts` - 添加 user_id 字段，更新所有 SQL 语句
- `packages/server/src/routes.ts` - 所有路由增加用户隔离
- `packages/web/package.json` - 添加测试依赖
- `packages/web/src/App.tsx` - 增加路由守卫和认证状态
- `packages/web/src/api.ts` - 请求附加 token
- `packages/web/src/main.tsx` - 包裹 AuthProvider
- `package.json` - 添加 typecheck、test、lint 脚本

---

## 12. 安全考虑

1. **密码安全**: better-auth 使用 bcrypt，自动处理
2. **Session 安全**: 数据库存储 session，可吊销
3. **Token 传输**: 通过 HTTPS（生产环境）
4. **文件访问**: 通过 user_id 严格隔离，防止越权访问
5. **SQL 注入**: 继续使用参数化查询
6. **XSS**: 前端输出继续转义（React 默认处理）
7. **CSRF**: better-auth 内置 CSRF 防护

---

## 13. 回滚计划

如需回滚认证功能：
1. 移除 better-auth 路由和中间件
2. 将 `user_id` 字段设为可空
3. 恢复旧的路由逻辑（去掉 user_id 过滤）
4. 前端移除登录页面和认证检查

---

## 14. 验收标准

- [ ] 用户可以通过邮箱+密码注册和登录
- [ ] 未认证用户访问任何 API 返回 401
- [ ] 用户只能看到自己的任务列表
- [ ] 用户只能查看、编辑、删除自己的任务
- [ ] 用户只能访问自己上传的文件
- [ ] Web 界面有登录/注册页面
- [ ] 登录后 Web 界面显示用户信息
- [ ] Git commit 前自动运行 lint + typecheck + test
- [ ] 所有测试通过
- [ ] 现有功能不受影响（除需要登录外）
- [ ] 用户可在 Settings 页面申请 API Key
- [ ] 使用 API Key 调用 API 可正常识别用户身份
- [ ] API Key 支持撤销
