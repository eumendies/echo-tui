## Context

当前用户级 `~/.echo/config.json` 同时承担 model/provider 目录、全局默认选择和交互过程中当前选择三种职责。`ModelContext.selectModel()` 会改写 `llm.selectedModel`，`selectEffort()` 会改写当前 model profile 的 `reasoning.effort`；任一 TUI 实例完成选择后，其他实例会经配置读取或 watcher 观察到同一变化。

运行时已经支持通过 `AgentSessionInput.modelProfileId` 和 `reasoningEffortOverride` 为单次 agent run 选择完整 profile，因此 provider adapter 无需改变。现有 transcript 持久化按 cwd 分区、每个 session 使用一个 append-only JSONL journal，并在首次 transcript record 提交时才创建 session id。journal 还保存 compaction、todo 和 change history，但本变更明确把 model/effort 视为只需要当前值的 session 配置，而不是需要保留历史的会话事件。

## Goals / Non-Goals

**Goals:**

- 让每个交互式 session 独立持有当前 model profile 和可选 reasoning effort override，避免 `/model`、`/effort` 或 composer tuning 影响其他 session。
- 保留用户级 model/provider 配置作为目录和新 session 的全局默认来源。
- 让持久化 session 在 `/resume` 后恢复当前 model/effort，同时不改变 transcript journal schema。
- 复用既有 per-run override seam，并保持显式 skill override 高于 session settings。
- 保持普通 footer redraw 只读内存缓存，不在渲染热路径访问配置文件或 sidecar。

**Non-Goals:**

- 不增加项目级 model、effort 或其他设置。
- 不把 provider、API key、headers 或完整 model profile 复制到 session。
- 不记录 model/effort 的切换历史，不让这些设置参与 transcript、provider context、compaction 或 undo。
- 不改变 `--once` 的全局配置与显式 per-run override 规则。
- 不改变 `/config` 对 provider、model profile 和全局默认值的管理职责。

## Decisions

### 1. 使用独立 settings sidecar 保存当前值

每个已持久化 session 在既有 journal 旁使用 `{session-id}.settings.json`：

```json
{
  "schemaVersion": 1,
  "sessionId": "2026-...",
  "modelProfileId": "codex-gpt",
  "reasoningEffortOverride": "high",
  "updatedAt": "2026-..."
}
```

`reasoningEffortOverride` 可省略，表示使用该 model profile 当前配置的默认 effort。store 使用临时文件加 rename 原子覆盖，因此磁盘只保留当前 settings。文件不包含凭据或完整 profile。

选择 sidecar 而不是 journal operation，是因为 model/effort 没有可观察的历史、无需与 transcript 操作一起 replay，也不参与 undo。选择 sidecar 而不是重写 journal 首行，是为了保持 journal append-only、避免每次选择都复制完整 transcript，并保留现有 journal schema。

### 2. 新 session 从全局默认初始化，sidecar 只优化恢复

`ModelContext` 初始化新 session 时解析 `llm.selectedModel`；如果该 id 缺失或无效，沿用现有首个有效 profile 回退。当前进程始终以 `ModelContext` 内存选择作为请求和 status line 的唯一来源；sidecar 仅在成功时让该选择可跨 `/resume` 恢复，绝不成为 provider 请求前提。

Session 不复制 profile 定义。相同 profile id 的 provider、model、context window 或默认 reasoning 配置在用户级配置中被编辑后，后续 turn 仍读取最新定义。显式 session effort override 则继续覆盖 profile 默认值。

### 3. journal 创建后尽力同步 settings

首次 user record 正常创建 journal，journal 自行生成真实 session id；随后 `ModelContext` 按该 id 尝试原子写入 settings sidecar。写入失败时 user record、journal、status line 和 provider 请求照常继续；下次普通提交或显式 model/effort 选择会再次尝试同步。

sidecar 与 journal 不构成跨文件事务。恢复时缺少或无效 sidecar 直接回退全局默认，用户只通过 status line 看到当前实际请求会使用的 model/effort，不暴露 sidecar 同步状态。

### 4. ModelContext 持有 session 选择和解析后的展示缓存

