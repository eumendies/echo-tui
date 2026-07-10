## Context

`/config` 已经在主 UI footer command surface 内提供 provider 和 model 草稿编辑能力。当前 handler 的状态迁移基本是同步纯状态机：用户编辑字段、添加模型、保存配置时才通过 `CommandHostApp.config` 读写 `~/.echo/config.json`。

新增 `list models` 会引入一个新的维度：在尚未保存配置前，基于当前 provider 草稿发起一次厂商 models API 网络请求，并把返回的模型列表投影回 `/config` command surface。这个能力需要保持 `/config` 的边界：不写 transcript、不启动 agent loop、不进入工具审批、不切换 alternate screen，并且错误信息不能泄漏 API key 或隐藏 headers。

当前 provider preset catalog 已经是用户可见 provider 类型和运行时协议参数之间的边界，适合承载模型枚举能力元数据。OpenAI Responses API、OpenAI Chat Compatible API 和 Xiaomi Mimo Token Plan 都可以按 OpenAI-compatible models API 尝试列举；Anthropic Compatible API 可以通过 Anthropic SDK 的 models listing 能力列举；个别兼容 provider 可能不支持 models 接口，失败应是可恢复的 UI 错误。

## Goals / Non-Goals

**Goals:**

- 在 provider 详情页 `+ add model` 下方提供显式 `list models` 选项。
- 使用当前 provider 草稿中的 preset、API key、Base URL 和隐藏 headers 发起模型枚举，不要求用户先保存配置。
- 在 `/config` 内展示远端模型列表，用户可选择一个模型加入当前 provider 草稿。
- 支持 loading、success、empty、unsupported 和 error 状态，错误信息需要脱敏。
- 让 command runtime 能正确处理 command handler 的异步 session update 和 footer redraw。

**Non-Goals:**

- 不缓存远端模型列表到配置文件。
- 不自动替换用户已有模型列表；选择远端模型只新增或聚焦对应模型。
- 不实现分页、搜索或复杂过滤；MVP 可以限制展示前 N 个模型。
- 不改变 `~/.echo/config.json` 的 provider/model schema。
- 不把模型枚举暴露为 agent tool 或 transcript 行为。

## Decisions

### 1. 通过 command host 提供 provider model listing 能力

`ConfigCommandHandler` 不直接导入 SDK 或执行网络请求，而是在 `CommandHostApp.config` 上新增类似 `listModels(providerDraft)` 的能力。handler 只负责校验当前草稿、进入 loading 状态、调用 host 能力、再把结果写回 command session。

这样可以保持现有 command 架构：handler 通过受控 app facade 触达外部世界，测试也可以用 fake host 模拟成功、失败和 unsupported。

备选方案是让 handler 直接调用新增的 listing 模块。这样代码更短，但会让 command handler 同时承担 UI 状态和 provider 协议职责，边界不如现有 `saveDraft()` 清晰。

### 2. 在模型枚举模块集中维护 agent type 到枚举协议的映射

模型枚举模块维护集中映射，例如 `openai` / `openai-chat` → OpenAI-compatible models API，`anthropic` → Anthropic models API。运行时 listing 模块先通过 preset 解析 `agentType`、`baseURLMode`、固定 `baseURL` 和 headers，再使用该映射选择请求方式。

这样新加 preset 时通常只需要声明既有 `agentType`，不需要重复配置模型枚举 kind。若未来出现同一 `agentType` 下 models API 行为不同的 provider，再引入更细粒度 override；当前不提前增加 preset 字段。

### 3. 复用 SDK client 优先，避免手写 provider HTTP 细节

OpenAI-compatible preset 复用 `openai` SDK 的 `models.list()`；Anthropic preset 复用 `@anthropic-ai/sdk` 的 models listing 能力。创建 client 时使用与 agent adapter 一致的 `apiKey`、`baseURL`、`defaultHeaders` 和有限 retry。

如果 SDK 返回结构不同，listing 模块只输出最小 provider-neutral 结果：`{id: string}` 列表。UI 和保存逻辑只需要模型 API id。

### 4. `/config` 增加 model list 子模式，而不是复用 preset 选择模式

新增类似 `ConfigPanelMode = 'list' | 'form' | 'preset' | 'modelList'`。model list mode 有自己的 selected index、loading/error/empty 状态和返回路径。这样 renderer 可以清晰地区分 provider 类型选择和远端模型选择。

从 model list mode 选择模型后：

- 若当前 provider 还没有该模型，则追加 `{id: '', model: selectedModelId}`，再通过 `normalizeConfigDraft()` 生成稳定 model profile id。
- 若已经存在同名模型，则不重复追加，直接回到 form 并聚焦已有模型。
- 若当前没有默认模型，可让 normalization 或保存校验继续选择首个有效模型。

### 5. command runtime 支持异步 handler 完成后重绘

`CommandHandler.handleEvent` 类型已经允许返回 Promise，但 command runtime 当前只在同步调用后执行一次 `renderIfNeeded()`。本变更应让 runtime 在 Promise settle 后再次执行 render，并把异步错误转换为安全错误路径或交给 handler 显式处理。

`/config` 在用户触发 `list models` 时先同步进入 loading surface，随后异步完成时更新为结果列表或错误。这样用户能立刻看到请求进行中，并在请求完成时自动看到 footer 更新。

### 6. 模型枚举只读草稿，不保存配置

`list models` 不写 `~/.echo/config.json`。用户选择远端模型只修改 command session 内草稿，仍需移动到 `save changes` 并确认保存。

这符合现有 `/config` 的保存语义，也避免网络请求成功后用户以为配置已经落盘。

## Risks / Trade-offs

- 兼容 provider 不支持 `/models` → 将请求失败显示为脱敏错误，保留手动添加模型路径；若未来确有同协议但不可枚举的 provider，再引入 preset 级 override。
- API key 或 headers 泄漏 → 所有 listing 错误通过共享脱敏函数处理，不展示 Authorization、Bearer、sk-*、x-api-key 等敏感片段。
- 异步请求完成时 session 已关闭或切换 → handler 更新前检查当前 active session 仍是本次 `/config` 会话，避免 late callback 污染新 surface。
- 远端模型很多 → MVP 限制展示前 100 个，并在 UI 中显示截断提示；后续可增加过滤。
- 用户刚输入 API key 但未按 Enter 提交 → `list models` 只读取已提交草稿字段；文本编辑态下 Enter 仍只提交字段，不直接发起 listing。
- Anthropic SDK models listing API 版本差异 → 实现时用最小类型断言和测试 fake client 覆盖，失败时走可恢复错误。
