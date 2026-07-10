## Why

当前真实 LLM adapter 只支持 OpenAI Responses API，但部分 OpenAI 兼容服务仍主要暴露 Chat Completions API，导致用户即使拥有兼容 `/chat/completions` 的模型服务也无法接入 `echo-tui` 的真实流式对话、工具调用和上下文续传能力。

同时，现有 `src/agent` 下把 provider agent、converter 和专属工具转换文件平铺在同一目录，随着新增第二个 OpenAI 协议适配器，继续平铺会让 Responses 与 Chat Completions 的协议差异混在一起，增加维护成本。

## What Changes

- 新增 `openai-chat` agent type，通过 OpenAI SDK 的 Chat Completions streaming API 发起真实模型请求。
- 支持 Chat Completions 下的文本增量、完成状态、错误处理、abort signal、usage prompt token 捕获和工具调用聚合。
- 支持把现有 transcript 与 tool call/tool result 记录转换为 Chat Completions messages，并保持 agent loop runtime 的 provider-neutral 工具执行流程不变。
- 将 agent 目录按 provider/protocol 重组，把每个 agent 与其 transcript converter、tool converter 等专属文件放入同一个子目录。
- 保持现有 `agentType: "openai"` 作为 Responses API adapter，不改变已有用户配置语义。
- 不把 Responses-only reasoning summary、private reasoning continuation 迁移到 Chat Completions；`openai-chat` 第一版不支持这些能力。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- `streaming-llm-service-adapter`: 增加 OpenAI Chat Completions adapter 的配置、请求、stream 处理和工具调用续传要求。
- `typescript-build-test-pipeline`: 更新 agent 源码模块路径要求，反映按 agent/protocol 子目录组织的 TypeScript 源码结构。

## Impact

- 影响 `src/types/agent.ts`、`src/config/llm-config.ts`、`src/agent/agent-setup.ts` 和 agent adapter 相关模块。
- 新增 `src/agent/openai-chat/`，重组现有 `src/agent/openai-*` 与 `src/agent/fake-agent.ts` 到协议/agent 子目录。
- 需要更新 agent、config、app/runtime 相关测试中的 import 路径与新增 Chat Completions adapter 覆盖。
- 不新增第三方依赖；继续使用现有 OpenAI SDK、TypeScript/CommonJS build 管线和 Node 内置 test runner。
