## Why

当前真实 OpenAI agent 同时负责 OpenAI Responses 协议适配、配置与工具运行时加载，以及 function tool call loop 编排。随着后续需要接入不同厂商或不同 API 形态的大模型，继续把 tool loop 固定在 `openai-agent.ts` 会导致每个 provider 重复实现相同循环逻辑，也会让 OpenAI provider 边界越来越臃肿。

本次变更只提取现有 tool loop 编排层，不重新设计消息模型或 app 主流程。目标是在保持 `RunAgent(records, callbacks)` 对外契约不变的前提下，让底层 provider agent 只负责一次模型 turn，通用 agent loop runtime 负责工具调用、工具结果回注和 continuation 循环。

## What Changes

- 新增 agent loop runtime，承接当前 `openai-agent.ts` 中的 tool-call loop、assistant segment 回调、tool_call/tool_result record 构造与 continuation records 维护。
- agent loop runtime 继续拥有默认真实运行时加载职责：读取 LLM 配置、创建默认 tool registry、创建 tool executor，并接收一个底层 provider agent 作为依赖。
- 收窄 OpenAI agent 职责：OpenAI agent 只负责 OpenAI client 创建、`TranscriptRecord[]` 到 OpenAI Responses input 的转换、OpenAI tools schema 投影、stream 事件解析、错误归一化，并返回单次 turn 的 assistant draft 与 provider-neutral tool calls。
- `main.ts` 默认真实路径只新增一层 runtime 包装，例如把底层 OpenAI agent 传入 agent loop runtime；`main.ts` 不直接创建 tool registry 或 tool executor。
- 保持 `TranscriptRecord[]` 作为 agent loop runtime 与 provider agent 之间的上下文边界，不新增 runtime message / provider-neutral message 中间模型。
- 保持 fake/stub `RunAgent` 注入路径可用；测试中直接注入 `runAgent` 的 app 行为不受默认真实 runtime 拆分影响。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `streaming-llm-service-adapter`: 明确真实 agent 由 agent loop runtime 编排 tool-call loop，底层 provider agent 执行单次流式模型 turn；保持现有回调、transcript 和 OpenAI 行为契约不变。

## Impact

- 主要影响 `src/agent/openai-agent.ts`、新增的 agent loop runtime 模块、`src/types/agent.ts` 中底层 provider agent 相关类型，以及默认真实启动路径 `src/app/main.ts`。
- 现有 `src/tools/*`、`src/agent/openai-transcript-converter.ts`、`src/agent/openai-tool-converter.ts` 应继续复用；不引入新运行时消息格式。
- 需要迁移并扩展 agent 测试，覆盖通用 loop runtime 的 tool-call continuation、OpenAI 单次 turn、默认真实装配路径和现有错误脱敏语义。
