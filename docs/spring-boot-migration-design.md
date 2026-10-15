# Node(Fastify) → Spring Boot 迁移详细设计

> 状态：**Node 后端已删除**（2026-10-13）。唯一后端是 `apps/server-java`。回滚用 Git 历史，不要在仓库里再放一套 Fastify。下文是迁移过程记录，以当前 Spring 实现为准。
> 依据 `.cursor/rules`：07 把「工程 JSON / Publish 包 / AnimationLink 语义 / WS Tag 协议 / 核心交互」列为 **C 类契约（需用户明确同意才能改）**；09 禁止顺手大改；02 禁止**擅自**引入 Spring/新 ORM。本设计只定义"如果迁移，怎么做才不破契约"。
> 迁移的**唯一验收标准**：`apps/web`（含 Runtime）一行不改，行为与现状一致。

---

## 0. 开工前的两个硬前置

| # | 前置 | 现状事实 | 处理 |
| :- | :- | :- | :- |
| P1 | **工具链** | 本机 `java version "1.8.0_301"`；`mvn`/`gradle` 均未安装（README 里"环境仅有 Java 8"今天仍成立） | 需装 JDK 17/21 + Maven 或 Gradle；Spring Boot 3.x 最低 JDK 17 |
| P2 | **文档/规则冲突** | `README.md` 写"**原计划 Java17 + Spring Boot 3**；当前环境仅有 Java 8，首期用 Node 后端落地同一套契约"；`docs/代码规范与重构审计报告.md:34` 写"Java / Spring Boot：**无**（历史计划已放弃）"，并在 328/354 行把"换 Spring"列为**禁止项** | 两者必须**先统一口径**，否则每个 agent 读到的结论都不同，迁移过程中会不断被规则挡下。建议统一为："当前阶段保持 Node；若启动 Spring 迁移，按本文流程 + 用户书面确认" |

---

## 1. 目标与非目标

### 目标
1. **行为等价的 Spring Boot 实现**：`/api/**` 路径、请求体、响应体字段、错误码、HTTP 状态码、WS 报文、资源 URL —— 逐条对齐。
2. **保留降级能力**：MySQL 不可用时回退文件存储（对齐 `MYSQL_FALLBACK_FILE`）、InfluxDB 不可用不阻塞实时。
3. **可灰度、可回滚**：同一份前端可指向任一后端；回滚 = 代理切回 Node，不需要回滚数据（因为 DDL 与现状**完全一致**）。
4. 为后续能力留出接缝：真设备驱动（Modbus/OPC UA/MQTT）、SSO、权限分级。

### 非目标（本期不做）
- 不改工程 JSON / Publish 包 / AnimationLink 语义 / WS Tag 协议 / 动画执行语义（C 类）。
- **不做领域关系化重设计**：`document_json` / `package_json` 继续整包 JSON 直存。
- 不引入 Spring Security 全家桶 / OAuth2 / SSO（本期只等价现有单 Token 鉴权）。
- 不动前端、不动 UI、不动打包产物的对外文件名（`WebScada-*-win-x64`、`WebScada-Setup-*.exe`）。

---

## 2. 现状盘点（对拍基线）

| 维度 | 现状（事实） |
| :- | :- |
| 框架 | Fastify 5 + TypeScript + `tsx`；`apps/server/src` 24 文件 / 约 2.6k 行 |
| 入口 | `src/index.ts` → `buildApp()`（`app.ts`） |
| 监听 | `HOST=0.0.0.0`（默认）、`PORT=8787` |
| 插件 | `@fastify/cors`(origin true)、`@fastify/multipart`(200MB/1 文件)、`@fastify/websocket`、`@fastify/static`(资源 + SPA) |
| 存储门面 | `store.ts`：MySQL 优先，`MYSQL_FALLBACK_FILE=true` 时回退 `store.file`（`data/*.json`） |
| MySQL 表 | `projects`、`publishes`、`app_meta`、`tags`、`devices`（DDL 见 §4.4） |
| 时序库 | InfluxDB 2.x，`bucket=tags`、`measurement=tag_value`、写入精度 `ms`；`INFLUX_REQUIRED=false` 时不可用不阻塞 |
| 实时 | `/api/ws/tags` 裸 JSON（非 STOMP）：snapshot / delta / subscribe / unsubscribe / write / writeResult |
| 上传/静态 | `POST /api/resources/upload?projectId=`；静态前缀 `/api/files/` 指向 `data/resources` |
| 鉴权 | 可选单 Token：`Authorization: Bearer` / `X-SCADA-Token` / `?token=`；GET 多路径白名单 |
| 前端契约 | `apps/web/src/shared/api/client.ts`（`API_BASE = VITE_API_BASE || '/api'`）、`tagsWebSocketUrl()` |
| 打包 | `scripts/pack-windows.ps1 -IncludeNode`：esbuild 出 `server.mjs` + **内嵌 node-v20.18.1**；`packaging/web-scada.iss`(Inno Setup) 出 `WebScada-Setup-0.1.0.exe` |
| 站点包 | `release/WebScada-0.1.0-win-x64`（`server.mjs` + `public/` + `data/` + `start-site.bat`），`SCADA_SITE_TEMPLATE` 可覆盖 |

---

## 3. 契约冻结清单（C 类 · 必须逐字节兼容）

### 3.1 路由清单（29 条 REST + 1 条 WebSocket，全部挂在 `/api` 下）

