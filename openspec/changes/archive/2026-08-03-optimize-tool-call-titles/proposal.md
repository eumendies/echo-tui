## Why

当前 tool call 标题混用了 PascalCase、snake_case、自然语言和函数调用语法，例如 `AskUserQuestions(2)`、`read_files(path)` 与 `Web search · query`。这种不一致会让终端界面暴露协议层命名细节，也使已经自然语言化的标题继续携带小括号参数显得突兀。

## What Changes

- 将内置工具的可见标题统一为 sentence case，例如 `Ask user questions`、`Read files`、`Apply patch`。
- 使用 `·` 分隔工具标题、参数摘要和状态，移除自然语言标题后的函数调用小括号形式。
- 为通用 fallback 和 MCP tool call 定义一致的标题规范，在保留工具身份与必要参数事实的同时避免直接暴露 snake_case 或驼峰命名。
- 保持 transcript 中的原始 `toolName`、`argumentsText`、tool result、provider continuation 和持久化内容不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tool-message-rendering`: 统一 tool call 可见标题的 sentence case、参数摘要分隔和通用/MCP fallback 展示要求。

## Impact

- 主要影响 `src/render/tool-message-renderer.ts`、`src/render/tool-message-renderers/` 下的专属 renderer 及共享标题格式化逻辑。
- 需要更新 transcript 与 footer pending tool call 相关渲染测试。
- 不修改工具定义、工具执行协议、审批风险分类、transcript schema、provider adapter 或 session 持久化格式。
