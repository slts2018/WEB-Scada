# web-scada-server (Spring Boot)

仓库唯一后端。契约说明见 `docs/spring-boot-migration-design.md`（该文后半是迁移记录）。

本地开发：仓库根目录 `pnpm dev`（前端 + 本服务）。

## 要求

- JDK 17+
- Maven 3.9+（本机可用 `%LOCALAPPDATA%\apache-maven-3.9.9\bin\mvn`）

## 运行（默认端口 8787）

```powershell
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot"
$env:SCADA_DATA = (Resolve-Path ..\data).Path
cd apps/server-java
& "$env:LOCALAPPDATA\apache-maven-3.9.9\bin\mvn.cmd" spring-boot:run
```

- MySQL 可用时自动建库 + Flyway，`storage=mysql`；不可用且 `MYSQL_FALLBACK_FILE=true`（默认）→ 文件存储。
- Influx：配置 token 后健康检查与历史接口可用；未配置不阻塞实时。
- `pnpm dev` 使用的启动脚本会先拉起内嵌 MariaDB 与 InfluxDB。

## 进度（相对设计 M0–M6）

| 项 | 状态 |
|----|------|
| M1 骨架 + REST + 鉴权 | 已实现 |
| M2 WS + Mock TagRuntime | 已实现 |
| M3 zip 导入/导出/站点包 | 已实现 |
| M4 resources + `/api/files` + SPA | 已实现 |
| M5 MySQL/Flyway 双轨 + settings 热切 + devices/tags 写 | 已实现 |
| Influx 历史读写 | 已实现（无 token → 503） |
| M6 `pnpm pack:win`（server.jar；可选 `SCADA_BUNDLE_JRE=1`） | 已实现 |

## 构建 / 打包

```powershell
mvn -DskipTests package
# target/web-scada-server-0.1.0-SNAPSHOT.jar

# 仓库根目录
pnpm pack:win
# 产物 release/WebScada-0.1.0-win-x64-java/
# 嵌入 JRE：$env:SCADA_BUNDLE_JRE='1'; pnpm pack:win
```