| # | 方法 · 路径 | 请求 | 成功响应（关键字段） | 错误 |
| :- | :- | :- | :- | :- |
| 1 | `GET /api/health` | — | `{ok:true, service:"web-scada-server", time, mysql:{ready,error,host,port,database}, influx:{ready,error,url,org,bucket,measurement}, storage:'mysql'\|'file', tags:number, auth:{enabled,required}}` | — |
| 2 | `GET /api/settings/database` | — | `{settings:{mysql:{…无 password，有 passwordSet/passwordMasked}, influx:{…tokenSet/tokenMasked}}, status:{mysql,influx,storage}}` | — |
| 3 | `PUT /api/settings/database` | `{mysql?,influx?}`（空 password/token = 保持原值） | `{ok:true, mysqlOk, influxOk, settings, status}` | `400 invalid_settings_body` |
| 4 | `POST /api/settings/database/test` | `{mysql?,influx?}` | `{mysql:{ok,error?}, influx:{ok,error?}}` | — |
| 5 | `GET /api/projects` | — | `{items:[{id,name,updatedAt,version}], lastProjectId}` | — |
| 6 | `GET /api/projects/:id` | — | 整个 `ProjectDocument` | `404 project_not_found` |
| 7 | `PUT /api/projects/:id` | `ProjectDocument`（`meta.id` 必须等于 path） | 存回的 `ProjectDocument`（`meta.updatedAt` 被服务器改写为 `Date.now()`） | `400 invalid_project_body` |
| 8 | `POST /api/projects` | `ProjectDocument` | `ProjectDocument` | `400 invalid_project_body`、`409 project_exists` |
| 9 | `DELETE /api/projects/:id` | — | `{ok:true}`（同时删该工程的 publish） | `404 project_not_found` |
| 10 | `GET /api/projects/:id/export` | — | `application/zip`，`Content-Disposition: attachment; filename*=UTF-8''<encodeURIComponent(fileName)>` | `404 project_not_found`、`500 export_failed` |
| 11 | `GET /api/projects/:id/export/site` | — | `application/zip`（同上头） | `404`、`503 site_template_missing`、`501 site_export_windows_only`、`500 site_export_failed` |
| 12 | `POST /api/projects/import` | multipart（单文件 zip） | 新建的 `ProjectDocument`（**总是新 ID**） | `400 file_required`、`400 invalid_zip`、`400 missing_project_json`、`400 invalid_project_json`、`400 invalid_project_body`、`400 unsupported_package_format`、`500 import_failed` |
| 13 | `GET /api/publishes` | — | `{items:[{projectId,projectName,publishVersion,publishedAt}]}`（`publishedAt` 降序） | — |
| 14 | `GET /api/publishes/latest` | — | `PublishPackage` | `404 publish_not_found` |
| 15 | `GET /api/publishes/:projectId` | — | `PublishPackage` | `404 publish_not_found` |
| 16 | `PUT /api/publishes/:projectId` | `PublishPackage`（`manifest.projectId` 必须等于 path） | 存回的 `PublishPackage` | `400 invalid_publish_body` |
| 17 | `GET /api/devices` | — | `{items:[DeviceMeta]}` | — |
| 18 | `POST /api/devices` | `DeviceMeta` | `DeviceMeta` | `400 invalid_device_body`、`400 invalid_device_id`、`409 device_exists`、`503 mysql_unavailable` |
| 19 | `PUT /api/devices/:deviceId` | `Partial<DeviceMeta>` | `DeviceMeta` | `404 device_not_found`、`503 mysql_unavailable` |
| 20 | `DELETE /api/devices/:deviceId` | — | `{ok:true}` | `404`、`503` |
| 21 | `GET /api/tags` | — | `{items:[TagMeta], values:[TagValue]}` | — |
| 22 | `GET /api/tags/values` | — | `{values:[TagValue]}` | — |
| 23 | `POST /api/tags` | `TagMeta` | `TagMeta`（随后 `reloadTagRuntime()`） | `400 invalid_tag_body`、`400 invalid_tag_id`、`400 device_id_required`、`400 device_not_found`、`409 tag_exists` |
| 24 | `PUT /api/tags/:tagId` | `Partial<TagMeta>` | `TagMeta` | `404 tag_not_found`、`400 device_id_required`、`400 device_not_found` |
| 25 | `DELETE /api/tags/:tagId` | — | `{ok:true}` | `404 tag_not_found` |
| 26 | `POST /api/tags/:tagId/write` | `{value: boolean\|number\|string\|null}` | `{ok:true,message:'ok',value:TagValue}` | `400 {ok:false,message}`（见 §5 D7） |
| 27 | `POST /api/tags/history` | `{samples:[{tagId,value,quality,timestamp?}]}` | `{ok:true,written:number}` | `503 influx_unavailable`、`400 invalid_samples` |
| 28 | `GET /api/tags/:tagId/history` | query `start`、`stop`、`limit` | `{tagId, points:[…]}`（limit 夹在 1~5000，默认 500） | `503 influx_unavailable` |
| 29 | `POST /api/resources/upload?projectId=` | multipart（单文件） | `{id,name,kind,path,mimeType,size}` | `400 project_id_required`、`400 invalid_project_id`、`400 file_required`、`500 upload_failed` |
| 30 | `GET /api/ws/tags` | WebSocket 升级 | 见 §3.3 | — |

> 计数说明：**REST 29 条 + WebSocket 升级 1 条 = 30 条**。之前口头估的"22 个端点"是按源码里路由注册点粗数的近似值，**对拍请以本表为准**（本表逐条对应 `apps/server/src/routes/*.ts`）。

### 3.2 错误码字典（保持字面量不变）
`unauthorized` `not_found` `invalid_project_body` `project_not_found` `project_exists` `export_failed` `site_export_failed` `site_template_missing` `site_export_windows_only` `invalid_zip` `missing_project_json` `invalid_project_json` `unsupported_package_format` `import_failed` `publish_not_found` `invalid_publish_body` `invalid_device_body` `invalid_device_id` `device_not_found` `device_exists` `device_id_required` `mysql_unavailable` `invalid_tag_body` `invalid_tag_id` `tag_not_found` `tag_exists` `influx_unavailable` `invalid_samples` `invalid_settings_body` `project_id_required` `invalid_project_id` `upload_failed`

