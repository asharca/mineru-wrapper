# MineRU Wrapper — Claude Code 指南

## 技术栈

- **运行时**: Bun（不用 npm/node）
- **后端**: Hono + Zod OpenAPI，入口 `packages/server/index.ts`
- **前端**: React 19 + Vite + Tailwind CSS v4，位于 `packages/web/`
- **数据库**: Bun SQLite，封装在 `packages/server/src/db.ts`
- **Monorepo**: Bun Workspaces，根 `package.json` 定义所有脚本

## 常用命令

```bash
bun install          # 安装依赖
bun run dev          # 同时启动前后端开发服务器
bun run typecheck    # 全量 TypeScript 检查
bun run lint         # biome 检查
bun run lint:fix     # biome 自动修复
bun run test         # 运行全部测试（server + web）
```

## 测试

### 运行测试

```bash
# 全部测试
bun run test

# 仅后端
bun test --cwd packages/server

# 仅前端
bun run --cwd packages/web test
```

### 测试架构

后端测试使用 **Bun 内置测试运行器**（`bun:test`），配置文件 `packages/server/bunfig.toml`：

```toml
[test]
preload = ["./test-preload.ts"]
```

`test-preload.ts` 在每个测试 worker 启动前执行：
- 设置 `DB_PATH=./data/test-all.db`、`UPLOAD_DIR=./uploads-test`
- 仅在首次运行时（DB 文件超过 3 秒）清理旧数据，防止同次运行的多个 worker 互相干扰

测试文件位于 `packages/server/src/`:

| 文件 | 覆盖范围 |
|------|----------|
| `auth.test.ts` | 注册、登录、会话隔离、多用户数据隔离 |
| `apikeys.test.ts` | API Key 创建、撤销、鉴权、跨用户隔离 |
| `tasks.test.ts` | 上传、任务查询、去重缓存、下载、删除 |

前端测试使用 **Vitest**，位于 `packages/web/src/`。

### Pre-commit 钩子（Lefthook）

每次 `git commit` 前自动并行执行三项检查：

| 检查 | 命令 | 范围 |
|------|------|------|
| lint | `biome check --write {staged_files}` | 仅暂存的 `.ts`/`.tsx` |
| typecheck | `bun run typecheck` | 全量 |
| test | `bun run test` | 全部测试 |

**首次克隆后必须安装钩子**：

```bash
bunx lefthook install
```

任何测试失败都会阻止提交。

## 项目结构

```
packages/
├── server/
│   ├── index.ts              # Hono 服务入口
│   ├── bunfig.toml           # Bun 测试配置（preload）
│   ├── test-preload.ts       # 测试环境隔离（DB + 上传目录）
│   └── src/
│       ├── auth.ts           # better-auth 配置
│       ├── db.ts             # SQLite 数据库与预编译语句
│       ├── routes/           # API 路由
│       ├── auth.test.ts
│       ├── apikeys.test.ts
│       └── tasks.test.ts
└── web/
    └── src/
        ├── App.tsx
        ├── pages/
        └── components/
```

## 注意事项

- `uploads/` 和 `uploads-test/` 已在 `.gitignore` 中，不提交运行时文件
- 测试数据库 `data/test-all.db` 同样被忽略
- 环境变量见根目录 README 的"环境变量"节
