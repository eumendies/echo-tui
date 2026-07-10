## Why

真实 agent 目前没有稳定的系统提示词，模型行为完全依赖用户输入和历史 transcript，缺少固定的产品身份、工具使用边界和终端交互约束。需要添加一个内置 system prompt，让默认真实 agent 在每次请求中获得一致行为指导，同时避免用户配置覆盖导致核心运行策略漂移。

## What Changes

- 新增一个源码内置的 system prompt，描述 Echo TUI agent 的身份、回答风格、工具使用和终端交互约束。
- agent loop runtime 在每次真实 `RunAgent(records, callbacks)` 调用中，把该 prompt 作为 transient `system` transcript record 注入 provider 上下文。
- 注入的 system record 不进入 app 传入的 transcript ledger，不持久化到 session，也不通过 app callbacks 渲染或追加。
- system prompt 不从 `~/.echo/config.json`、模型 profile、slash 命令或环境变量读取；用户不能覆盖或关闭。
- OpenAI provider adapter 继续只负责 provider 边界转换，复用现有 `system` record 到 OpenAI input 的转换能力。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `streaming-llm-service-adapter`: 真实 agent 请求需要自动携带内置、不可用户覆盖的 system prompt，且该 prompt 只作为运行时 provider 上下文存在。

## Impact

- 影响 `src/agent/agent-loop-runtime.ts` 的 provider records 构造逻辑。
- 可能新增 `src/agent/system-prompt.ts` 或等价模块承载内置 prompt 文本。
- 影响 agent runtime 与 OpenAI provider agent 相关单元测试。
- 不改变 `RunAgent(records, callbacks)`、`TranscriptRecord[]` app 边界、transcript persistence schema、`/resume` 行为或用户配置 schema。
