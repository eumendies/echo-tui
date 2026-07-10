## Context

`echo_tui` 当前通过 provider preset catalog 把用户配置解析为 `agentType`、`apiKey`、`baseURL`、headers 和模型名，再交给 OpenAI Responses、OpenAI Chat 或 Anthropic adapter。这个模型适合 OpenAI Platform API key 和兼容网关，但不能使用用户的 ChatGPT/Codex 订阅权益。

Codex CLI 在用户登录后会把 ChatGPT/Codex OAuth 凭据缓存到 `CODEX_HOME` 下的 `auth.json` 或系统 credential store。当前 change 只支持文件缓存路径，默认读取 `~/.codex/auth.json`，不触发 OpenAI 登录，不打开浏览器，也不写入 Codex CLI 的 auth cache。实现目标是把该凭据作为运行时 credential source，用 Codex backend Responses 传输驱动现有 agent loop。

OpenClaw 的实现表明 Codex 订阅模型通过独立于 OpenAI Platform API 的传输访问：Base URL 为 `https://chatgpt.com/backend-api/codex`，Responses 请求落到 `/responses`，模型枚举可访问 `/models?client_version=1.0.0`，请求认证使用 `Authorization: Bearer <ChatGPT OAuth access token>`，有 account id 时可带 `ChatGPT-Account-ID`。

## Goals / Non-Goals

**Goals:**

- 增加一个用户可选的 Codex OAuth provider preset，使用户可以在已有 Codex 登录态下配置订阅模型。
- 读取 file-based Codex auth cache，解析 access token、refresh token、过期时间和 account id。
- 在 access token 过期且 refresh token 可用时执行 OAuth refresh 请求，并在本进程内使用刷新后的 access token。
- 通过 Codex backend Responses 传输复用现有 OpenAI Responses transcript conversion、tool schema、stream handling、usage 和错误脱敏边界。
- 在 `/config` 中支持无需 API key 的 provider 校验、保存和模型枚举。

**Non-Goals:**

- 不实现 OpenAI/Codex 登录、device code 登录、browser callback 或 PKCE 授权流程。
- 不支持读取系统 keyring 中的 Codex 凭据；未启用 file auth cache 时提示用户切换 Codex credential storage 或改用 API key。
- 不回写 `~/.codex/auth.json`，避免和 Codex CLI 并发写入、schema 演进或权限策略冲突。
- 不把 Codex OAuth token 暴露给 transcript、debug 日志、OpenSpec 示例或错误明文。
- 不改变现有 API key provider、Anthropic provider、MCP tool 和 tool approval 行为。

## Decisions

### Decision: 新增 Codex OAuth preset，而不是复用普通 OpenAI Responses preset

新增 `openai-codex-oauth` provider preset，并将其解析为独立的 `agentType: "codex"`。Codex adapter 复用 OpenAI Responses 的 transcript conversion、tool schema 投影和 stream reader，但拥有自己的 credential source、固定 Codex base URL、请求 payload 和模型枚举方式。普通 `openai-responses-api` 继续要求 API key 并访问 OpenAI Platform API。

备选方案是让用户在普通 OpenAI Responses provider 中填一个伪 API key 和 Codex Base URL。这会让配置校验、错误提示、模型枚举和敏感信息语义都变得模糊，也容易误导用户把 Codex OAuth 当作 Platform API key。

### Decision: 第一版只读 Codex file auth cache，refresh 后不回写

实现读取 `~/.codex/auth.json` 或配置指定的 auth cache path，并把解析出的 OAuth 凭据保存在当前 provider request 生命周期中。若 access token 过期，使用 refresh token 请求 `https://auth.openai.com/oauth/token`，grant type 为 `refresh_token`，成功后只在当前进程内使用新 token。

不回写的原因是 Codex CLI auth cache 不是本项目拥有的数据文件。回写需要处理文件锁、原子写入、schema 兼容、权限位、Codex CLI 并发刷新和 keyring 模式，第一版收益不足。

### Decision: Codex OAuth 使用独立 adapter，并复用 Responses 共享转换逻辑

现有 Responses adapter 已负责 transcript conversion、function tool schema、streaming event 解析、reasoning summary 和 provider usage。Codex backend 与 OpenAI Platform Responses 协议相近但请求契约不同，因此新增窄范围 Codex adapter：该 adapter 负责 OAuth credential、Codex fixed base URL、Bearer OAuth token、可选 `ChatGPT-Account-ID` header 以及 Codex 专属 payload；共享 converter 和 stream reader，避免复制事件解析逻辑。

这样 Codex 特例不会散落到通用 OpenAI adapter 中，后续普通 Responses API 和 Codex backend 的协议差异可以独立演进。

### Decision: `/config` 中 Codex OAuth provider 不展示 API key 字段

Codex OAuth provider 的用户输入不是 API key。配置面板应展示 auth cache 状态、可选 auth cache path 或说明文本，并允许用户手动配置模型或通过 Codex 模型枚举添加模型。保存校验不要求 `apiKey`。

配置文件中不应保存 access token 或 refresh token。provider profile 只保存 preset、label、可选 auth cache path、可选 headers 和模型列表。

### Decision: token refresh 失败时失败本次请求并给出手动刷新提示

当 access token 过期且 refresh token 缺失或 refresh 失败时，系统不应静默降级到 API key provider 或 fake provider。应阻止本次 provider request，显示脱敏错误，并提示用户运行 Codex CLI 重新登录或刷新本机 auth cache。

## Risks / Trade-offs

- Codex backend 是 ChatGPT/Codex 专用传输，公开稳定性弱于 Platform API -> 通过独立 preset 和 tests 隔离风险，不影响普通 OpenAI API key provider。
- `auth.json` schema 可能变化 -> parser 只接受明确识别的字段，无法识别时给出安全错误，不猜测 token 位置。
- refresh 不回写可能导致每次新进程都重新 refresh -> 第一版接受该取舍，避免破坏 Codex CLI auth cache；后续可在用户明确接受风险后增加受控回写。
- 用户使用 keyring 存储时没有 `auth.json` -> 提示当前只支持 file-based Codex auth cache，给出切换 credential storage 或使用 API key 的路径。
- token、header 或 auth cache 内容泄漏风险 -> 所有错误、debug、模型枚举失败和配置展示必须走现有脱敏规则，并新增 OAuth token 专项测试。

## Migration Plan

1. 新增 preset 和配置解析支持，但不改变现有用户配置；默认启动仍使用当前 `llm.selectedModel`。
2. 用户通过 `/config` 新增 Codex OAuth provider，或手动编辑 `~/.echo/config.json` 选择该 preset。
3. 如 Codex OAuth provider 请求失败，用户可切回原有 API key provider；实现不修改 Codex CLI 的 auth cache，因此回滚只需删除或取消选择该 provider。

## Open Questions

- Codex `auth.json` 在当前 CLI 版本中的字段名是否需要兼容多代格式，还是第一版只支持当前可观测格式。
- 是否需要提供配置项覆盖 `CODEX_HOME`，还是仅遵循 `CODEX_HOME` 环境变量和默认 `~/.codex`。
- Codex backend 是否始终需要 `ChatGPT-Account-ID` header；第一版可在能从 access token 解析 account id 时发送，不能解析时继续尝试或明确失败需实现时验证。
