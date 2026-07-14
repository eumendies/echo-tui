## Context

当前 Echo TUI 的长期上下文来自 AGENTS.md、启用的 skills 和持久化 transcript，但没有让用户在会话间显式维护个人偏好或事实的机制。真实 provider 请求由 agent loop 在运行时构造；内置 system prompt 和运行时记录均不会写回 transcript。slash command 使用 `CommandHost` 受控 facade、command session 和 footer surface 实现交互式管理，`/hooks` 已覆盖列表、详情、编辑与删除确认的状态机模式。

本变更新增用户全局的显式 memory。它必须在所有工作目录和恢复会话中稳定携带，同时不能被 transcript 持久化、压缩或 `/resume` 重复记录。项目约束为 Node.js 内置能力、JSON 文件、ANSI TUI 和 Node 内置测试，不引入第三方依赖。

## Goals / Non-Goals

**Goals:**
- 让用户通过 `/memory` 浏览、新增、编辑和删除全局 memory，并在每次确认操作后可靠持久化。
- 将全部有效 memory 作为每轮真实 provider 请求的 transient context 注入，不改变 transcript 或 session 数据。
- 让 `/context` 反映 memory 的实际上下文成本。
- 保持 command handler 仅通过 `CommandHost` 调用 memory 领域能力。

**Non-Goals:**
- 不支持模型自动提取、自动更新、语义检索、token 预算裁剪、项目级 memory、同步或云端存储。
- 支持用户显式启停单条 memory；仅启用条目注入 provider context。
- 不把 memory 作为 tool、skill、AGENTS.md 或 transcript record。
- 不提供 memory 的加密、秘密管理或跨进程并发合并。

## Decisions

### 独立的用户级版本化 JSON 文件

存储位置固定为 `~/.echo/memories.json`，根对象使用 `{version: 1, memories: [...]}`，每项包含稳定 `id`、非空 `content`、`createdAt` 和 `updatedAt`。读取时将缺失文件视为空集合，拒绝无效 JSON、非对象根节点或无效条目；写入使用同目录临时文件后 rename，避免中断时留下半写文件。

选择独立文件而不是 `config.json`，因为 memory 是用户内容而非运行配置，手工检查和迁移更直观，也避免 `/memory` 写回无关 LLM/MCP 配置。选择版本化对象而不是裸数组，为将来的元数据演进预留兼容空间。第一版不支持项目级文件：AGENTS.md 已承担项目指令，双层 memory 会引入覆盖、显示和管理范围问题。

### 每轮读取并注入 transient system context

agent loop 在构造 provider records 时读取当前 memory 快照，并将格式化后的 `User-managed memories` 区块传给 built-in system prompt。该区块仅在 provider request 中存在，不追加到 app transcript、持久化 session 或 compaction 输入。格式化文本明确说明 memory 为用户提供的持久背景，不得高于内置系统约束或当前用户请求。

每轮重新读取而不是在 app 启动时缓存，确保 `/memory` 保存后下一次请求生效，也允许用户手工编辑 JSON 后生效。选择 system prompt 区块而不是末尾 runtime user record，以获得固定、可预测的前缀顺序，并避免 memory 在最近用户消息之后产生不必要的时序竞争。

### 专用 memory command surface 和即时保存

新增 `memory` surface，命令状态为 `list`、`edit` 和 `deleteConfirm`。列表提供选中条目的截断预览；`a` 新增、Enter 或 `e` 编辑、`d` 进入删除确认、Esc 返回或关闭。编辑 surface 维护本地草稿，支持普通文本编辑、退格、光标移动和 `Ctrl+J` 换行；Enter 校验非空后立即保存，Esc 丢弃草稿。删除必须经过确认并立即保存。

选择专用 surface 而不是通用 `select`，因为需要多行编辑、明确删除确认、启停开关和条目预览。编辑时保留列表并在同一张卡片内原地展开输入区，避免新增或编辑进入二级页面。选择每次确认即时保存而不是整页批量保存，降低退出时未保存状态和外部文件修改冲突的复杂度；写入失败时保持 surface 与草稿，并显示可读错误。

### 将 memory 作为独立 context usage 分类

扩展 `ContextUsageSegmentCategory` 为 `memory`，在固定顺序中置于 system 之后。usage 估算从 memory 格式化区块的 token 数中拆分 memory，其余 built-in system prompt 仍归入 system，skills 保持独立分类。校准逻辑继续按全部 segment 比例映射到 provider 返回的 `usageInputTokens`，因此总量不变。

独立展示比归入 system 更能解释用户显式添加内容的成本。采用 format 函数同时提供 prompt 文本和可估算内容，避免通过字符串搜索猜测 memory 边界。

## Risks / Trade-offs

- [memory 内容包含错误、过时或指令性文字] → 在 prompt 中标明其优先级和用途；用户可以通过 `/memory` 立即编辑或删除。
- [memory 可能含敏感信息并随请求发送给 provider] → 在管理 surface 与文档中明确 memory 会随每次真实 provider 请求发送；第一版不承诺加密或秘密隔离。
- [手工修改导致 JSON 损坏] → 读取和保存拒绝覆盖无效文件，并将诊断展示给用户。
- [大量 memory 增加上下文成本] → `/context` 单独展示 memory 占用；第一版由用户自行管理数量和内容，不静默裁剪。
- [多个进程同时编辑时最后一次写入覆盖前一次] → 使用原子单文件替换避免半写，但不实现锁或合并；并发协调属于后续范围。

## Migration Plan

1. 发布后不创建空文件；首次新增 memory 时创建 `~/.echo/memories.json` 及父目录。
2. 旧用户没有该文件时得到空列表，所有既有聊天、session 和配置行为保持不变。
3. 若需回滚，停止读取该文件并移除命令即可；文件可保留，未来重新启用时继续可读，不影响现有配置。

## Open Questions

- 无。第一版固定为全局用户级 memory、所有条目始终注入，并采用即时保存语义。
