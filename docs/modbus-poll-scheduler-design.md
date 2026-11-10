# Modbus 采集调度改造方案

> 目标：变量上写的 `scanPeriodMs` 在现场大致可兑现；坏设备不能拖死好设备。  
> 原则：不改 Tag / WS / 工程 JSON / Publish / 地址与字序契约；只改 **server-java 内 Modbus 调度与会话生命周期**。  
> 对照：Flight `IO_Server`（一设备一线程 + 同周期合并 + 重连冷却），语义对齐、实现不照抄原生 Thread。

---

## 1. 问题与范围

### 现状问题

当前 `ModbusPollService`：

- `@Scheduled(fixedDelay=50)` + 全局 `busy` → **所有设备串在一条调度线程**
- 设备/点连接失败按 `connect-timeout-ms`（默认 2000）硬等
- **无设备级离线退避** → 坏设备每个到期周期都再连一次
- 无点设备仍按 `poll-ms` ping，失败同样拖全局

结果：配置 500ms 的点，实际常被其它设备的 2s 超时拉成 ~2s。

### 本期要做

| # | 能力 | 说明 |
|---|------|------|
| 1 | 设备隔离调度 | 设备之间互不阻塞；设备内仍串行（Modbus TCP 一连接一会话） |
| 2 | 设备级离线状态机 | 连续失败 → Offline + cooldown；冷却内跳过连接 |
| 3 | 写优先（同设备） | HTTP/WS 写值与同设备读排队，写插队 |
| 4 | 可观测 | 设备 online/offline 原因、冷却剩余、本轮 costMs；日志不刷屏 |

### 本期不做

- 不改 `/api/ws/tags` 报文、`TagMeta` / `DeviceMeta` 字段含义、Publish 包
- 不改 `holding:#len`、Swap*、主备 channel 字符串格式（可复用现有 failover）
- 不引入 Redis/MQ；不新开第二套 HTTP 服务
- 不做跨协议统一 IO 总线（OPC/S7 等）
- **批量合并读（同周期连续地址打包）放二期**——点少时阶段 1+2 已够；点多再做

### 影响分级

| 项 | 级 | 说明 |
|----|-----|------|
| Poll 线程模型 / 离线退避 | **B** | 行为对用户可见（周期变准），但对外 API 不变 |
| Tag 质量 Bad / setTagValue | A | 沿用现有 |
| 若将来改 WS 设备状态字段 | C | 本期不碰；只用现有 `DeviceStatusService` |

---

## 2. 契约冻结边界（必须守住）

```text
┌─────────────────────────────────────────────────────────────┐
│  冻结（C / 对外契约）                                         │
│  TagMeta / DeviceMeta JSON                                   │
│  Tag 读写 API、/api/ws/tags 推送形状                          │
│  address 解析、Swap*、channel 主备格式                        │
│  setTagValue → 历史写入触发语义（若已有）                       │
└──────────────────────────▲──────────────────────────────────┘
                           │ 仅调用，不改语义
┌──────────────────────────┴──────────────────────────────────┐
│  可改（本期核心）                                              │
│  ModbusPollService 调度方式                                   │
│  设备 Worker / 线程池投递                                      │
│  离线 cooldown、连接尝试频率                                   │
│  ModbusTagIo 会话 gate 与「冷却期内拒绝 connect」               │
└──────────────────────────▲──────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────┐
│  尽量不动                                                      │
│  ModbusTcpClient 帧编解码、RegisterCodec、ModbusAddress       │
│  前端 VariableManageDialog（除非只加只读「冷却中」展示）         │
└─────────────────────────────────────────────────────────────┘
```

**验收口径（业务）：**

- 仅设备 A 的点设 `scanPeriodMs=500`，设备 B 故意不可达 → A 的更新间隔中位应接近 500ms（允许抖动，例如 p50 &lt; 700ms，p95 &lt; 1200ms），**不得**稳定落在 ~2s。
- 写值 API 行为、成功/失败错误码不变；同设备读写不交叉破坏帧。

---

## 3. 目标架构

### 3.1 组件图

