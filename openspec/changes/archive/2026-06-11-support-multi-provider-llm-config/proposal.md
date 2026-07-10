## Why

当前 LLM 配置通过 `llm.models[]` profile 同时承载模型选择与 provider 连接信息，虽然可以在单个 profile 上覆盖 `apiKey` / `baseURL`，但多 provider、多 endpoint、多模型组合时会出现凭据重复、继承语义不清和配置维护成本高的问题。

将 provider 连接信息与 model profile 分层，可以让同一 provider 下的多个模型共享配置，也让跨 provider 切换保持清晰、可验证，并为后续扩展非 OpenAI-compatible provider 留出稳定边界。

## What Changes

- 在 `llm` 配置中引入 `providers` 映射，用 provider id 管理 `agentType`、`apiKey`、`baseURL` 等连接信息。
- 让 `llm.models[]` profile 通过 `provider` 字段引用 provider 配置，只保留模型自身属性，例如 `id`、`label`、`model`、`contextWindow`。
- 保持运行时 adapter 边界输出为单个扁平的生效配置 `{ agentType, apiKey, baseURL, model, contextWindow }`，避免 provider 分层泄漏到 OpenAI adapter。
- 保持 `/model` 的选择语义：仍然选择 model profile id，并只写回 `llm.selectedModel`。
- 明确配置校验失败行为：缺少 provider、引用不存在的 provider、provider 缺少必要凭据时应安全失败且不泄露敏感字段值。
- 将新结构作为唯一生效配置结构，删除旧的顶层和 profile 级 provider 字段读取路径，避免配置继承歧义继续扩大实现复杂度。

## Capabilities

### New Capabilities

### Modified Capabilities
- `streaming-llm-service-adapter`: LLM 用户级配置的外部契约调整为“provider 配置与 model profile 分层，并由 model profile 引用 provider”。

## Impact

- `src/config/llm-config.ts`：配置 schema 解析、校验、当前生效配置合成、模型信息读取。
- `src/types/agent.ts`：如需表达 provider profile，可能新增配置解析内部类型；运行时 `LlmConfig` 应尽量保持稳定。
- `src/app/model-context.ts` 与 `/model` 命令：模型列表读取和选择写回应继续使用 `selectedModel`，并处理 provider 引用错误。
- `docs/README.md` 与 `docs/tui-architecture.md`：更新配置示例和架构说明。
- `openspec/specs/streaming-llm-service-adapter/spec.md`：更新配置需求与场景。
- `test/config/llm-config.test.js`、`test/app/model-context.test.js`：新增多 provider、多模型、缺失 provider、敏感信息脱敏等覆盖。