### 3.3 WebSocket 协议 `/api/ws/tags`（裸 JSON，无子协议）

**服务端 → 客户端**

| 报文 | 载荷 | 时机 |
| :- | :- | :- |
| `tag.snapshot` | `{type, metas:[TagMeta], values:[TagValue]}` | 连接建立后立即；`subscribe` 之后重推（按订阅过滤 values，metas 始终全量） |
| `tag.delta` | `{type, values:[TagValue]}` | 值变化时（1s tick 或写值），按会话订阅过滤，无变化不发 |
| `tag.writeResult` | `{type, ok, message, tagId, value?}` | 每次 `write` 单发回执 |

**客户端 → 服务端**

| 报文 | 载荷 | 语义 |
| :- | :- | :- |
| `subscribe` | `{type, tagIds?: string[]}` | `tagIds` 为数组 → 只收这些；缺省/非数组 → **全部** |
| `unsubscribe` | `{type}` | 订阅集置空（此后不再收 delta） |
| `write` | `{type, tagId, value}` | 触发写值；无权限 → `tag.writeResult{ok:false,message:'unauthorized'}` |

**约束**
- `write` 成功后**会对所有客户端广播 delta**（含发起者）；`TagValue = {tagId, value, quality, timestamp}`。
- 鉴权：`allowWrite = tokenMatches(token)`；鉴权关闭时恒为可写。
- 畸形 JSON **静默忽略**（现状如此；迁移后建议保留行为 + 落 debug 日志）。

### 3.4 数据模型（现网 DDL，迁移后必须逐字段一致）