```text
                 @Scheduled(fixedDelay≈50) 仅「派活」
                           │
                           ▼
                 ModbusPollDispatcher
                 - 枚举 enabled modbus 设备
                 - 按 deviceId 把「到期工作」丢给该设备的 DeviceWorker
                 - 自己不做阻塞 connect/read
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
     DeviceWorker     DeviceWorker    DeviceWorker
     (device A)       (device B)      (device C)
     单线程串行         单线程串行       …
           │
           ▼
     ModbusTagIo (已有 per-device gate)
           │
           ▼
     TagRuntimeService.setTagValue / DeviceStatusService
```

实现选项（择一，推荐 **选项 2**）：

| 选项 | 做法 | 优点 | 缺点 |
|------|------|------|------|
| 1 | 每设备一个长期 `Thread`（偏 Flight） | 隔离直观 | 设备多时线程多；停启麻烦 |
| **2** | 共享 `Executor` + **每设备串行队列**（`deviceId` 一把锁 / `SingleThreadExecutor` per device 懒创建） | 隔离 + 可控线程数 | 要管生命周期 |
| 3 | 虚拟线程 per poll 任务 + per-device 锁 | 代码短（JDK21+） | 需确认当前打包 JDK；仍要 cooldown |

当前工程 JDK 17+ → **选项 2** 最稳：`ConcurrentHashMap<deviceId, DeviceWorker>`，worker 内单线程跑队列。

### 3.2 设备状态机

```text
                    启动 / 配置变更 reset
                           │
                           ▼
                     ┌──────────┐
          ┌─────────│  READY   │◄────────────┐
          │         └────┬─────┘             │
          │  到期读/ping │                   │ 读或 ping 成功
          │              ▼                   │
          │         ┌──────────┐             │
          │         │ TRYING   │─────────────┘
          │         └────┬─────┘
          │   connect/read 失败
          │              │
          │              ▼
          │         ┌──────────┐
          │         │ OFFLINE  │  cooldownUntil = now + COOLDOWN_MS
          │         │(冷却中)  │  到期点直接标 Bad，不发起 TCP
          │         └────┬─────┘
          │              │ now >= cooldownUntil
          │              ▼
          │         ┌──────────┐
          └────────►│  READY   │  允许再试一次连接
                    └──────────┘
```

建议参数（可配置，先给默认）：

| 配置 | 默认 | 含义 |
|------|------|------|
| `modbus.device-cooldown-ms` | 3000 | 连续失败后冷却 |
| `modbus.connect-timeout-ms` | **800**（已拍板） | 单次连接上限 |
| `modbus.response-timeout-ms` | 1000～2000 | 已连接后的应答 |
| `modbus.max-fail-before-cooldown` | 1 或 2 | 连续失败几次进 OFFLINE（Flight 偏重试后再切；我们无点合并时可 1） |

**冷却期内行为：**

- 不 `BeginConnect`
- 到期 tag：`setTagValue(..., "Bad")`（与现失败路径一致）
- `reportOnline(false, "cooldown …")` 节流（状态变化才打 WARN）

**主备 failover：** 仍在 `ModbusTagIo.withLink` 内；冷却是 **设备级**（主+备都失败才进 OFFLINE）。主失败切备成功 → 保持 READY/online。

### 3.3 设备内工作循环（伪代码）

```text
loop:
  优先 drain WriteQueue（来自 ModbusTagIo.write 入队或同 gate 插队）
  if device.state == OFFLINE && now < cooldownUntil:
      skip connect; mark due tags Bad; sleep briefly; continue
  for tag in dueTags(scanPeriodMs):
      read via ModbusTagIo
      on success: setTagValue Good; clear fail count
      on fail: fail++; mark Bad; invalidate session
      if fail >= N: → OFFLINE
  if no tags: ping on poll-ms cadence (同样受 OFFLINE 约束)
```

写路径：现有 `ModbusTagIo.write` 已 `synchronized(gate(deviceId))`。改造后要求：

