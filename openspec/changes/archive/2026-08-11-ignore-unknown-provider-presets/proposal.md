## Why

当前 LLM 配置解析会因为任意 provider profile 引用了未知 preset 而让整个模型目录失效，即使配置中仍存在完整且可运行的 provider/model 组合，TUI 也只会显示 `model unavailable`。需要把未知 preset 的影响限制在其所属 provider 和关联模型，使运行时能够继续使用其余可解析配置。

## What Changes

- LLM 运行时解析遇到未知 provider preset 时，忽略该 provider profile，而不是立即终止整个配置解析。
- 忽略所有引用该未知 provider 的模型 profile，不把不可运行模型暴露给模型选择和 agent 装配。
- 当 `selectedModel` 指向被忽略模型时，沿用现有陈旧选择回退语义，选择第一个有效模型。
- 当 `selectedModel` 不是字符串时，将其视为未配置并选择第一个有效模型。
- 当模型 profile 的可选 `contextWindow` 无效时，忽略该字段并使用内置模型映射或默认窗口。
- preset 明确使用固定或隐藏 Base URL 时，不校验不会生效的用户 `baseURL`；preset 不要求 API key 时，无效的可选 `apiKey` 回退 preset 默认值或空值。
- 当过滤后没有任何有效模型时保持明确失败，并提供不含敏感信息的配置错误。
- 除上述具有明确安全回退的可选字段外，已知 preset 的必要凭据、模型引用完全不存在的 provider、缺失字段及结构错误继续明确失败，不扩大为通用静默容错。
- `/config` 草稿继续保留并展示未知 provider；保存 LLM 配置时仍要求修复或删除未知 preset，避免静默改写用户配置。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `streaming-llm-service-adapter`: 将未知 provider preset 的行为从全局失败改为局部过滤，并为无效模型选择、上下文窗口及 preset 不生效字段规定安全回退语义。

## Impact

- 主要影响 `src/config/llm-config.ts` 的 provider/model 图解析及其返回结构。
- 影响 `UserConfigSnapshot`、`ModelContext`、`/model` 和 agent 装配所消费的非敏感模型目录，但不改变公开配置文件结构。
- `src/config/llm-config-editor.ts` 的草稿保留与严格保存校验保持不变。
- 需要更新 LLM 配置解析、模型状态和配置编辑相关自动化测试；不新增第三方依赖。