```sql
-- 建库（bootstarp 连接不带 database）
CREATE DATABASE IF NOT EXISTS `web_scada` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  version VARCHAR(64) NOT NULL DEFAULT '0.1.0',
  updated_at BIGINT NOT NULL,
  document_json LONGTEXT NOT NULL,
  created_at BIGINT NOT NULL,
  INDEX idx_projects_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS publishes (
  project_id VARCHAR(64) PRIMARY KEY,
  project_name VARCHAR(255) NOT NULL,
  publish_version VARCHAR(64) NOT NULL,
  published_at BIGINT NOT NULL,
  package_json LONGTEXT NOT NULL,
  INDEX idx_publishes_published (published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_meta (
  meta_key VARCHAR(64) PRIMARY KEY,
  meta_value VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tags (
  tag_id VARCHAR(128) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  tag_group VARCHAR(128) NULL,
  device_id VARCHAR(128) NULL,
  address VARCHAR(255) NULL,
  data_type ENUM('bool','int','float','string') NOT NULL DEFAULT 'float',
  unit VARCHAR(64) NULL,
  writable TINYINT(1) NOT NULL DEFAULT 0,
  description VARCHAR(512) NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_tags_name (name),
  INDEX idx_tags_group (tag_group)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS devices (
  device_id VARCHAR(128) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  protocol VARCHAR(32) NOT NULL DEFAULT 'mock',
  channel VARCHAR(512) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  description VARCHAR(512) NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  INDEX idx_devices_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**三条容易踩的坑**
1. 所有时间戳是 **epoch 毫秒 BIGINT**（`created_at` / `updated_at` / `published_at`）。**禁止**改成 `DATETIME`/`TIMESTAMP` —— 前端直接 `new Date(ms)`，类型一变会静默坏排序与显示。
2. `document_json` / `package_json` 是 **整包 JSON 直存**（LONGTEXT）。**禁止**关系化拆表 —— 工程模型还在演进，拆表等于把 C 类契约钉死在 SQL 里。
3. `tags.data_type` 是 **ENUM**，写入非法值会报错（不是截断）；`writable`/`enabled` 是 `TINYINT(1)`，Java 侧用 `Boolean` 映射即可。

### 3.5 资源上传与静态契约

- 落盘路径：`{dataRoot}/resources/{projectId}/{res_<Date.now()>_<rand5>}_{safeFileName}`
- 文件名清洗：`name.replace(/[^\w.\-()\u4e00-\u9fff]+/g, '_').slice(0, 120) || 'file'`（★ 中文与括号保留，这项要逐字符复刻，否则已存工程的资源 URL 会变）
- 对外 URL：`/api/files/{projectId}/{storedName}` —— **会被写进工程 JSON，永久不可变**
- `kind` 判定（顺序即优先级）：
  1. `.svg` 或 `image/svg+xml` → `svg`
  2. `.glb|.gltf|.obj|.fbx|.stl` 或 mime 含 `gltf`/`fbx` 或 `model/obj`/`model/stl` → `model`
  3. mime 以 `image/` 开头或 `.png|.jpe?g|.gif|.webp|.bmp` → `image`
  4. 其余 → `other`
- 路径穿越防护：`resolve(base, name)` 之后必须仍在 `base` 下（现状 `resolveResourceFile` 的 `startsWith(base + sep)` 校验要保留）。

### 3.6 文件回退语义（对齐 `store.file`）

| 文件 | 内容 |
| :- | :- |
| `data/projects/{id}.json` | ProjectDocument |
| `data/publishes/{id}.json` | PublishPackage |
| `data/tags.json` / `data/devices.json` | 变量/设备元数据 |
| `data/meta.json` | `{lastProjectId}` |
| `data/db-settings.json` | `{mysql:{…}, influx:{…}}`（**优先级高于 .env**，运行时可改） |

- `MYSQL_FALLBACK_FILE=true` 时：写 MySQL **同时**再写一份文件（`saveProject` / `savePublish` 双写兜底）。
- **站点包导出直接把同样布局写进 zip 的 `data/`**（见 `sitePackage.ts`）→ 所以文件布局本身也是契约，不能改。

### 3.7 配置与环境变量

| 变量 | 默认 | 说明 |
| :- | :- | :- |
| `HOST` / `PORT` | `0.0.0.0` / `8787` | 监听 |
| `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE` | `127.0.0.1/3306/root/root/web_scada` | — |
| `MYSQL_FALLBACK_FILE` | `true` | MySQL 不可用是否回退文件 |
| `INFLUX_URL/TOKEN/ORG/BUCKET/MEASUREMENT` | `127.0.0.1:8086` / 空 / `web-scada` / `tags` / `tag_value` | — |
| `INFLUX_REQUIRED` | `false` | true = 连不上则拒绝启动 |
| `SCADA_API_TOKEN` | 空 | 空 = 关闭鉴权 |
| `SCADA_AUTH_REQUIRED` | `false` | true + token 空 = 拒绝启动 |
| `SCADA_HOME` / `SCADA_DATA` / `SCADA_WEB_ROOT` / `SCADA_SITE_TEMPLATE` | — | 路径覆盖（打包态用） |

**`.env` 加载顺序（后加载的覆盖前者）**：`$SCADA_HOME/.env` → `apps/server/.env` → `{dataRoot}/.env`；再叠加 `data/db-settings.json`（最高）。
Spring 侧需用一个自定义 `PropertySource`（或 `spring.config.import=optional:file:…` 三段）复刻这个顺序，**不能只靠 `application.yml`**。

**鉴权白名单（鉴权开启时仍匿名可访问）**：
`GET /api/health`、`GET /api/files/**`、`/api/ws/tags`、`GET /api/tags`、`GET /api/tags/values`、`GET /api/tags/{id}/history`、`GET /api/projects`、`GET /api/projects/{id}`、`GET /api/publishes`、`GET /api/publishes/latest`、`GET /api/publishes/{id}`、`GET /api/devices`、`GET /api/settings/database`
（注意 `/api/projects` 的 **POST/PUT/DELETE 不在白名单**；`/api/resources/upload`、写值、设置修改都不在）

---

### 3.8 历史查询契约（前端消费方：**实时趋势** / **历史趋势**）

两个 2D 图元定义在 `packages/core/src/factory/widget.ts`（`trend` / `trendHistory`，调色板组 `industrial`）。

| 图元 | type | 数据来源 | 关键 props |
| :- | :- | :- | :- |
| **实时趋势** | `trend` | **前端滚动缓冲**：`bindingEngine` 把 ValueOut / `prop=value` 绑定的最新值 push 进 `props.series`，按 `maxPoints`（5~500，默认 40）截断。**不查历史**，只吃 WS `tag.delta` / REST values | title · chartType · series · maxPoints · min · max |
| **历史趋势** | `trendHistory` | **HTTP 查 Influx**：`GET /api/tags/{tagId}/history?start=<range>&limit=<maxPoints>`；绑定取 `animationLinks[type=valueOut]`，否则 `bindings[prop=value]` | 同上 + `range`（`-15m`/`-1h`/`-8h`/`-24h`/`-7d`，默认 `-1h`）+ maxPoints 10~2000（默认 240） |

相关实现（对拍定位）：`apps/web/src/shared/runtime/trendHistoryQuery.ts`（查询/去重/轮询）、`apps/web/src/shared/runtime/bindingEngine.ts`（`trend` 入队、`trendHistory` 取数）、`apps/web/src/shared/konva/widgetNodes.ts`（Konva 绘制）、`apps/web/src/components/designer/PropertyPanel.vue`（属性面板）、`apps/web/src/stores/tag.ts`（周期刷新 + 重绘通知）。

**后端必须保持的语义（逐条）**

1. `start` 是**相对范围字符串**，Node 侧目前把它**原样塞进 Flux**：`range(start: <原样>, stop: now())`（仅当不以 `-`/数字开头时才加引号）。→ Spring 版必须接受同一组 `-15m/-1h/-8h/-24h/-7d` 并映射到**同一时间窗**，**不得**改成 ISO 时间戳、不得换单位。
2. 前端**只传 `start` 与 `limit`**，不传 `stop`（后端默认 `stop=now()`）。
3. `limit` 后端夹取 `1~5000`（默认 500）；前端 `maxPoints` 再夹 `10~2000`。
4. 返回形状 `{tagId, points:[{tagId, time, value, quality}]}`；前端只用 `value`（非有限值被过滤掉），`time` 目前不参与绘制 —— 但**字段名不能改**。
5. Influx 不可用 → `503 {error:'influx_unavailable', detail}`；前端 catch 后**保留上一份曲线**（不白屏，但曲线停更）。
6. 查询去重键 `tagId|start|limit`（同 key 不重复请求）+ generation 防竞态 → 后端接口须**无副作用、结果可重复**。
7. 未绑定变量 / `tags.mode !== 'live'` / 查询失败时，图元显示 `props.series` 里的**示例曲线**（新建图元自带一串数据）。这是刻意行为，迁移后不要"顺手修掉"。
8. 同一契约还包含**历史写入** `POST /api/tags/history`（`{samples:[{tagId,value,quality,timestamp?}]}` → `{ok,written}`）、Influx 写入精度 `ms`、`measurement=tag_value`。
9. 轮询刷新：`stores/tag.ts` 周期性调用 `reloadTrendHistoryQueries()`（与告警历史一起），加载完成经 `onTrendHistoryLoaded` 触发画面重绘 → 后端要能承受周期性重复查询。

> **迁移风险（"看起来没坏、其实坏了"）**：改相对范围的写法/单位、把 `time` 从字符串换成数字、或改掉 `limit` 的语义（"点数" vs "采样窗口"）—— 前端**不会报错**，只是曲线变空或范围不对，属于最难查的一类。

---

## 4. 目标架构（Spring Boot）

### 4.1 选型

| 项 | 选择 | 理由 / 约束 |
| :- | :- | :- |
| 框架 | Spring Boot 3.3.x（Java 17 或 21） | 前置 P1；Boot 3 需 JDK17+ |
| Web | `spring-boot-starter-web`（内嵌 Tomcat） | 端口/前缀不变 |
| WS | `spring-boot-starter-websocket` + **原生 `TextWebSocketHandler`** | 前端是 `new WebSocket()` + 裸 JSON；**不要用 STOMP**（会改协议） |
| 持久化 | **`JdbcTemplate` + Flyway** | 契约是 JSON blob + 少量列；JPA/Hibernate 只会引入映射风险与 N+1；rules 禁止**擅自**上 ORM |
| 时序 | `influxdb-client-java`（7.x） | 保持 bucket/measurement/`ms` 精度/Flux 查询一致 |
| JSON | Jackson；工程文档用 **`JsonNode` 透传** | 见 D1；避免强类型反序列化丢字段/报 400 |
| 日志 | Logback（JSON 或 plain，字段对齐 pino 的 `level/msg/time`） | 运维脚本、日志采集不换 |
| 构建 | Maven（或 Gradle） | 本机都没有，需装 |
| 打包 | `spring-boot-maven-plugin` → `server.jar` + 内嵌 JRE | 见 §8 |

### 4.2 包结构

```text
apps/server-java/                      ← 新增目录，与 apps/server 并存（不删旧实现）
└── src/main/java/com/webscada/server
    ├── ServerApplication.java
    ├── config/       ServerProperties · WebConfig(CORS/静态资源/SPA fallback)
    │                 · MultipartConfig · PathsProvider(SCADA_HOME/DATA/WEB_ROOT)
    │                 · EnvChainPropertySource(.env 三级 + db-settings.json)
    │                 · PersistenceConfig(动态 DataSource/重连) · InfluxConfig
    │                 · ApiTokenAuthFilter + PublicRoutes
    ├── web/          HealthController · SettingsController · ProjectController
    │                 · PublishController · DeviceController · TagController
    │                 · ResourceController · ErrorMapping(@RestControllerAdvice)
    ├── ws/           TagWebSocketConfig(注册 /api/ws/tags) · TagWebSocketHandler
    │                 · TagSessionRegistry(订阅集 + 背压 decorator) · WsMessage(record)
    ├── service/      ProjectService · PublishService · DeviceService · TagMetaService
    │                 · ResourceStorageService · ProjectPackageService(zip 导入导出)
    │                 · SitePackageService(站点包) · DatabaseSettingsService
    │                 · TagRuntimeService(@Scheduled tick/broadcast/write)
    │                 · TagDriver(接口) + MockTagDriver(现网模拟算法)
    ├── store/        ProjectStore · PublishStore · TagMetaStore · DeviceStore   ← 门面
    │                 MysqlXxxStore · FileXxxStore（@ConditionalOnProperty 切）
    └── db/           MysqlBootstrap(建库) · FlywayConfig · InfluxClientHolder
└── src/main/resources
    ├── application.yml
    └── db/migration/V1__init.sql      ← 与 §3.4 DDL 逐字一致
```

### 4.3 组件映射（Node → Spring）

| 现状 | Spring 对应 | 备注 |
| :- | :- | :- |
| `app.ts buildApp()` | `ServerApplication` + `WebConfig` + 各 `*Config` | 插件顺序：CORS → multipart → ws → 静态 → 鉴权 → 路由 |
| `plugins/auth.ts` | `ApiTokenAuthFilter`(OncePerRequestFilter) + `PublicRoutes` | 白名单逐条搬，写单测 |
| `routes/health.ts` | `HealthController#health` | 字段顺序无关，字段名/类型必须一致 |
| `routes/projects.ts` | `ProjectController` | zip 导出要设 `Content-Disposition` 的 `filename*=UTF-8''…` |
| `store.ts` + `store.file.ts` | `ProjectStore`/`PublishStore` 接口 + Mysql/File 两实现 | 对齐 `MYSQL_FALLBACK_FILE` 与"双写兜底" |
| `db/mysql.ts:initMysql()` | `MysqlBootstrap` + Flyway + `DataSource` 热重建 | 先无库连接建库，再建池 |
| `db/tags.ts` / `db/devices.ts` | `TagMetaStore` / `DeviceStore` | `deviceId` 外键校验在 Controller 层（同现状） |
| `db/influx.ts` | `InfluxClientHolder` + `InfluxHistoryRepository` | 写入失败**只记日志**、不阻塞实时（现状空 catch → 迁移补日志，符合 rules） |
| `services/tagRuntime.ts` | `TagRuntimeService` + `TagSessionRegistry` + `MockTagDriver` | 见 §5 |
| `services/resources.ts` | `ResourceStorageService` | 文件名清洗/kind 判定逐字复刻 |
| `services/projectPackage.ts` / `sitePackage.ts` | `ProjectPackageService` / `SitePackageService` | **zip 内条目名与目录结构必须一致** |
| `config.ts` + `paths.ts` | `ServerProperties` + `PathsProvider` + `EnvChainPropertySource` | `.env` 三级顺序 + `db-settings.json` 覆盖 |

### 4.4 端点 → Controller 映射（实现要点）

| 端点 | Controller 方法 | 要点 |
| :- | :- | :- |
| `GET /api/health` | `HealthController.health()` | 需要 `tags` 数量 → 走 `TagMetaStore.count()` |
| `GET/PUT/POST /api/settings/database*` | `SettingsController` | PUT 之后要**重建 DataSource/Influx 客户端**（不是重启进程）+ `reloadTagRuntime()` |
| 项目 5 条 | `ProjectController` | `PUT /api/projects/{id}` 要校验 `body.meta.id == path id`；保存时服务器改写 `meta.updatedAt` |
| `export` / `export/site` | 同上 | `@GetMapping("/api/projects/{id}/export")` 与 `{id}` 精确路径并存，Spring 无"注册顺序"坑；错误映射见 §3.2 |
| `POST /api/projects/import` | `ProjectController.import()` | `MultipartFile`；**总是新建 ID**；错误码按 zip 校验阶段区分 |
| publishes 4 条 | `PublishController` | `latest` 逻辑：先取 `app_meta.last_project_id` 对应的 publish，取不到再回退列表第一条 |
| devices 4 条 | `DeviceController` | 写操作 catch → `503 mysql_unavailable`（现状如此） |
| tags 7 条 + WS | `TagController` / `TagWebSocketHandler` | `POST /api/tags/{id}/write` 与 WS `write` 共用 `TagRuntimeService.write()` |
| `POST /api/resources/upload` | `ResourceController` | `projectId` 正则 `^[a-zA-Z0-9._\-]+$`；流式落盘（不要先读进内存） |

---

## 5. Tag 运行时设计（最容易翻车的一块）

### 5.1 数据结构与线程模型

```java
final Map<String, TagValue> values = new ConcurrentHashMap<>();      // tagId → 当前值
final Set<TagSession> sessions = ConcurrentHashMap.newKeySet();      // 在线会话
volatile List<TagMeta> metas = List.of();                            // 元数据快照
```

- `@Scheduled(fixedRate = 1000)` → `tick()`；`@Scheduled(fixedRate = 8000)` → `qualityTick()`
- 广播在调度线程内完成；**慢客户端**用 `ConcurrentWebSocketSessionDecorator(session, sendTimeLimitMs, bufferSizeLimitBytes)` 包装后 `sendMessage()`，避免拖垮 tick（现状是无背压的裸 `send`）
- 会话订阅：`Set<String> subscribed`；`null` = 全部，空集 = 不收

### 5.2 必须逐条对齐的行为（否则曲线/交互会变）

| 行为 | 现状实现 | 迁移要求 |
| :- | :- | :- |
| 初始值 | 先取 `createInitialMockValues()` 的种子；无种子按类型给 `false` / `''` / `0` | 一致 |
| 元数据增删 | `reloadTagRuntime()` 补新 tag 的初值、删已移除 tag 的值 | 一致（新增/改/删 tag 后都要调用） |
| float 游走 | `next = cur + (rand-0.5) * amp`，`amp = tagId.includes('level')?2 : includes('pressure')?0.4 : 0.8`；`level` 夹 `[0,100]`；`+next.toFixed(1)`（**保留 1 位小数**） | 逐条复刻（含 toFixed 的舍入方向） |
| 质量抖动 | `demo.temp` 每 8s：85% 概率不动；否则随机 `Bad`/`Uncertain`，2s 后恢复 `Good` | 一致（这是给前端演示质量位用的） |
| delta 时机 | 仅"有变化"才发；按会话订阅过滤；`readyState != OPEN` 跳过 | 一致 |
| 写值归一化 | `bool→Boolean`、`int→Math.trunc(Number)`、`float→Number`、`string→String`；数值非有限 → `Invalid numeric value` | 一致（含错误文案） |
| 写值校验顺序 | ① meta 不存在 → `Tag not found` ② `!writable` → `Tag is read-only` ③ 归一化校验 | 顺序一致 |
| 写值副作用 | `setTagValue(...,'Good')` → 广播 delta（**给所有客户端，含发起者**）→ 异步写 Influx | 一致 |
| 历史写 | 仅 Influx ready 时；异常吞掉（不阻塞实时） | 保留"不阻塞"，但**补日志**（rules 禁止空 catch） |

### 5.3 为真设备留的接缝

```java
interface TagDriver {
  void start(List<TagMeta> metas, Consumer<TagValue> sink);  // 驱动产生值 → sink 写入运行时
  void write(String tagId, Object value);                    // 下发（Mock 直接回灌）
  void stop();
}
```
- 本期只有 `MockTagDriver`（复刻现网算法），行为与现状 1:1。
- 后续 `ModbusTcpDriver` / `OpcUaDriver` / `MqttDriver` 新增实现即可，**不动 WS/REST 契约**。这是"迁 Spring 的主要收益点"。

---

## 6. 关键设计决策（含取舍）

| # | 决策 | 理由 | 被否决的替代方案 |
| :- | :- | :- | :- |
| **D1** | 工程/发布文档 **整包 JSON 直存**，Java 侧用 `JsonNode`/`Map` 透传，不强类型反序列化 | 工程模型仍在演进；强类型 DTO 会"丢字段/多字段报错"，等于把契约钉死在 Java 类上 | JPA 实体映射（工程 JSON 关系化）→ 契约漂移风险最高 |
| **D2** | 时间戳一律 **epoch 毫秒 BIGINT** | 前端 `new Date(ms)`；JS `Date.now()` 语义 | `DATETIME`/`TIMESTAMP` → 时区/精度问题，静默破坏排序 |
| **D3** | 存储用 **门面 + 双实现**（MySQL / File），`@ConditionalOnProperty(MYSQL_FALLBACK_FILE)` | 现场单机部署常无 MySQL；打包态站点包就是纯文件版 | 直接硬绑 MySQL → 现场装不了 |
| **D4** | **Flyway** 管 schema，`V1__init.sql` 与现网 DDL 逐字一致 + `baseline-on-migrate=true` | 允许接已存在的库；两者 DDL 一致 → 灰度可随时回滚到 Node | 让 Hibernate `ddl-auto` 建表 → 列类型/索引会漂 |
| **D5** | WS 用**原生 handler**，不上 STOMP/Socket.IO | 前端是裸 `WebSocket` + JSON；STOMP 会改协议 | STOMP（改契约，前端要动） |
| **D6** | Tag 运行时抽象 `TagDriver`，本期只实现 Mock | 现网行为 1:1 复刻；为真设备留接缝 | 直接把模拟算法写进 Service → 将来接设备要重写 |
| **D7** | 写值语义**逐条等价**（错误文案、归一化顺序、广播范围） | 写值 = 潜在控制动作（`10-scada-business.mdc`），语义不能"顺手优化" | 统一返回 400 + 枚举错误码（会破前端判断） |
| **D8** | 模拟算法（amp / 夹取 / `toFixed(1)` / 质量抖动）**原样复刻** | 前端演示与截图基线不变 | "更真实"的模拟（会改曲线形状，用户会认为坏了） |
| **D9** | 鉴权白名单抽成常量 + 单测 | 漏一条 → Runtime 打不开（很难查） | 在 Filter 里内联 if（易漏） |
| **D10** | 打包由"内嵌 Node"改为"内嵌 JRE"，但**新增开关**保留旧路径 | 迁移期可能要新旧并存；现场升级要能回退 | 直接替换打包脚本 → 无法回滚 |
| **D11** | 端口/前缀/路径/文件名全部沿用（8787、`/api/files/`、`WebScada-*-win-x64`） | 已发出的站点包/客户端/快捷方式不受影响 | 趁机改名/换端口 → 现场全要重配 |
| **D12** | 新增目录 `apps/server-java/`，**不删** `apps/server/` | 灰度期两套并存；回滚零成本 | 原地重写 → 回滚要 revert 一大批文件 |

---

## 7. 灰度与回滚

| 阶段 | 动作 | 回滚 |
| :- | :- | :- |
| **S0 对拍基线** | 在 Node 上跑 golden 用例（全部 28 条路由 + WS 时序），把响应存成固定文件（时间戳字段归一化） | — |
| **S1 只读并跑** | Spring 起 `health` + `tags*` + `ws/tags`；代理按前缀切：**这两块给 Spring，其余仍 Node**；写值只由 Node 处理 | 代理切回（秒级） |
| **S2 元数据** | 切 devices / settings / tags 的写 | 同上 |
| **S3 工程** | 切 projects / publishes / resources / 静态 `/api/files/**` | 同上 |
| **S4 静态与 SPA** | 切 `/`（index.html + SPA fallback） | 同上 |
| **S5 打包** | 新打包脚本 + 站点包模板切 Spring，**旧模板保留** | 用旧模板重出包 |

**数据一致性铁律（灰度期）**：同一时刻**只有一个写 owner**。建议 S1~S3 期间 **Node 写、Spring 只读**；切换后再反转。禁止双写（会分叉）。MySQL DDL 完全一致 → 切换不需要数据迁移。

---

## 8. 打包与部署改造

| 项 | 现在（Node） | 迁移后（JRE） |
| :- | :- | :- |
| 服务产物 | `server.mjs`（esbuild 打包） | `server.jar`（spring-boot repackage） |
| 运行时 | 内嵌 `node-v20.18.1-win-x64`（`-IncludeNode`） | 内嵌 `jre/`（`jlink` 精简 ≈ 40–60MB，或完整 JRE ≈ 180MB） |
| 启动 | `start.bat` → `node server.mjs` | `start.bat` → `jre\bin\java -jar server.jar` |
| 安装脚本 | `packaging/web-scada.iss`（Inno Setup） | 需改文件清单 + 卸载时进程名（`java.exe`） |
| 站点包目录 | `server.mjs` + `public/` + `data/` + `start-site.bat` + `README-SITE.txt` | `server.jar` + `jre/` + `public/` + `data/` + 同名脚本/说明 |
| 风险 | — | 体积变大、`java.exe` 更易被杀软关注 → 需在**真实现场机**实测安装/启动/杀软 |

`SCADA_SITE_TEMPLATE` 已支持指向自定义模板目录 → 迁移期可**新旧模板并存**。

---

## 9. 验收对拍清单

1. **REST**：28 条路由的 golden diff（字段名、类型、时间戳单位、错误码与 HTTP 状态）。重点：`/api/health`、`/api/settings/database`（脱敏字段）、`/api/tags/:id/write` 的三种失败文案。
2. **WS**：连接首帧 `tag.snapshot`；`subscribe([...])` 后 snapshot 只含订阅项；`tag.delta` 只发变化项；`unsubscribe` 后不再收；`write` 回执 `tag.writeResult`；鉴权开启时未带 token 的 `write` → `unauthorized`。
3. **资源**：上传中文名/大写扩展名/无扩展名文件 → 返回 `path` 可直接 GET；`..%2f` 路径穿越被拒。
4. **包**：工程包 zip 条目名与 Node 版**完全一致**；站点包解压后 `start.bat` 能直接起 Runtime。
5. **Tag 曲线**：同一时间窗内做**统计特征对拍**（取值范围、单步幅度上限、小数位数、`demo.level` 的 0~100 夹取、`demo.temp` 质量位出现频率），而不是逐值相等（随机序列无法逐个复现）。
6. **降级**：不启 MySQL → `storage:'file'` 且设备/变量走文件；不启 Influx → `tags/:id/history` 返回 `503 influx_unavailable`，实时不受影响。
7. **两个趋势图元联调**（§3.8）：绑定 `demo.level` 的历史趋势分别选 `-15m` / `-1h` / `-7d` 三种范围 → 曲线非空、点数 ≈ limit；停掉 Influx → 历史趋势**保留上一份曲线**而不是白屏；实时趋势在 WS 断连重连后缓冲行为一致（`maxPoints` 截断、不查历史）。
8. **打包**：`pack` 产物安装→启动→打开 Runtime→写值→卸载，全链路在现场同版本 Windows 上跑通。

---

## 10. 风险登记

| 风险 | 影响 | 缓解 |
| :- | :- | :- |
| 契约漂移（字段/时间戳/错误码/文件名清洗） | 前端静默坏，最难查 | golden 对拍 + D1/D2/D11 + 禁止"顺手优化" |
| WS 慢客户端背压 | tick 广播卡住整个服务 | `ConcurrentWebSocketSessionDecorator` + 会话上限 |
| 模拟算法不一致 | 演示曲线形状变化 → 用户认为改坏了 | D8 逐条复刻 + 统计特征对拍 |
| file↔MySQL 双轨分叉 | 数据不一致 | 单写 owner + 只读灰度 + 切换前一致性校验脚本 |
| 环境缺失（JDK/构建工具） | 无法开工 | 先装 JDK17+ & Maven，写进前置清单 |
| 打包/部署形态变化 | 现场装不上、杀软拦截 | 新老模板并存 + 现场机实测 |
| **文档/规则冲突未裁决** | agent 反复挡工、实现被规则打断 | 先统一 README 与审计报告口径，并在 `.cursor/rules` 补一条"迁移流程" |
| 迁移期功能仍在迭代 | 返工、两套实现同时改 | **约定：迁移期间冻结 C 类契约**（工程 JSON/Publish/WS 报文/动画语义），否则先不迁 |

---

## 11. 里程碑与工时（单人，含对拍）

| 里程碑 | 内容 | 人日 |
| :- | :- | :- |
| M0 | 裁决文档冲突 + golden 基线采集（28 路由 + WS 时序） | 1–2 |
| M1 | 骨架 + Flyway + `health` + tags 只读 + 鉴权 Filter | 3–4 |
| M2 | WS + `TagRuntimeService`（Mock 驱动复刻）+ 对拍 | 3–5 |
| M3 | projects / publishes（含 zip 导入导出、站点包） | 4–6 |
| M4 | resources 上传 + 静态 `/api/files/**` + SPA fallback | 2–3 |
| M5 | settings（运行时切库）+ devices + tags 写 | 2–3 |
| M6 | 打包（内嵌 JRE）+ 灰度演练 + 回滚演练 | 3–4 |
| **合计** | | **18–27 人日** |

**最小验证切片（推荐）**：只做 **M1 + M2**（5–9 人日）就能验证"REST + WS + Tag 运行时"这条最容易翻车的链路；通过后再决定是否继续 M3~M6。这也是将来接真设备收益最大的部分。

---

## 12. 待你裁决（开工前必须回答）

1. **文档口径**：`README.md`（原计划 Spring Boot 3）与 `docs/代码规范与重构审计报告.md`（已放弃、禁止换栈）冲突 —— 以哪个为准？建议统一为"当前阶段保持 Node；启动迁移需用户明确确认 + 按本文流程"。
2. **目标版本**：JDK 17 还是 21？Spring Boot 3.3.x 是否可接受？
3. **文件回退**：是否保留 `MYSQL_FALLBACK_FILE` 文件存储（现场单机部署依赖它）？建议保留。
4. **新依赖授权**：Flyway + JdbcTemplate（**不引入 ORM**）是否同意？（对应 rules 02"禁止擅自引入"→ 需要你明确授权）
5. **打包形态**：内嵌精简 JRE（jlink，约 40–60MB）还是要求现场预装 JDK？
6. **范围**：SSO / 权限分级 / 真设备驱动是否本期做？（建议独立议题，本期只做等价迁移）
7. **冻结窗口**：迁移期间能否冻结 C 类契约（工程 JSON / Publish / WS 报文 / 动画语义）？若不能，建议推迟迁移。

---

## 附录 A：本设计依据的现状文件（供对拍定位）

```text
apps/server/src/index.ts                   启动入口
apps/server/src/app.ts                     插件/静态/路由注册
apps/server/src/config.ts                  .env 三级加载 + db-settings 覆盖 + 脱敏
apps/server/src/paths.ts                   SCADA_HOME/DATA/WEB_ROOT 解析
apps/server/src/store.ts                   MySQL/File 门面 + last_project_id + getLatestPublish 兜底
apps/server/src/store.file.ts              文件存储布局（契约）
apps/server/src/db/mysql.ts                建库 + 5 张表 DDL + 连接测试
apps/server/src/db/influx.ts               写入(ms) + Flux 查询(limit 1~5000)
apps/server/src/db/tags.ts / devices.ts    元数据 CRUD（MySQL/File 双轨）
apps/server/src/plugins/auth.ts            Token 三种取法 + 公开路由白名单
apps/server/src/routes/*.ts                28 条路由
apps/server/src/services/tagRuntime.ts     1s tick / 8s 质量抖动 / 广播 / 写值
apps/server/src/services/resources.ts      上传落盘 + 文件名清洗 + kind 判定
apps/server/src/services/projectPackage.ts 工程包 zip
apps/server/src/services/sitePackage.ts    站点包 zip（内嵌 data/ 布局）
apps/web/src/shared/api/client.ts          前端契约（API_BASE / tagsWebSocketUrl）
scripts/pack-windows.ps1 / packaging/web-scada.iss   打包与安装
```
