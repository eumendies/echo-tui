## Context

当前工具审批由 `ToolApprovalContext` 投影成通用 `choice` surface，agent loop runtime 在执行 `apply_patch` 或高风险 bash 前调用审批 callback。类型层已经预留了 `allow_tool_for_session` 和 `allow_all_for_session` 决策，但 UI 没有暴露这些选项，`ToolApprovalContext` 也没有保存和复用会话级授权。

这次变更跨越 app UI、agent runtime、风险分类和文档测试，但不改变 provider 请求格式、transcript schema 或工具 executor handler。

## Goals / Non-Goals

**Goals:**

- 在 tool approval choice surface 中增加会话级 allow 选项，并把 allow 选项连续排列。
- 让 `ToolApprovalContext` 在当前 CLI 进程会话内记住 `allow all tools` 和非 bash 工具的 `allow <tool>` 授权。
- 对 `run_bash_command` 使用 `allow this command` 授权粒度，只复用完全相同 command 文本的授权。
- 保持拒绝、Esc、文本反馈、tool result continuation 和响应锁行为不变。

**Non-Goals:**

- 不做持久化授权，不写入 transcript、resume session 或用户配置。
- 不实现按 bash 风险规则、命令前缀、目录或参数模式的模糊授权。
- 不改变安全 bash 命令直接执行的风险分类规则。
- 不引入新 UI surface 或第三方 TUI 依赖。

## Decisions

### 会话级授权由 ToolApprovalContext 持有

授权缓存放在 `ToolApprovalContext` 实例中。这样授权请求、授权选择、授权记忆都在同一个 app-side approval interaction context 内闭合；agent loop runtime 仍只负责风险分类后调用 approval callback，并根据 callback 返回的结构化 decision 执行或拒绝工具。默认 CLI 每个进程创建一个 `ToolApprovalContext`，因此“this session”自然等于当前 CLI 进程生命周期。

替代方案是把缓存放在 agent loop runtime，但这会让 runtime 同时承担“是否需要询问用户”和“用户已在 app 交互层选择过什么”的状态管理；当前代码已经以 `ToolApprovalContext.request()` 作为授权交互入口，把 session grant 命中作为该入口的快速返回更贴合现有边界。另一个替代是放入 risk classifier，但 classifier 应保持无状态，只负责判断 tool call 本身是否高危。

### bash 使用 command 文本作为授权 key

`run_bash_command` 的会话级选项显示为 `Allow this command for this session`，`ToolApprovalContext` 使用解析出的 `command` 字符串作为 key。后续只有完全相同 command 文本命中缓存，其他高风险 bash 仍需审批。

替代方案是使用 tool name 授权整个 `run_bash_command`，但这会把一次 `rm -rf dist` 的授权扩张到所有高风险 bash，风险过大且不符合用户要求。另一种替代是做命令模式归一化或 AST 匹配，但这会引入 shell 语义复杂度，超出当前轻量风险分类边界。

### approval options 由 ToolApprovalContext 动态生成并可快速返回

审批选项按当前 tool call 生成：非 bash 工具显示 `Allow <toolName> for this session`，bash 显示 `Allow this command for this session`。顺序固定为所有 allow 选项在前，之后是 `Deny` 和 `Tell model what to do`。

```text
1. Allow once
2. Allow <tool/command> for this session
3. Allow all tools for this session
4. Deny
5. Tell model what to do
```

继续复用通用 `choice` surface，不新建专用 approval surface。choice renderer 保留调用方传入的 option 顺序即可满足分组展示。`ToolApprovalContext.request()` 在发现当前 call 已命中 session grant 时 SHALL 不打开 surface，直接 resolve 为允许执行的结构化 decision。

### 授权决策保持结构化

保留现有 `allow_once`、`allow_tool_for_session`、`allow_all_for_session`、`deny` 和 `provide_feedback`。为 bash command 粒度新增结构化决策，例如 `allow_command_for_session`，携带 tool name 和 command 文本。`ToolApprovalContext` 在用户选择会话级 allow 时记录对应 grant；agent loop runtime 只需要把这些 allow decision 视为允许执行，不保存 grant 状态。

## Risks / Trade-offs

- 高风险操作被用户过度放行 → 只在当前进程内生效，且 bash 默认只允许同一 command 文本，不允许整个 bash 工具。
- command 文本精确匹配导致近似命令重复审批 → 这是有意的安全取舍；如需模式级授权应另开变更。
- approval UI 选项变多占用 footer 空间 → 继续使用 choice surface 的现有换行和宽度约束，测试覆盖窄宽度渲染。
- session grant 缓存在 approval context 内，非 TUI runtime 不能自动复用 → 这是有意的 app 交互语义；非 TUI 调用方仍可通过自己的 approval callback 返回同类 allow decision。

## Migration Plan

无需数据迁移。实现后老 transcript 和 persisted sessions 不受影响；回滚代码即可恢复每次审批行为，因为没有持久化状态。

## Open Questions

- 是否需要在后续版本提供“撤销本会话授权”命令或状态展示？本次先不纳入范围。
