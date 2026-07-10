## Context

当前 agent loop 在每次请求前构造 transient provider records，并按 interaction mode 选择 tool registry。normal mode 使用默认内置工具并合并 MCP tools；plan mode 使用只读 registry，且内置 system prompt 中额外插入 plan mode section。

这带来两个缓存不稳定来源：第一，system prompt 在 normal/plan 间不再共享同一字节前缀；第二，provider request 的 tools schema 在 normal/plan 间不同。对于支持 prompt caching 的 provider，这会让用户仅切换 mode 就失去大量可复用上下文。

## Goals / Non-Goals

**Goals:**

- 保持同一 cwd、AGENTS.md、skill catalog 和 MCP 状态下的 provider system prompt 尽量稳定。
- 保持 normal/plan mode 的 provider-visible tool definitions 一致，避免 mode 切换改写 tools schema。
- 继续保证 plan mode 不能修改文件、执行非只读命令或调用 MCP tools。
- 保持 `/mode plan` 和 Tab mode cycle 的用户可见交互语义不变。

**Non-Goals:**

- 不改变 normal mode 的工具审批策略。
- 不为 plan mode 引入新的用户可见 slash command 或持久 transcript record。
- 不优化 AGENTS.md、skill catalog、MCP schema 自身变更导致的缓存失效。
- 不实现 provider 专用 prompt cache 控制参数或缓存指标展示。

## Decisions

### 1. plan mode 约束改为 transient user record

agent loop 构造 provider records 时，内置 system prompt 不再根据 interaction mode 拼接 plan section。若当前 mode 为 plan，则在稳定前缀和活跃 transcript records 之后追加一条 transient `user` record，说明当前是只读规划阶段、禁止执行修改，并提示退出 plan mode 的方式。

理由：
- system prompt、摘要和既有 transcript 是最值得缓存复用的前缀，应避免因 mode 切换改变。
- transient user record 不写入 app transcript/session，不污染历史。
- 追加在 provider records 末尾可以让 normal 请求成为 plan 请求的完整前缀，mode 切换时只追加 plan 约束。

替代方案：继续在 system prompt 注入 plan section。该方案权限语义强，但会让 system prompt 在 mode 切换时分叉，正是本次要修复的问题。

### 2. plan mode 使用默认 provider-visible tool registry

agent loop 初始化 provider agent 时，不再为 plan mode 创建 provider-visible 只读 registry。normal 和 plan 都使用同一套默认内置工具，并在存在 MCP manager 时合并成功初始化的 MCP tools。这样 provider adapter 转换出的 OpenAI Responses、OpenAI Chat 和 Anthropic tools schema 在 mode 切换时保持一致。

理由：
- tools schema 通常进入 provider request body；切换 registry 会导致缓存硬失效。
- 隐藏工具不是安全边界，真正的安全边界应在执行前 classifier 和 executor 之前。

替代方案：保留只读 registry，但把 plan tools schema 缓存起来。该方案只能稳定 plan 内部请求，不能解决 normal/plan 切换时 schema 不同的问题。

### 3. plan mode 安全边界集中到执行前风险分类

plan mode 下，风险分类在普通 executor 之前拒绝所有不允许的 tool call：

- `run_bash_command` 只允许既有 readonly inspection allowlist。
- `apply_patch` 等写入型内置工具直接返回 rejected，不进入 approval surface，也不执行。
- `ask_user_questions`、`glob`、`grep`、`read_files`、`use_skill`、`web_fetch`、`web_search` 等观察或交互工具可按既有语义执行。
- MCP tools 在 plan mode 下直接 rejected，不调用 MCP server。

理由：
- provider-visible schema 稳定不等于执行权限放宽。
- 拒绝结果作为 tool result 回传，可以让 continuation 完整，并告知模型需要退出 plan mode。

替代方案：让写入工具进入 approval surface。该方案会给用户一种 plan mode 可通过授权执行修改的暗示，违反只读规划语义。

### 4. context usage 分类跟随请求形态更新

plan transient instruction 从 system 移到 user 后，context usage breakdown 中 plan instruction 应归类为 messages，而不是 system。tools segment 在 normal/plan 之间应基于同一份 tool definitions 估算。

理由：
- `/context` 面板应反映真实 provider request 结构。
- 优化缓存时，稳定 system/tools 与可变 messages 的分界需要可观测。

## Risks / Trade-offs

- [模型看到写入工具后仍尝试调用] → 执行前 classifier 必须返回明确 rejected tool result，并覆盖 `apply_patch`、非只读 bash 和 MCP tools。
- [plan instruction 从 system 降级为 user 后约束力度下降] → 内置 system prompt 保留“遵守当前 interaction mode/tool safety policy”的高层规则，具体 plan 约束作为 provider records 的最后一条 transient user instruction 提供。
- [MCP tool schema 暴露可能诱导模型调用 MCP] → plan mode 下 MCP 调用统一 rejected，且拒绝文本明确说明 MCP tools 在 plan mode 不可执行。
- [测试对 readonly registry 有旧断言] → 更新测试以断言 provider-visible definitions 稳定，同时断言执行策略仍拒绝写入。

## Migration Plan

1. 调整 provider records 构造：移除 system prompt 中的 plan section，在 provider records 末尾追加 plan transient user record。
2. 调整 agent loop registry 选择：plan mode 与 normal mode 使用同一 provider-visible registry。
3. 扩展 tool risk classifier：plan mode 下拒绝写入型内置工具和 MCP tools，保留只读 bash allowlist。
4. 更新 provider request、tool risk、MCP 和 context usage tests。
5. 手动验证 `/mode normal` 与 `/mode plan` 的工具 schema 稳定性，以及 plan mode 下写入工具返回 rejected。

Rollback 策略：若发现 provider 遵循 plan 约束明显退化，可临时恢复 system prompt 注入；tool 执行层拒绝逻辑应保留，因为它是实际安全边界。

## Open Questions

- 是否需要在 `/context` 或调试日志中显示 system/tools/messages 的缓存稳定性提示？本变更不实现，只保留后续空间。
