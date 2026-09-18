# Windows 安装包

## 产物形态

| 产物 | 说明 |
|------|------|
| `release/WebScada-*-win-x64/` | 绿色版目录，可直接拷贝运行 |
| `release/WebScada-*-win-x64.zip` | 同上压缩包 |
| `release/WebScada-Site-*-win-x64/` | **网站包**：含工程快照，默认打开运行端 |
| `release/WebScada-Setup-*.exe` | 可选：用 Inno Setup 编译得到的安装程序 |

## 一键打包

在仓库根目录：

```bash
pnpm pack:win
```

内嵌便携 Node（体积更大，目标机可不装 Node）：

```bash
pnpm pack:win:node
```

导出**网站包**（需已有工程数据在 `apps/data`，或传 `-ProjectId`）：

```bash
pnpm pack:site
# 或
pnpm pack:site -- -ProjectId prj_xxx
```

设计端也可：**文件 → 导出网站包**（需先 `pnpm pack:win:node` 生成模板，或设置 `SCADA_SITE_TEMPLATE`）。

## 绿色版试用

1. 解压 zip 或进入 `release/WebScada-*-win-x64`
2. 双击 `launch.vbs`（或 `start.bat`）
3. 浏览器打开设计端（默认会自动打开）

网站包试用：解压 `WebScada-Site-*` → `start.bat` → `http://127.0.0.1:8787/runtime`；局域网他人访问 `http://服务器IP:8787/runtime`（防火墙放行 8787）。默认无鉴权，勿直接暴露公网。

双击无反应 / 无 `data\server.log` 时：运行安装目录里的 `diagnose.bat`，或查看 `%TEMP%\WebScada-launch.log`。

**安装路径**：默认 `C:\WebScada`，安装时可改（例如以前的 `D:\work\WebScada`）。不要装到 `Program Files`。

未装 MySQL 时会回退本地 `data/` 文件存储，包括：

| 内容 | 路径 |
|------|------|
| 工程 / 发布 | `data/projects/`、`data/publishes/` |
| 变量 / 设备 | `data/tags.json`、`data/devices.json` |
| 资源文件 | `data/resources/` |

说明：变量**当前值**仍是内存模拟，用于演示动画/写值；尚未接真实 PLC。

## 生成 Setup.exe

1. 安装 [Inno Setup 6](https://jrsoftware.org/isinfo.php)
2. 先执行 `pnpm pack:win`（或 `pack:win:node`）
3. 用 Inno 打开 `packaging/web-scada.iss` → Compile
4. 输出：`release/WebScada-Setup-0.1.0.exe`

若编译器缺少简体中文语言包，可把 `.iss` 里 `[Languages]` 改成：

```ini
Name: "english"; MessagesFile: "compiler:Default.isl"
```

## 架构说明

打包后由 **单个 Node 进程** 同时提供：

- API / WebSocket（原 8787）
- 前端静态资源（Designer / Runtime）

同一地址访问，无需再开 Vite。
