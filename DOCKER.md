# Docker 部署指南

本文档介绍如何使用 Docker 和 Docker Compose 部署 MineRU Wrapper 服务。

## 前置条件

- [Docker](https://docs.docker.com/get-docker/) >= 24.0
- [Docker Compose](https://docs.docker.com/compose/install/) >= 2.20（通常随 Docker Desktop 一并安装）
- 一个已运行的 [MineRU](https://github.com/opendatalab/MinerU) 服务实例

## 目录

- [快速部署](#快速部署)
- [环境变量配置](#环境变量配置)
- [数据持久化](#数据持久化)
- [反向代理配置](#反向代理配置)
- [镜像构建说明](#镜像构建说明)
- [常用运维命令](#常用运维命令)
- [故障排查](#故障排查)

---

## 快速部署

### 1. 克隆代码

```bash
git clone <repo-url>
cd mineru-wrapper
```

### 2. 修改配置

编辑 `docker-compose.yml`，将 `MINERU_URL` 改为你的 MineRU 服务地址：

```yaml
environment:
  - MINERU_URL=http://<your-mineru-host>:8001
```

### 3. 启动服务

```bash
docker compose up -d
```

服务启动后，访问 `http://localhost:3001` 即可使用 Web 界面。

### 4. 查看日志

```bash
docker compose logs -f ocr-center
```

---

## 环境变量配置

在 `docker-compose.yml` 的 `environment` 部分配置以下变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MINERU_URL` | `http://10.0.10.2:8001` | MineRU 服务地址（**必须修改**） |
| `DB_PATH` | `/app/data/ocr.db` | SQLite 数据库路径（保持默认以利用 Volume 持久化） |
| `PORT` | `3001` | 服务监听端口 |
| `UPLOAD_DIR` | `./uploads` | 上传文件目录（容器内路径） |

### 完整配置示例

```yaml
services:
  ocr-center:
    build: .
    ports:
      - "3001:3001"          # 宿主机端口:容器端口
    environment:
      - MINERU_URL=http://192.168.1.100:8001  # ← 修改为实际 MineRU 地址
      - DB_PATH=/app/data/ocr.db
      - PORT=3001
    volumes:
      - ocr-data:/app/data        # 数据库持久化
      - ocr-uploads:/app/uploads  # 上传文件持久化
    restart: unless-stopped

volumes:
  ocr-data:
  ocr-uploads:
```

---

## 数据持久化

服务使用两个 Docker Named Volume 保存持久化数据：

| Volume | 容器内路径 | 内容 |
|--------|-----------|------|
| `ocr-data` | `/app/data` | SQLite 数据库（任务记录） |
| `ocr-uploads` | `/app/uploads` | 用户上传的原始文件 |

### 使用宿主机目录挂载（可选）

如果希望将数据保存在宿主机特定目录（便于直接访问或备份），可将 Volume 改为 Bind Mount：

```yaml
volumes:
  - ./data:/app/data
  - ./uploads:/app/uploads
```

> **注意**：使用 Bind Mount 时，请确保宿主机目录已创建，并具有适当的读写权限。

### 备份与恢复

```bash
# 备份数据库
docker compose exec ocr-center cat /app/data/ocr.db > backup.db

# 或直接备份 Volume（推荐）
docker run --rm \
  -v mineru-wrapper_ocr-data:/data \
  -v $(pwd):/backup \
  busybox tar czf /backup/ocr-data-backup.tar.gz /data
```

---

## 反向代理配置

生产环境建议在 MineRU Wrapper 前面放置 Nginx 或 Caddy 作为反向代理，以启用 HTTPS 和域名访问。

### Nginx 示例

```nginx
server {
    listen 80;
    server_name ocr.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name ocr.example.com;

    ssl_certificate     /etc/ssl/certs/ocr.example.com.pem;
    ssl_certificate_key /etc/ssl/private/ocr.example.com.key;

    # 大文件上传（PDF 可能较大）
    client_max_body_size 200M;

    # 同步接口可能耗时较长
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Caddy 示例（自动 HTTPS）

```
ocr.example.com {
    reverse_proxy localhost:3001 {
        transport http {
            read_buffer_size  200MB
        }
    }
    request_body {
        max_size 200MB
    }
}
```

### 修改监听端口

若需更改对外暴露的端口，修改 `docker-compose.yml` 中的端口映射即可（只需改宿主机端口，容器内端口保持 `3001`）：

```yaml
ports:
  - "8080:3001"   # 将服务暴露在宿主机 8080 端口
```

---

## 镜像构建说明

项目 `Dockerfile` 使用多阶段构建，最终镜像基于 `oven/bun:1-slim`，体积较小。

### 构建流程

```
阶段 1 (base): oven/bun:1
├── 安装所有依赖（bun install）
├── 构建前端（vite build）
└── 复制服务器源码

阶段 2 (production): oven/bun:1-slim
├── 复制前端产物（dist/）
├── 复制服务器源码
├── 复制 node_modules
└── 启动: bun run packages/server/index.ts
```

### 手动构建镜像

```bash
# 构建并标记
docker build -t mineru-wrapper:latest .

# 指定平台（如在 M1/M2 Mac 上构建 linux/amd64 镜像）
docker buildx build --platform linux/amd64 -t mineru-wrapper:latest .
```

### 不使用 Compose 直接运行

```bash
docker run -d \
  --name ocr-center \
  -p 3001:3001 \
  -e MINERU_URL=http://192.168.1.100:8001 \
  -e DB_PATH=/app/data/ocr.db \
  -v ocr-data:/app/data \
  -v ocr-uploads:/app/uploads \
  --restart unless-stopped \
  mineru-wrapper:latest
```

---

## 常用运维命令

```bash
# 启动服务（后台运行）
docker compose up -d

# 停止服务
docker compose down

# 停止并清除所有 Volume（⚠️ 将删除所有数据）
docker compose down -v

# 查看实时日志
docker compose logs -f ocr-center

# 查看最近 100 行日志
docker compose logs --tail=100 ocr-center

# 重启服务
docker compose restart ocr-center

# 进入容器内部排查
docker compose exec ocr-center sh

# 重新构建镜像（代码更新后）
docker compose build --no-cache
docker compose up -d

# 查看容器资源占用
docker compose stats
```

---

## 故障排查

### 服务启动后无法访问 Web 界面

1. 确认容器正在运行：
   ```bash
   docker compose ps
   ```
2. 检查日志是否有错误：
   ```bash
   docker compose logs ocr-center
   ```
3. 确认端口未被占用：
   ```bash
   lsof -i :3001
   ```

### 解析任务一直停留在 `processing` 状态

- 检查 MineRU 服务是否可访问（从容器网络角度）：
  ```bash
  docker compose exec ocr-center wget -qO- http://<mineru-host>:8001/
  ```
- 确认 `MINERU_URL` 配置正确，使用容器可路由的地址（通常不是 `localhost`）。
- 如果 MineRU 和本服务在同一台主机，使用宿主机 IP 或 `host.docker.internal`（Mac/Windows）：
  ```yaml
  MINERU_URL=http://host.docker.internal:8001
  ```

### 上传大文件失败

- 检查是否有反向代理限制了请求体大小（参见 [反向代理配置](#反向代理配置)）。
- 同步接口 `/api/parse/sync` 对于大文件会长时间阻塞，建议使用异步接口 `/api/parse`。

### SQLite 数据库被锁

服务以 WAL（Write-Ahead Logging）模式运行，并发读写性能良好。若遇到锁问题，通常是由于多个容器实例同时写入同一数据库文件。请确保只运行**一个**服务容器实例。

### 容器内磁盘空间不足

上传文件和数据库存储在 Volume 中，若空间不足：

```bash
# 查看 Volume 大小
docker system df -v

# 清理已删除任务的残留文件（需进入容器）
docker compose exec ocr-center sh
# 在容器内手动清理 /app/uploads 中不再关联到任何任务的文件
```
