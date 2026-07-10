## Context

当前真实 LLM 配置已经统一到 `~/.echo/config.json` 的 `llm.providers`、`llm.models` 和 `llm.selectedModel` 结构；运行时通过 `readLlmConfig()` 解析 provider profile 的 `preset`、`apiKey`、`baseURL`、`headers`，再由 provider preset catalog 映射到 OpenAI Responses、OpenAI Chat 或 Anthropic adapter。这个结构适合程序读取，但对用户不友好：用户仍需要手写 JSON 才能完成首次配置。

本变更要在主 UI 内增加 `/config` slash command。它复用现有 command runtime、footer command surface、ANSI 渲染和 stdin raw mode，不切换 alternate screen，也不引入第三方 TUI 库。用户提供的 demo 展示了 provider/model 两级配置面板，本设计沿用其“列表页 + provider 表单页 + 模型列表”的交互形态，但把字段映射到当前项目的 LLM 配置模型。

## Goals / Non-Goals

**Goals:**

- 提供 `/config` slash command，专门用于配置 provider 和 model；该命令不写 transcript、不触发 agent、不进入工具流。
- 通过 provider preset catalog 隐藏 `agentType`，让用户选择 OpenAI Responses API、OpenAI Chat Compatible API、Anthropic Compatible API 或 Xiaomi Mimo Token Plan 这类预定义 provider。
- 支持新增、编辑、删除 provider；编辑 API key、可编辑 Base URL、模型列表和默认模型。
- 保存到 `~/.echo/config.json` 的 provider-backed 配置结构，并保留 `tools`、render 等不属于本面板的配置节点。
- 让后续新增预定义 provider 时只需新增 preset 元数据，不需要修改 UI 分支或暴露协议实现细节给用户。

**Non-Goals:**

- 不实现模型自动发现、API 连通性测试或远程拉取 model list。
- 不提供 headers 的通用 UI；固定 headers 由 preset catalog 提供，已有 provider profile 上的手写 headers 需要隐藏保留并随请求发送，复杂自定义 headers 编辑可后续单独设计。
- 不在配置面板中编辑 reasoning effort/summary；`/effort` 仍处理 OpenAI Responses reasoning effort。
- 不兼容旧的顶层或 model profile 级 provider 配置格式，也不提供自动迁移旧格式的复杂流程。
- 不保留独立 `echo-tui config` CLI 子命令；`config` CLI 参数继续按 unknown command 处理。

## Decisions

### 1. 使用 provider preset catalog 作为 UI 与运行时协议的边界

新增一个内置 preset catalog，表达用户可选 provider 类型和后台运行时配置：

```text
ProviderPreset
├─ id
├─ label / description
├─ agentType
├─ baseURLMode: hidden | optional | required | fixed
├─ baseURL?: string
├─ headers?: Record<string, string>
└─ suggestedModels?: string[]
```

内置：

| preset | agentType | Base URL 行为 |
| --- | --- | --- |
| `openai-responses-api` | `openai` | optional |
| `openai-chat-compatible-api` | `openai-chat` | optional |
| `anthropic-compatible-api` | `anthropic` | optional |
| `xiaomi-mimo-token-plan` | `openai-chat` | fixed `https://token-plan-cn.xiaomimimo.com/v1` |

Xiaomi Mimo Token Plan 这类 provider 可配置为 `agentType: "openai-chat"` 且 `baseURLMode: "fixed"`，UI 只展示 Mimo 与 API key，不展示或要求用户理解 OpenAI Chat Compatible 协议。

替代方案：让 UI 直接写 `agentType`。这实现更小，但会把协议内部字段暴露给用户，也不利于后续预定义 provider 以固定 baseURL/header 复用通用 adapter。

### 2. 用户配置保存 `preset`，运行时解析为 `agentType`

provider profile 推荐保存为：

```json
{
  "llm": {
    "providers": {
      "my-chat": {
        "preset": "openai-chat-compatible-api",
        "apiKey": "...",
        "baseURL": "https://example.com/v1"
      }
    },
    "selectedModel": "my-chat-gpt-4o",
    "models": [
      {"id": "my-chat-gpt-4o", "provider": "my-chat", "model": "gpt-4o"}
    ]
  }
}
```

`readLlmConfig()` 在解析 provider profile 时先读取 `preset`，再从 catalog 得到 `agentType`、固定 `baseURL` 和 headers。用户不需要也不应通过配置面板编辑 `agentType`。本变更不兼容旧顶层配置，也不要求继续读取用户配置中的 provider profile 级 `agentType`；配置命令保存时应统一写 `preset`。

