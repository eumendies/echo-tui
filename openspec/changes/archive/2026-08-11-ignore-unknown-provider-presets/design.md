## Context

LLM 配置解析目前先遍历并完整解析全部 provider，再解析全部 model。`parseProviderProfiles` 遇到任意未知 preset 会立即抛出 `LlmConfigError`，`ModelContext` 捕获后把整个模型目录置为 unavailable；因此一个已经弃用、来自新版本或仅供其他环境使用的 provider 配置会连带阻断所有有效模型。

运行时配置和 `/config` 编辑草稿已有不同职责：运行时图只应包含可装配的 provider/model，编辑草稿则需要保留磁盘原始项供用户修复。此次变更需要维持该边界，并保留同一用户配置 revision 内解析和 agent run 一致性的既有约束。

## Goals / Non-Goals

**Goals:**

- 将未知 preset 的故障域限制在对应 provider 及其关联模型。
- 让模型目录、session 选择和 agent 装配只消费过滤后的有效 provider/model 图。
- 在当前选择被过滤时复用现有“陈旧 selectedModel 回退到第一个有效模型”语义。
- 对无效 `selectedModel`、`contextWindow` 和 preset 明确不使用的 provider 字段应用已有安全默认值。
- 保持配置错误不泄漏 API key、headers 等敏感值。
- 保留 `/config` 对未知 provider 的可见性和严格保存校验。

**Non-Goals:**

- 不把解析器改成忽略所有无效 provider/model 字段。
- 不为未知 preset 猜测协议、baseURL、headers 或 `agentType`。
- 不修改用户配置 JSON schema，不自动删除、迁移或重写未知项。
- 不改变已知 preset 缺少必要凭据、模型引用完全不存在 provider、重复模型 id 或其他没有安全回退值的字段错误的失败语义。

## Decisions

### 1. Provider 解析显式区分“有效”与“因未知 preset 被忽略”

provider 解析结果除已解析 provider 索引外，还应记录被忽略的 provider id。只有 provider profile 是对象、provider id 有效且 `preset` 是非空字符串，但 catalog 查找不到该 id 时，才归类为“未知 preset”并跳过后续凭据、baseURL 和 headers 解析。

选择显式分类而不是捕获所有 `LlmConfigError`，是为了避免把已知 preset 的必要 API key、非法 headers 等可修复错误误判为可忽略项。另一种“仅解析当前选中 provider”的方案会让 `/model` 暴露无法运行的候选，并在模型切换后延迟失败，因此不采用。

### 2. 仅过滤引用已知“被忽略 provider”的模型

model 解析应获得有效 provider 索引和被忽略 provider id 集合。模型明确引用被忽略 provider 时，整个模型 profile 不进入运行时目录；模型引用既不在有效索引、也不在被忽略集合中的 provider 时，继续按现有语义报错。

这样可以区分“provider 已配置但当前版本不认识其 preset”和“model.provider 写错或 provider 配置缺失”。被过滤模型不参与有效模型 id 重复校验，也不能被 `/model`、session sidecar 或 agent 装配选中；有效模型之间的重复 id 仍然报错。

### 3. 在过滤后的模型目录上执行现有选择回退

`resolveSelectedProfile` 和 `createLlmModelConfigInfo` 继续只面向解析后的模型数组。若 `selectedModel` 指向被过滤模型，它自然等同于陈旧选择并回退第一个有效模型；若 session sidecar 指向被过滤模型，`ModelContext` 刷新时也会按现有失效选择逻辑回退。

不在原始模型顺序上单独实现第二套选择算法，避免 status line、`/model` 和 agent run 产生不同选择。

### 4. 无有效模型时保持失败，并提供针对性诊断

若过滤后没有有效模型，运行时不得构造 provider client 或发起请求。错误应说明没有可用模型，并可包含未知 preset/provider 的非敏感标识用于定位，但不得包含 API key、header value 或其他凭据。

这比无条件返回通用“缺少 models”更易诊断，也避免在没有安全回退目标时伪造默认 provider。

### 5. 编辑草稿不复用运行时过滤结果

`createLlmConfigDraft` 继续从原始 JSON 构建草稿，使未知 provider 仍能在 `/config` 中显示、修改或删除；`validateConfigDraft` 继续拒绝保存未知 preset。运行时过滤不得把未知配置从草稿或写回根节点中删除。

这种运行时宽容、编辑时严格的差异是有意设计：读取可维持服务可用性，显式保存则必须产出当前版本能够完整理解的 LLM 配置。

### 6. 可选模型字段无效时使用已有回退链

`selectedModel` 本身是可选字段；非字符串值应按未配置处理，使选择逻辑回退到过滤后第一个有效模型。模型 profile 的 `contextWindow` 也是可选提示值；非正整数或错误类型应按缺失处理，使 `resolveContextWindow` 继续使用内置模型映射或默认窗口。

这些字段均有确定且已存在的运行时默认值，因此忽略无效值不会导致凭据、协议或目标服务被猜测。`reasoning.effort` 和对 Responses 生效的 `reasoning.summary` 没有等价的安全默认语义，仍保持严格校验。

### 7. 仅校验 preset 实际会消费的 provider 字段

当 preset 的 `baseURLMode` 为 `fixed` 或 `hidden` 时，用户配置中的 `baseURL` 不参与运行时连接解析，解析器不应因其类型错误而失败；`optional` 或 `required` 模式仍按现有规则读取和校验。当 preset 明确不要求 API key 时，无效类型的可选 `apiKey` 应按缺失处理，使用 preset 的 `defaultApiKey` 或空值；要求 API key 的 preset 仍严格读取非空字符串。

选择按 preset 语义读取字段，而不是先统一校验再丢弃，是为了避免无效但不生效的遗留字段阻断运行。headers、Codex auth file 等实际会被消费的字段不在此容错范围内。

## Risks / Trade-offs

- [Risk] 未知 provider 被静默忽略后，用户可能不知道某些模型未出现在 `/model` 中 → 当没有任何有效模型时提供针对性错误；存在有效回退时仍可通过 `/config` 查看原始未知项。
- [Risk] 过滤范围过宽会掩盖配置拼写或凭据错误 → 仅 catalog 查找不到的非空 preset 可被忽略，其他结构和已知 preset 校验继续 fail-fast。
- [Risk] 可选字段回退可能隐藏手工配置错误 → 只覆盖已有确定默认值或被 preset 明确判定为不生效的字段，并通过 `/config` 保留原始值供用户检查。
- [Risk] runtime 目录与 `/config` 草稿列表不同可能造成认知差异 → 明确维持“运行候选只含可装配模型、编辑草稿保留原始配置”的职责边界，并分别增加测试。
- [Risk] 过滤后选择发生变化 → 复用已有 stale selection 回退规则，不写回 `selectedModel`；用户配置升级后原选择可再次生效。
- [Trade-off] 不为部分有效配置增加常驻 warning surface，避免扩展 transcript/footer 状态和持久化协议；本次只保证可运行性和配置面板可诊断性。
