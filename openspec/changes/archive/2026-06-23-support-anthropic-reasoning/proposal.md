## Why

当前 `anthropic` provider 只发送基础 Messages API 请求，没有读取 Anthropic 模型配置中的 reasoning effort，也没有处理 Anthropic 返回的 thinking 内容。随着 Claude 新模型支持 adaptive thinking 与 effort 控制，`echo_tui` 需要把现有 `/effort` 配置扩展到 Anthropic，并让用户能看到 provider 返回的 reasoning 内容。

## What Changes

- 允许 Anthropic model profile 读取 `reasoning.effort`，并在请求中启用 Anthropic adaptive thinking。
- 将 Echo TUI 的 effort 等级映射到 Anthropic `output_config.effort`：`minimal -> low`、`low -> medium`、`medium -> high`、`high -> xhigh`、`xhigh -> max`；`none` 保持不启用 reasoning。
- 解析 Anthropic stream 中的 thinking / signature / redacted thinking blocks，将 thinking 内容显示为现有 reasoning summary，并保存 provider-only thinking block 以支持 tool call continuation。
- 保持 Anthropic 请求不发送 OpenAI-only `reasoning` 字段；`reasoning.summary` 仍仅属于 OpenAI Responses 语义。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `anthropic-compatible-llm-adapter`: 扩展 Anthropic adapter 的 reasoning 请求、stream thinking 处理、provider-only thinking 续传和配置读取行为。

## Impact

- 影响 `src/config/llm-config.ts` 中 Anthropic model profile 的 reasoning effort 读取。
- 影响 `src/agent/anthropic/agent.ts` 的 Messages API request 构造、stream event 聚合和 `AgentTurnResult` 输出。
- 影响 `src/agent/anthropic/transcript-converter.ts` 与 `src/types/transcript.ts` 中 provider-only Anthropic thinking record 的转换与过滤规则。
- 复用现有 `reasoning_summary` 展示链路，可能新增 Anthropic adapter、config 和 transcript converter 测试。
