## Why

`apply_patch` 会直接写入本地文件，目前模型发起该工具调用后会立即执行，用户缺少在写盘前审阅和拒绝的机会。第一版需要在执行 `apply_patch` 前加入用户授权拦截，降低误改文件的风险，并为后续更完整的工具权限策略打基础。

## What Changes

- 在 agent tool call loop 中对 `apply_patch` 增加执行前授权流程。
- TUI 在拦截到 `apply_patch` 时显示 select 式授权面板，而不是二元 confirm 面板。
- 第一版提供 `Allow once` 和 `Deny` 两个选项；选择允许后执行本次工具调用，选择拒绝或按 Esc 后不执行工具。
- 拒绝执行时生成可回传模型的失败 tool result，使模型可以继续响应并理解用户未授权该次工具调用。
- 授权面板的内部决策模型预留后续扩展，例如本会话允许某类工具、本会话允许所有工具、输入反馈告诉模型应该怎么做。
- 不改变 `apply_patch` handler 的 patch 解析、校验、写盘语义；授权拦截发生在工具执行边界之前。

## Capabilities

### New Capabilities
- `tool-approval`: 定义本地工具执行前的用户授权拦截、授权决策和拒绝结果语义。

### Modified Capabilities
- `terminal-tui-prototype`: 增加 agent 工具授权面板的 TUI 交互行为和输入事件优先级要求。
- `streaming-llm-service-adapter`: 调整 agent loop runtime 的工具调用契约，要求 `apply_patch` 执行前先请求 app 层授权。

## Impact

- 影响 `src/agent/agent-loop-runtime.ts` 和 `src/types/agent.ts` 的 agent callback / tool loop 协议。
- 影响 `src/app/main.ts`、`AppContext` 或新增 app context，用于管理工具授权 modal、输入事件和渲染 surface。
- 影响 TUI footer 渲染路径，但优先复用现有 select surface 渲染结构。
- 影响工具调用相关单元测试和 app 行为测试。
- 不新增运行时第三方依赖，不改变 OpenAI provider adapter 的工具转换边界。
