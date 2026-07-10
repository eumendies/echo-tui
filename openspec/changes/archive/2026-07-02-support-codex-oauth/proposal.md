## Why

当前 `echo_tui` 只能通过 OpenAI Platform API key 或兼容网关调用 GPT 模型，无法使用用户已经登录 Codex/ChatGPT 后获得的订阅权益。支持 Codex OAuth 后，用户可以在本机已有 Codex 登录态的前提下，用 ChatGPT/Codex 订阅模型驱动现有 TUI、工具循环和上下文管理。

## What Changes

- 新增 Codex OAuth provider preset，用于通过 `~/.codex/auth.json` 中的 ChatGPT/Codex OAuth 凭据访问 Codex backend Responses 传输。
- 新增 Codex OAuth credential 解析和刷新能力：读取本机 Codex auth cache、检测 access token 过期，并在 refresh token 可用时通过 OAuth refresh endpoint 获取新的 access token。
- 新增 Codex backend Responses adapter 路由：使用 `https://chatgpt.com/backend-api/codex` 作为 Base URL，通过 Bearer access token 调用 `/responses` 和模型枚举接口。
- `/config` 支持配置无需 API key 的 Codex OAuth provider，并在保存、校验、模型枚举和错误展示中保持敏感信息保护。
- 保持现有 OpenAI API key、OpenAI Chat-compatible、Anthropic-compatible 和 fake provider 行为不变。

## Capabilities

### New Capabilities

### Modified Capabilities

- `streaming-llm-service-adapter`: 增加 Codex OAuth provider 配置解析、OAuth token 读取/刷新、Codex backend Responses 请求和模型枚举行为。
- `interactive-llm-config-command`: 增加 Codex OAuth preset 的配置面板行为、无需 API key 的校验规则和 Codex 模型枚举体验。

## Impact

- 影响 `src/config/provider-presets.ts`、`src/config/llm-config.ts`、`src/config/llm-config-editor.ts`、`src/config/provider-model-list.ts` 和相关 `/config` 类型与渲染逻辑。
- 影响 `src/types/agent.ts`、`src/agent/agent-setup.ts`、`src/agent/openai-responses/agent.ts` 或新增 Codex Responses adapter/credential helper。
- 需要新增针对 Codex OAuth auth cache parsing、token refresh、provider config validation、request construction、model listing 和敏感信息脱敏的自动化测试。
- 不新增 OpenAI 登录流程，不要求在本项目内打开浏览器或写入 Codex CLI 的 `auth.json`。
