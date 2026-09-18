# Web 组态平台

从零搭建的 Web 工业组态：**设计端（Designer）+ 运行端（Runtime）**，含 2D / 3D。

## 仓库结构

```text
web-scada/
├── apps/web              # Vue3 前端（Designer / Runtime 双模式）
├── apps/server           # Fastify 后端（MySQL + InfluxDB）
├── packages/core         # 工程模型、Tag、绑定、发布包等共享契约
└── package.json
```

## 技术栈

| 层 | 选型 |
|----|------|
| 前端 | Vue 3 · TypeScript · Vite · Pinia · Vue Router · Element Plus |
| 后端 | Node.js · Fastify |
| 关系库 | MySQL 8（工程 / 发布包） |
| 时序库 | InfluxDB 2.x（Tag 历史） |
| 2D / 3D | Konva / Three.js |
| 实时 | 前期 Mock Tag；预留 WebSocket |

> 原计划 Java17 + Spring Boot 3；当前环境仅有 Java 8，首期用 Node 后端落地同一套契约。

## 数据库配置

复制并编辑：

```bash
cp apps/server/.env.example apps/server/.env
```

默认（本机已验证 MySQL `root` / `root`）：

| 变量 | 默认 | 说明 |
|------|------|------|
| `MYSQL_*` | `127.0.0.1:3306` / `web_scada` | 工程与发布包 |
| `MYSQL_FALLBACK_FILE` | `true` | MySQL 挂了回退 JSON 文件 |
| `INFLUX_URL` | `http://127.0.0.1:8086` | InfluxDB |
| `INFLUX_TOKEN` | 空 | **必填后才启用时序** |
| `INFLUX_ORG` / `INFLUX_BUCKET` | `web-scada` / `tags` | Org / Bucket |

启动时自动建库建表：`projects` · `publishes` · `app_meta`。

InfluxDB 未安装或未配 Token 时：**服务仍可启动**（`INFLUX_REQUIRED=false`），仅 Tag 历史接口返回 503。

一键起 Influx（需先打开 Docker Desktop）：

```bash
cd apps/server
docker compose up -d
```

然后重启后端；`GET /api/health` 中 `influx.ready` 应为 `true`。

## 快速开始

```bash
pnpm install
pnpm dev
```

- 前端 `http://localhost:5173/`（`/api` 代理到后端）
- 后端 `http://127.0.0.1:8787/`
- 健康检查：`GET /api/health`（含 mysql / influx 状态）

## 后端 API

### 工程 / 发布

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 + 双库状态 |
| GET/PUT/DELETE | `/api/projects/:id` | 工程 CRUD |
| GET | `/api/projects` | 工程列表 |
| GET/PUT | `/api/publishes/:projectId` | 发布包 |
| GET | `/api/publishes` · `/latest` | 发布列表 / 最近 |

### Tag 时序（InfluxDB）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/tags/history` | 批量写入 `{ samples: [{ tagId, value, quality, timestamp? }] }` |
| GET | `/api/tags/:tagId/history?start=-1h&limit=500` | 查询历史 |

### 资源文件（磁盘）

工程里只存路径，不存 dataURL。文件落在 `apps/server/data/resources/{projectId}/`。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/resources/upload?projectId=` | `multipart` 字段 `file`；返回 `{ id, name, kind, path, mimeType, size }` |
| GET | `/api/files/{projectId}/{fileName}` | 静态读取已上传资源 |

## 前期边界

**做**：工程模型、2D/3D 组态、发布包、Mock/服务端实时、MySQL 工程与变量配置、InfluxDB Tag 历史。

**暂不做**：多协议采集、完整权限、报警/报表业务、Spring Boot 迁移。
