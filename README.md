# MineRU Wrapper

一个基于 [MineRU](https://github.com/opendatalab/MinerU) 的 OCR 文档解析服务，提供 Web 界面和 REST API，支持 PDF、图片等多种格式的文档识别与结构化提取。

## 功能特性

- 📄 **多格式支持**：PDF、PNG、JPG、JPEG、TIFF、BMP、GIF
- 🚀 **异步 & 同步接口**：支持提交任务后轮询结果，也支持直接同步等待
- 🌐 **Web 管理界面**：可视化上传文件、查看任务进度与结果
- 🔁 **文件去重缓存**：相同文件（SHA-256 哈希）自动复用已有结果，无需重复解析
- 🔄 **自动旋转纠偏**：通过 MineRU 四方向探测，自动识别并修正扫描件方向（支持图片与 PDF）
- 📐 **公式 & 表格识别**：可开关的公式、表格结构化提取
- 📝 **Markdown 输出**：结果以 Markdown 格式返回，图片内联为 Base64
- 📚 **OpenAPI 文档**：内置 Swagger UI 与 Scalar API Reference
- 🗄️ **SQLite 持久化**：基于 Bun SQLite，任务记录持久存储

## 技术栈

| 层次 | 技术 |
|------|------|
| 运行时 | [Bun](https://bun.sh) |
| 后端框架 | [Hono](https://hono.dev) + Zod OpenAPI |
| 数据库 | Bun SQLite (WAL 模式) |
| PDF 渲染 | [MuPDF WASM](https://mupdf.com) + [pdf-lib](https://pdf-lib.js.org) |
| 图像处理 | [Sharp](https://sharp.pixelplumbing.com) |
| 前端 | React 19 + Vite + Tailwind CSS v4 |
| 容器化 | Docker + Docker Compose |

## 快速开始

### 前置条件

- [Bun](https://bun.sh) >= 1.0
- 一个已部署的 [MineRU](https://github.com/opendatalab/MinerU) 服务（默认地址 `http://10.0.10.2:8001`）

### 本地开发

```bash
# 克隆项目
git clone <repo-url>
cd mineru-wrapper

# 安装依赖
bun install

# 同时启动前端开发服务器与后端服务
bun run dev
```

- 前端开发服务器：`http://localhost:5173`
- 后端 API 服务：`http://localhost:3001`

> 前端在开发模式下通过 Vite 反向代理将 API 请求转发到后端；生产构建后由后端直接托管前端静态文件。

### 仅启动后端

```bash
bun run dev:server
```

### 仅启动前端

```bash
bun run dev:web
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MINERU_URL` | `http://10.0.10.2:8001` | MineRU 服务地址 |
| `DB_PATH` | `./data/ocr.db` | SQLite 数据库文件路径 |
| `PORT` | `3001` | 后端监听端口 |
| `UPLOAD_DIR` | `./uploads` | 上传文件存储目录 |

## API 接口概览

服务启动后可通过以下地址访问 API 文档：

- **Swagger UI**：`http://localhost:3001/swagger`
- **Scalar API Reference**：`http://localhost:3001/docs`
- **OpenAPI JSON**：`http://localhost:3001/api/openapi`

### 主要接口

#### 上传并异步解析（Web 界面使用）

```http
POST /upload
Content-Type: multipart/form-data

file=<文件>
backend=pipeline          # pipeline | vlm-auto-engine | hybrid-auto-engine
lang=ch                   # ch | en | japan | korean | latin | arabic | cyrillic | devanagari
parse_method=auto         # auto | ocr | txt
formula_enable=true
table_enable=true
auto_rotate=false
```

返回任务 ID，通过 `GET /tasks/{id}` 轮询结果。

#### 提交解析任务（API 使用）

```http
POST /api/parse
Content-Type: multipart/form-data

file=<文件>
backend=pipeline
lang_list=ch              # 可多次传递以指定多语言
start_page_id=0           # 起始页（0-indexed）
end_page_id=5             # 结束页（0-indexed）
auto_rotate=false
mineru_url=http://...     # 可覆盖默认 MineRU 地址
```

#### 同步解析（阻塞等待结果）

```http
POST /api/parse/sync
Content-Type: multipart/form-data

file=<文件>
# 其余参数同 /api/parse
```

直接返回解析结果，适合小文件或对延迟不敏感的场景。大文件可能耗时数分钟。

#### 查询任务

```http
GET /tasks/{id}           # 获取任务详情（含 Markdown 结果与内容块）
GET /tasks?page=1&limit=20&source=api   # 分页列表
DELETE /tasks/{id}        # 删除任务及上传文件
```

#### 获取原始上传文件

```http
GET /files/{filename}
```

### 响应示例

**任务状态枚举**：`pending` → `processing` → `completed` / `failed`

**已完成任务**（`GET /tasks/{id}`）：

```json
{
  "id": "uuid",
  "status": "completed",
  "original_name": "document.pdf",
  "result_md": "# 标题\n\n正文内容...",
  "content_list": [
    {
      "type": "text",
      "bbox": [x1, y1, x2, y2],
      "text": "段落内容",
      "page_idx": 0
    }
  ],
  "pages": [
    { "width": 595, "height": 842 }
  ]
}
```

## 项目结构

```
mineru-wrapper/
├── Dockerfile
├── docker-compose.yml
├── package.json            # Monorepo 根，Bun Workspaces
├── packages/
│   ├── server/             # 后端服务
│   │   ├── index.ts        # 入口：Hono 服务器 + 静态文件服务
│   │   └── src/
│   │       ├── routes.ts   # 全部 API 路由与 OpenAPI 定义
│   │       ├── mineru.ts   # MineRU 调用、自动旋转逻辑
│   │       └── db.ts       # SQLite 数据库与预编译语句
│   └── web/                # 前端（React + Vite）
│       └── src/
│           ├── App.tsx
│           ├── pages/      # 各页面组件
│           └── api.ts      # 前端 API 调用封装
└── DOCKER.md               # Docker 部署文档
```

## 自动旋转说明

启用 `auto_rotate=true` 时，服务会在提交给 MineRU 前对文件进行预处理：

1. **图片**：先通过 Sharp 修正 EXIF 方向，再将缩略图分别旋转 0°/90°/180°/270° 各发送给 MineRU 探测，选取识别文本最多的方向作为最终旋转角度。
2. **PDF**：渲染首页为图片（200 DPI）进行方向探测；若需旋转，则逐页渲染为 JPEG 并重建新 PDF。

> **注意**：自动旋转会明显增加处理时间（多次 MineRU 探测调用）。对于方向固定的文档，建议关闭此功能。

## 文件去重

每次上传文件时都会计算 SHA-256 哈希。若数据库中已存在相同哈希的 `completed` 任务，直接返回缓存结果，不再重复解析。

## 许可证

MIT
