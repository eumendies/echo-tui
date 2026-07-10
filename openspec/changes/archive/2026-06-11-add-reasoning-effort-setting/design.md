## Context

当前 LLM 配置已经拆成 provider profile 和 model profile：provider 负责 `apiKey`、`baseURL`、`headers` 等连接信息，model profile 负责模型名、展示名和 `contextWindow`。OpenAI Responses SDK 支持请求级 `reasoning.effort`，但当前 `LlmConfig` 和 `createRequest()` 没有携带或发送该字段。

交互层已有 `/model` 的 select command surface、`ModelContext` 的配置读取/原子写回能力，以及 status line 的模型展示能力。`/effort` 会使用更贴合强度调节语义的 scale command surface：读取当前 selected model profile，展示固定 effort 刻度，确认后直接更新该 profile 的 `reasoning.effort`。

```text
~/.echo/config.json
      │
      ├─ llm.models[].reasoning.effort
      │
      ▼
readLlmConfig()
      │
      ▼
LlmConfig.reasoningEffort
      │
      ├──────────────▶ status line: model · effort high
      │
      ▼
responses.create({ reasoning: { effort } })
```

## Goals / Non-Goals

**Goals:**

- 在 model profile 上支持可选 `reasoning.effort`，不放到 provider 上。
- `/effort` 直接覆盖当前 selected model profile 的 `reasoning.effort`，不引入 override map 或 Default/清除选项。
- status line 在当前 profile 配置了 effort 时显示推理等级。
- 未配置 effort 时不发送 OpenAI `reasoning` 字段，避免假设服务端默认值。
- 保持 `/model` 与 `/effort` 职责分离：前者选择模型 profile，后者修改当前 profile 的推理等级。

**Non-Goals:**

- 不新增 `/effort high` 这种带参数快捷语法，第一版只做交互式 scale surface。
- 不支持 provider 级默认 effort，也不支持全局 effort override。
- 不校验某个模型是否真正支持某个 effort 值；客户端只校验枚举，服务端负责能力错误。
- 不展示 reasoning summary，也不处理 reasoning text stream 事件。

## Decisions

1. 使用 `models[].reasoning.effort`，而不是 `reasoningEffort` 平铺字段。

   推荐结构：

   ```json
   {
     "id": "llmbox-gpt5.5",
     "label": "LLMBox GPT5.5",
     "provider": "llmbox-provider",
     "model": "gpt-5.5-2026-04-24",
     "reasoning": {
       "effort": "high"
     }
   }
   ```

   这样与 Responses API 的请求结构一致，并给未来可能的 `reasoning.summary` 留出空间。第一版只读取和写入 `effort`。

2. `/effort` 覆盖当前 model profile，不维护独立 override 状态。

   用户明确希望覆盖，所以不引入 `effortOverrides`。确认选择后直接定位 `llm.models[]` 中当前 selected profile，并写入 `reasoning.effort`。如果 profile 原本没有 `reasoning`，创建 `{effort}`；如果已有其他字段，保留未知字段并只更新 `effort`。

3. `/effort` 不提供 Default。

   可选项固定为 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`。如果当前 profile 没有 effort，打开 surface 时选中 `medium`，但 status line 不显示 effort，直到用户确认写入。surface 使用 slider 轨道表达速度到深度的取舍：轨道上用高亮块指示当前项，并在下一行显示全部 effort 名称且高亮当前项；不显示冗余解释句。因为它是横向刻度，交互使用 Left/Right 调整，而不是 Up/Down。

4. status line 只显示显式配置的 effort。

   渲染层不推断服务端默认值。`ModelContext` 或等价配置上下文应能返回当前 profile 的 `reasoning.effort`，`AppContext.createStatusLineState()` 将其拼入模型展示文本，例如 `LLMBox GPT5.5 · effort high`。

5. 请求只在配置存在时发送 `reasoning`。

   `createRequest()` 增加可选字段：

   ```ts
   reasoning?: { effort: ReasoningEffort };
   ```

   `LlmConfig` 中无 effort 时保持现有 request shape 不变，避免影响不支持 reasoning 的模型或 provider。

## Risks / Trade-offs

- [Risk] 某些 provider 或模型不支持 `none` / `xhigh` 等值。→ Mitigation：客户端只做枚举校验；服务端返回错误时走现有 provider 错误路径，错误内容继续脱敏。
- [Risk] `/effort` 直接修改 model profile 会影响后续所有会话。→ Mitigation：这是用户明确选择的覆盖语义；surface 标题和文档说明“更新当前模型 profile”。
- [Risk] status line 变长导致窄终端截断。→ Mitigation：复用现有 status line clamp 逻辑，只把 effort 拼入模型 label 前缀。
- [Risk] `reasoning` 对象未来新增字段时 `/effort` 可能误删。→ Mitigation：写回时保留 `reasoning` 中除 `effort` 外的未知字段。

## Migration Plan

1. 更新配置解析和类型，支持可选 `models[].reasoning.effort`。
2. 更新 OpenAI Responses request shape，在 effort 存在时发送 `reasoning.effort`。
3. 增加 `/effort` command 和配置写回能力。
4. 更新 status line 派生逻辑和文档。
5. 用户已有配置无需迁移；没有 effort 的 profile 继续不发送 reasoning。

## Open Questions

- 是否需要在未来支持 `/effort high` 快捷语法？第一版暂不做。
- 是否需要将 effort 显示到 `/model` 列表 description 中？第一版只显示在 status line。