- **同一 device 的读任务也必须进同一 gate / 同一 worker**，禁止调度线程直接 `io.read` 绕过 worker。
- 写可：在 worker 队列头插入；或继续用 gate，但 **禁止在全局 Scheduled 线程里持锁等待连接**。

### 3.4 与 Flight 的对齐 / 刻意差异

| Flight | 本方案 |
|--------|--------|
| 一设备一原生 Thread | 每设备串行 Worker（池化） |
| 同 RefreshCycle 合并 ReadQ | **二期**再做批量 |
| ReconnectCooldown 3s | 设备 OFFLINE cooldown 可配 |
| 超时切主备 | 保留现有 `preferBackup` |
| 写队列优先 | 同设备写优先 |

---

## 4. 分期落地

### Batch 0 — 验证基线（不改代码或仅运维）

1. 停用不可达设备 / 理顺主备 IP  
2. 记一版：目标 tag 的 p50 间隔、坏设备超时日志  
3. 作为 Batch 1 对比基线

### Batch 1 — 设备隔离 + 离线冷却（**治本最小集**）

**改动面（预期）：**

- 新建 `ModbusPollDispatcher` / `ModbusDeviceWorker`（或内聚在 `ModbusPollService` 拆分）
- `ModbusPollService.@Scheduled` 只派活，不阻塞读
- `ModbusTagIo`：记录 `cooldownUntil` / `consecutiveFailures`；`connect` 前检查
- `application.yml` 增加 cooldown（及可选下调 connect-timeout 默认值——**改默认属行为变化，发布说明写清**）

**验证：**

1. `pnpm typecheck`（若有 Java compile：`server-java` 打包或 `mvn -q test/compile`）
2. 两台设备：A 可达 500ms×2 点；B 不可达有点或无点 ping  
3. A 的运行时时间戳 / Influx 间隔 p50 ≈ 500ms  
4. 写 A 上某保持寄存器仍成功；B 恢复后经 cooldown 能上线  
5. `git diff` 仅调度/会话相关文件

### Batch 2 — 批量读（性能）

- 同设备、同 `scanPeriodMs`、同 area、地址可合并区间 → 一次 FC 读出再拆到多 tag  
- 注意：合并失败策略、超长 PDU 拆包；属行为优化，需单独测

### Batch 3 — 体验（可选）

- 设备状态 API/UI 显示「冷却中至 xx:xx」  
- 不改 WS tag 报文；若加字段走设备状态通道且兼容旧前端

---

## 5. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 线程/队列泄漏（设备删除后 worker 未关） | 配置变更或 `enabled=false` 时 shutdown worker |
| 写与读死锁 | 统一「只在 worker 或只在 gate 一侧递归」；禁止 Scheduled 线程调 `write` 再等 worker |
| cooldown 过长导致恢复慢 | 可配；成功一次立即 READY |
| 下调 connect-timeout 导致慢网误判 | 默认谨慎；可用环境变量覆盖 |
| 历史点变密（500ms 真采到） | Influx 写入量上升——属预期；存盘策略另议，不在本期改测量语义 |

回滚：保留旧 `doPoll` 串行路径背后开关 `modbus.scheduler=legacy|isolated`（建议 Batch 1 带上，默认 `isolated`），出问题可切回。

---

## 6. 明确不在此方案内的「小改幻想」

单独做下面任何一项都 **不够** 称为完成：

- 只把 `connect-timeout-ms` 改小  
- 只关某个坏设备  
- 只把用户变量改成 2s 去「对齐现象」  

它们可作 Batch 0 止血，不能替代 Batch 1。

---

## 7. 已拍板决策（2026-11-10）

| # | 项 | 决定 |
|---|-----|------|
| 1 | `modbus.scheduler=legacy\|isolated` | **加**，默认 `isolated` |
| 2 | `connect-timeout-ms` 默认 | **800** |
| 3 | `device-cooldown-ms` 默认 | **3000**（3 秒：恢复不太慢，坏设备也不会每个扫描周期都去撞） |
| 4 | 同周期批量读 | **本期做** |

按 Batch 1（隔离+冷却）+ Batch 2（批量读）一起落地；不碰前端契约与 WS。