`ModelContext` 持有当前 session 的 `modelProfileId`、可选 `reasoningEffortOverride`、model catalog 摘要和 status line 展示状态。`/model`、`/effort` 和 composer tuning 先校验候选，再立即更新内存缓存和 status line，最后尽力同步 sidecar；同步失败不会撤销选择或显示存储错误。

`/config` 保存后刷新 model catalog 和 profile 展示信息，但只要当前 session profile 仍有效，就不采用新 `llm.selectedModel` 替换它。当前 profile 被删除时回退最新全局默认 profile、清除旧 effort override并清空 context usage；后续同步机会会尽力覆盖 sidecar。

### 5. model 与 effort 使用独立但明确的切换语义

- `/model` 选择另一个 profile 时更新当前 session model，并清除旧 `reasoningEffortOverride`，使新 profile 使用自己的默认 effort。
- `/effort` 只写当前 session 的显式 override，不修改 model profile。
- Composer tuning 同时确认 model 和明确 effort，因此一次原子 sidecar 覆盖同时保存两者。
- `none` 是有效显式 override，合并时使用 `undefined` 判断而不是 truthy 判断。

所有成功的 model 或 effort 生效操作都清空旧 context usage；sidecar 写入失败不影响缓存或调节确认。

### 6. Agent run 在 app 边界合并 session 与 turn override

普通 turn 从 session settings 向 `AgentSessionInput` 提供 model/effort。显式 skill invocation 的非空 model/effort override 在 app/runner 边界覆盖对应 session 值；skill 未提供某字段时保留该字段的 session 值，不能由显式 `undefined` 覆盖。合并后的值在一次 agent loop 及其 tool continuation 中保持不变。

Status line 默认展示 session 生效值；skill turn 活跃期间继续展示既有 `SKILL override` 临时状态，结束后恢复 session 状态。

### 7. 恢复、清空和兼容读取

`/resume` 在 journal 加载成功后读取匹配 session id 的 sidecar。sidecar 缺失、损坏、schema 不支持、sessionId 不匹配或引用已删除 profile时，按旧 session 处理并从当前全局默认初始化；后续提交会静默尝试生成或更新 settings。

`/clear` 解绑 journal 与 sidecar，并从最新全局默认初始化新的内存 session。旧 session 文件保持不变。`/resume` 列表、会话引用和 transcript source path 仍由 `.jsonl` journal 派生，不列出孤立 sidecar。

## Risks / Trade-offs

- [journal 与 sidecar 不是跨文件原子事务] → journal 是会话唯一事实，sidecar 是 best-effort 恢复优化；枚举只认有效 journal，允许无害孤立或缺失 sidecar。
- [旧 session 或损坏 sidecar 无法恢复原模型] → 明确回退当前全局默认；不猜测 transcript 历史使用过的模型，也不阻断请求。
- [删除当前 profile 会改变 session] → 统一回退有效全局默认并清除不再适用的 effort override和 context usage。
- [同一 session 被两个进程同时恢复并修改] → sidecar 原子覆盖避免半写文件，但采用最后一次成功写入获胜；现有 transcript journal 同样不支持多进程协同编辑同一 session，本变更不扩大该保证。
- [额外小文件增加清理负担] → settings 与 journal 使用相同 session id 和目录；枚举忽略孤立 sidecar，后续可独立增加清理但不纳入本变更。

## Migration Plan

1. 新增兼容读取的 settings store 和 session settings 类型，不修改现有 journal parser。
2. 将新 session 初始化、journal 创建后的 best-effort 同步、resume 和 clear 接入 settings 生命周期。
3. 将 `/model`、`/effort`、composer tuning 和 agent run 参数改为 session 语义。
4. 保留 `llm.selectedModel` 与 profile effort 的读取和 `/config` 保存能力，作为全局默认和目录定义。
5. 旧 session 无需批量迁移；首次恢复后按全局默认运行，并在后续正常提交时尽力生成 sidecar。

回滚时可停止读取和写入 `*.settings.json`，旧版本仍只枚举 `.jsonl` journal；sidecar 会成为可忽略文件，不影响 transcript 恢复。

## Open Questions

- 暂无。当前范围固定为全局默认加 session model/effort，不包含项目级或其他配置。
