## Why

后续接入 tool call 前，TUI 需要先能把工具调用与工具结果作为独立 transcript 消息识别并显示出来，避免把工具过程伪装成普通 assistant 文本或在重绘时丢失可见信息。

## What Changes

- 在 TUI transcript 渲染层识别 `tool_call` 与 `tool_result` 消息角色。
- 为工具调用和工具结果提供可见投影，使用与 assistant 消息一致的 `◆ ` 前缀和缩进规则。
- 工具消息应参与已有 transcript snapshot 重绘、resize recovery 和 session 恢复后的显示。
- 暂不实现真实 tool 执行、OpenAI tool call 事件解析、tool result 回传模型或 provider input 映射。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `terminal-tui-prototype`: 扩展 transcript 可见角色要求，使 TUI 能显示 `tool_call` 与 `tool_result` 记录。

## Impact

- 影响 transcript record role 类型定义与 TUI record block 分发逻辑。
- 影响 render block/line 级函数和相关测试。
- 不新增运行时依赖，不改变 agent 请求流程，不改变 tool 执行能力。