替代方案：配置命令只写展开后的 `agentType/baseURL`。这样无需改运行时配置 schema，但 Mimo 这类预定义 provider 的固定元数据会被复制进用户配置，后续更新成本更高。

### 3. 配置面板使用主 UI command surface，状态机合入 handler

`/config` 是主 UI 内的 slash command，生命周期由 command runtime 管理：命中后清空 composer，打开 `config` command surface，并在 active command session 中优先消费后续事件。它不写 transcript、不触发 agent、不进入 tool approval 或 user-question flow。配置面板状态机合入 `ConfigCommandHandler`，只接收 `InputEvent` 并返回 continue/save/cancel/exit 结果；command session 只保存可结构化克隆的 `ConfigCommandState`，避免把可变 controller 实例塞入 app 状态。

```text
src/commands/config-command-handler.ts
      │ /config
      ▼
src/app/command-host.ts
      │ read draft / save draft
      ▼
src/render/footer/command-surfaces.ts
      │ config surface
      ▼
src/render/footer/config-surface.ts
      │ draft state → ANSI lines
      ▼
~/.echo/config.json
```

替代方案：保留独立 `echo-tui config` 子命令。它能在没有可用 LLM 配置时打开配置界面，但会形成第二套终端事件循环和退出码路径；用户当前要求主 UI 已能配置时不要保留独立 CLI，因此删除该子命令。

### 4. Config editor 层负责 JSON 读写和草稿规范化

新增 config editor 模块，负责：

- 读取现有 `~/.echo/config.json`，缺失时创建空 root draft。
- 只解析和管理 `llm.providers`、`llm.models`、`llm.selectedModel`。
- 保留 root 上的其他节点，例如 `tools` 和渲染配置。
- 对空 provider id、重复 id、缺少 API key、缺少 model 等保存前错误做本地校验。
- 通过 temp file + rename 原子写入。

`ConfigCommandHandler` 只操作规范化后的 draft，不直接操作任意 JSON object，避免渲染逻辑携带文件格式细节。

### 5. ID 生成保持可预测但不要求用户手写

provider id 默认由 provider 名称或 preset id 生成 kebab-case，重复时追加数字后缀。model profile id 默认由 `${providerId}-${modelName}` 生成，同样做重复去重。UI 显示用户友好的 provider 名称和 model API id，只有保存时需要稳定 profile id。

替代方案：要求用户编辑 provider id 和 model profile id。这样透明度更高，但首版交互噪音大，也偏离“用户配置 provider 和模型”的核心目标。

## Risks / Trade-offs

- `preset` 成为新的配置字段，旧的直接 `agentType` provider profile 将不再作为用户配置格式支持 → 本变更明确配置命令只写 `preset`，测试覆盖 preset 展开、缺失 preset 和旧格式失败提示。
- `/config` 复用 footer surface 后配置面板高度受主 UI footer 预算约束 → 使用 `constrainLayoutTail()` 保留当前焦点附近内容，并让 command state 而非渲染层决定交互语义。
- API key masked 输入无法确认用户是否误输 → 首版只做本地格式/空值校验，连通性测试后续单独添加。
- 固定 Base URL 的预定义 provider 可能需要更新 → 使用 catalog 中心化，用户配置保存 `preset`，减少已保存配置的迁移成本。
- 配置文件中存在手写高级字段时，面板保存可能丢失 `llm` 内不认识的字段 → editor 应明确只重建 `llm.providers/models/selectedModel`，并尽量保留 `llm` 下不冲突的未知字段；无法安全保留的字段需在设计和测试中明确。

## Migration Plan

无需自动迁移旧顶层 provider 配置或直接 `agentType` provider profile。用户在主 UI 中运行 `/config` 后保存，会生成 provider-backed preset 新结构。已有 preset 配置可被读入草稿；无法映射 preset 的 provider 应显示为错误或提示需要重新创建，避免保存时生成不可运行配置。

回滚时，用户可以继续手写 `~/.echo/config.json` 的 provider-backed 配置；删除 `/config` handler 不影响 provider adapters。`echo-tui config` 不作为回滚入口保留。

## Open Questions

- OpenAI Responses API 的官方默认 Base URL 是否在 UI 中隐藏为空，还是显示为 `https://api.openai.com/v1` 但可覆盖？首版建议 optional，空值表示使用 SDK 默认。
- Xiaomi Mimo Token Plan preset 已内置，使用固定 OpenAI Chat compatible Base URL。
