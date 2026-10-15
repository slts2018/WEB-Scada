# Web 组态平台

从零搭建的 Web 工业组态：**设计端（Designer）+ 运行端（Runtime）**，含 2D / 3D。

## 仓库结构

```text
web-scada/
├── apps/web              # Vue3 前端（Designer / Runtime 双模式）
├── apps/server-java      # Spring Boot 后端
├── packages/core         # 工程模型、Tag、绑定、发布包等共享契约
└── package.json
```

## 技术栈

| 层 | 选型 |
|----|------|
| 前端 | Vue 3 · TypeScript · Vite · Pinia · Vue Router · Element Plus |
| 后端 | **Spring Boot 3**（`pnpm dev`） |
| 关系库 | MySQL 8（工程 / 发布包） |
| 时序库 | InfluxDB 2.x（Tag 历史） |
| 2D / 3D | Konva / Three.js |
| 实时 | Mock Tag + WebSocket `/api/ws/tags` |

> 后端只有 Spring Boot（`apps/server-java`）。安装包用 `pnpm pack:win`。迁移过程记录见 `docs/spring-boot-migration-design.md`。

## 数据库配置

`pnpm dev` 会拉起内嵌 MariaDB（3306）和 InfluxDB（8087）。连接默认值在 `apps/server-java/src/main/resources/application.yml`，可用环境变量覆盖。

| 变量 | 默认 | 说明 |
|------|------|------|
| `MYSQL_*` | `127.0.0.1:3306` / `web_scada` / `root` | 工程与发布包 |
| `MYSQL_FALLBACK_FILE` | `true` | MySQL 不可用时回退 `apps/data` |
| `INFLUX_URL` | 开发脚本设为 `http://127.0.0.1:8087` | InfluxDB |
| `INFLUX_TOKEN` | 开发脚本设为 `web-scada-dev-token` | 空则不写历史 |
| `INFLUX_ORG` / `INFLUX_BUCKET` | `web-scada` / `tags` | Org / Bucket |

MySQL 可用时自动建库，Flyway 建表。Influx 不可用时服务仍启动（`INFLUX_REQUIRED=false`），历史接口返回 503。

## 快速开始

```bash
pnpm install
pnpm dev
```

需本机 **JDK 17+**（及首次构建时的 Maven）。`pnpm dev` = 前端 + Spring。

- 前端 `http://localhost:5173/`（`/api` 代理到 `8787`）
- 后端 `http://127.0.0.1:8787/`（health 含 `"backend":"spring"`）
- 健康检查：`GET /api/health`（含 mysql / influx / storage）

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

工程里只存路径，不存 dataURL。文件落在 `apps/data/resources/{projectId}/`。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/resources/upload?projectId=` | `multipart` 字段 `file`；返回 `{ id, name, kind, path, mimeType, size }` |
| GET | `/api/files/{projectId}/{fileName}` | 静态读取已上传资源 |

## 前期边界

**做**：工程模型、2D/3D 组态、发布包、Mock/服务端实时、MySQL 工程与变量配置、InfluxDB Tag 历史。

**暂不做**：多协议采集、完整权限、报警/报表业务。
