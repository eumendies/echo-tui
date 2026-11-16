## Context

`ToolApprovalContext` 是工具审批的唯一状态持有者，内部有三个字段：

- `allowAllForSession: boolean`：由 `Allow all tools for this session` 选项或 `Shift+Tab` 打开；
- `allowedToolsForSession: Set<string>`：非 bash 工具的完整名称；
- `allowedBashCommandsForSession: Set<string>`：bash 命令的精确文本。

`getCachedDecision()` 在 `createToolApprovalResolver` 中被优先调用，命中即返回同步决策，既不请求 auto 审批模型也不打开人工 surface。这三个字段目前只存在于进程内存，进程退出即丢失。

仓库已有的同类持久化机制是 `session-model-settings-store.ts`：把 model/effort 写入 `<sessionId>.settings.json`，路径从 `TranscriptStore.getSessionFilePath()` 派生，用「临时文件 + rename」做原子替换，读取失败按 `missing`/`invalid` 分类而不抛错。本次沿用同一形态，避免引入第二种持久化范式。

会话生命周期（加载、分叉、清空、删除）已经在 `AppContext` 收拢为四个方法，`modelContext.restoreSession()` 就是挂在同一位置的先例。

## Goals / Non-Goals

**Goals:**

- 会话级授权跨进程存活：重启后 `/resume` 同一个会话，已批准的工具与 bash 命令继续免审批。
- 授权随会话走，不随项目或机器走：不新增跨项目共享的授权面。
- 读取失败时安全降级到「需要审批」，绝不降级到「全部放行」。
- 保持现有 UI 语义与选项文案不变。

**Non-Goals:**

- 不实现项目级或全局授权白名单。
- 不新增 `/approvals` 管理面板，也不提供 TTL / 过期机制。
- 不改变 `~/.echo/config.json` 的 `tools.approval` 节点语义。
- 不改变 headless `echo-tui --once` 的 deny / `--full-access` 策略。
- 不改变工具审批优先级（会话缓存 → auto 审批模型 → 人工 surface）。
- 不修改 transcript journal 的 schema。

## Decisions

### 决策 1：持久化到 session sidecar，而不是 journal 或用户配置

选 sidecar（`sessions/<sessionId>.approvals.json`）而非另外两者：

- **不写 journal**：journal 是 append-only 的语义历史，撤销一条授权需要追加反向操作并重放，代价与语义都不对；授权是可变状态，不是历史事实。
- **不写 `~/.echo/config.json`**：该文件是用户手写、可能被同步与备份的配置，写入运行时状态会污染它，也会让「一次误按」升级成跨项目永久授权。
- **不写项目级文件**：项目级会让同一目录下的所有新会话继承历史授权，与用户选定的「新会话 = 新安全边界」语义冲突。

sidecar 与 journal 同目录、同 `sessionId` 标识，天然具备「会话存在则授权存在、会话删除则授权删除」的生命周期。

### 决策 2：内存仍是唯一事实来源，sidecar 只做镜像

`ToolApprovalContext` 的三个字段继续作为运行时判断依据，`getCachedDecision()` 不读盘。sidecar 在会话级 allow 决策发生后同步写入。

这样做的原因：审批发生在 assistant turn 的工具执行路径上，任何一次磁盘读都会引入延迟与失败模式；而授权只会被本进程写入，内存值在会话内始终最新。

### 决策 3：写盘时机的两个必须点

- 用户选中 `allow_tool_for_session` / `allow_command_for_session` / `allow_all_for_session` 后写入。
- `toggleAllowAllForSession()` 的**两个方向**都写入。关闭时省略写盘会让重启后的 `TOOLS all` 复活，这是比「漏存」更危险的方向错误。

写盘失败不抛出到 turn：保留内存授权（本次会话仍然生效），通过既有 `onUpdate` 通道给出一条可见提示。副作用是本次会话的授权不会跨进程存活，属于可接受的降级。

### 决策 4：四个生命周期挂接点全部放在 `AppContext`

| 事件 | 动作 | 理由 |
| --- | --- | --- |
| `loadTranscriptSession(id)` 成功 | 从该 session 的 sidecar 恢复三个字段 | `/resume` 是授权回归的主路径 |
| `forkTranscriptSession()` 成功 | 把当前授权写入新 `sessionId` | fork 是当前对话的延续，用户视角上安全上下文不变 |
| `/clear` → `clearRecords()` | 清空内存三个字段 | 新会话是新安全边界 |
| `deleteTranscriptSession(id)` | 尽力删除对应 sidecar | 与既有 `.settings.json` 清理同一位置、同一失败语义 |

`AppContext` 已经是这四个动作的唯一协调点，`modelContext.restoreSession()` / `rebindCurrentSelectionToSession()` 就是现成的同构先例，不需要在三个 command handler 里各挂一次钩子。

### 决策 5：失败与身份校验一律 fail-closed

`read()` 返回 `{kind: 'found' | 'missing' | 'invalid'}`。以下情况归为 `invalid`（等价于空集合）：

- JSON 解析失败；
- 根节点不是对象；
- `schemaVersion` 不是 1；
- `sessionId` 与请求不一致；
- `tools` / `bashCommands` 不是数组；
- `allowAll` 不是布尔值。

授权文件是安全边界的输入，任何"尽量读出来"的容错都会把损坏放大成放行。

但**单个脏条目**（数组里出现空白字符串或非字符串）只丢弃该项，不作废整个文件。理由是方向性：丢弃条目只会减少授权，最坏情况是重新审批一次；而作废整个文件会让用户此前批准的其余条目一起失效。真正危险的只有"把无效数据解释成放行"，它由上面那份结构化清单守住。

`updatedAt` 只是诊断元数据，不参与判定：它没有任何消费方，缺字段却让全部授权失效属于过度防御。

### 决策 6：空集合不落盘

三个集合为空且 `allowAll === false` 时执行 `remove` 而不是写一个空文件。避免大量 `{}` 形态的 sidecar 污染项目 sessions 目录，也让"删掉文件"和"撤销全部授权"成为同一个动作。

### 决策 7：独立 sidecar 文件，不复用 `.settings.json`

分成 `<sessionId>.settings.json` 与 `<sessionId>.approvals.json` 两个文件：

- 损坏隔离：model 设置损坏不应连带清空授权，反之亦然；
- 关注点分离：一个由 `/model` 写，一个由审批决策写，写入频率与触发者不同；
- 权限可以不同：授权文件用 `0o600`，比 settings 更严格。

### 决策 8：选项文案保持不变

`Allow this command for this session` 在新语义下更准确：它现在真的覆盖整个会话生命周期。新增「always」选项会扩大误操作面，也与用户"不需要加选项"的决定冲突。

## Risks / Trade-offs

- **误点会话级 allow 后永久生效** → 缓解：作用域仍限于单个会话，`/clear` 立即清空，用户可直接删除 sidecar 文件；`Allow once` 与 `Deny` 路径完全不变。
- **`allowAll` 持久化放大影响面** → 缓解：状态栏 `TOOLS all` 在恢复后立即常驻可见，安全边界变化不会被静默隐藏；`Shift+Tab` 关闭时同步写盘。
- **bash 命令精确文本永久有效** → 缓解：只在会话内存活，不跨会话累积；这已是当前内存缓存的行为，本次只延长其生命周期到会话结束。
- **同一 session 被两个进程同时写入** → 缓解：原子 rename 保证不出现半写入 JSON，最后写入者胜；同 session 并发写 journal 本身也不是受支持场景，不额外引入锁。
- **sidecar 遗留垃圾文件** → 缓解：删除会话时清理；读取失败 fail-closed，不会因为遗留文件产生授权。
- **旧版本回退** → 旧版本不读 `*.approvals.json`，无副作用；新版本读到旧版本留下的缺失文件即为空集合。

## Migration Plan

无需数据迁移。既有 session 没有 sidecar，读取得到 `missing`，等价于空集合，行为与本次改动前完全一致。首次触发会话级 allow 时才创建文件。

回退方式：删除 `src/persistence/session-approvals-store.ts` 及其挂接即可，磁盘上残留的 sidecar 不会被任何旧路径读取，可手动清理。

## Open Questions

- 是否需要 `/approvals` 只读查看入口用于审计当前会话的有效授权？本次不做，属于后续增量。
- 是否需要 TTL 或授权次数上限？本次明确不做，按用户决定保持"直到手动撤销"。
