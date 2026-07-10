## Context

当前 `readLlmConfig()` 从 `~/.echo/config.json` 读取 `llm.models[]`，再把选中的 model profile 与顶层 `llm.apiKey` / `llm.baseURL` 合成为运行时 `LlmConfig`。这个设计对“一个 provider，多模型”足够简单，但当用户同时配置 OpenAI、Example Provider、OpenRouter、本地 OpenAI-compatible 服务等多个 endpoint 时，provider 凭据只能重复写在 profile 上，或者依赖一个不再适合所有模型的顶层共享配置。

目标结构应把“连接到哪里、用什么凭据”和“选择哪个模型名、显示什么 label、上下文窗口是多少”分开：

```text
llm.selectedModel
      │
      ▼
┌──────────────┐     provider      ┌─────────────────┐
│ model profile│ ────────────────▶ │ provider profile│
│ id/model/ctx │                   │ apiKey/baseURL  │
└──────────────┘                   └─────────────────┘
      │                                     │
      └──────────────────┬──────────────────┘
                         ▼
                 runtime LlmConfig
```

## Goals / Non-Goals

**Goals:**

- 支持一个配置文件内声明多个 provider，每个 provider 拥有独立 `agentType`、`apiKey`、`baseURL` 和可选请求 `headers`。
- 支持多个 model profile 通过 `provider` 引用 provider 配置，从而避免同 provider 多模型时重复凭据。
- 保持 `/model` 仍选择 model profile id，避免引入 `selectedProvider` 与 `selectedModel` 的双状态不一致。
- 保持 OpenAI adapter 与 agent loop 的运行时输入仍是单个扁平 `LlmConfig`，把 schema 复杂度限制在配置解析层。
- 删除旧结构读取路径，要求用户配置显式使用 `llm.providers` 和 `models[].provider`。

**Non-Goals:**

- 不在本变更中新增 Anthropic、Gemini 等非 OpenAI-compatible adapter。
- 不新增交互式配置向导或自动迁移命令。
- 不让 `/model` 同时编辑 provider、凭据或 base URL。
- 不改变 tool runtime 配置位置；`tools.bash` 仍属于根级本地工具配置。

## Decisions

1. 采用 `llm.providers` 映射而不是在每个模型内重复 provider 字段。

   推荐结构：

   ```json
   {
     "llm": {
       "selectedModel": "example-fast",
       "providers": {
         "example": {
           "agentType": "openai",
           "apiKey": "<example-api-key>",
           "baseURL": "https://provider.example/v1",
           "headers": {
             "x-source": "data-ad"
           }
         },
         "openai": {
           "agentType": "openai",
           "apiKey": "<openai-api-key>"
         }
       },
       "models": [
         {
           "id": "example-fast",
           "label": "Example Fast",
           "provider": "example",
           "model": "example-fast",
           "contextWindow": 128000
         },
         {
           "id": "openai-deep",
           "label": "OpenAI Deep",
           "provider": "openai",
           "model": "gpt-4.1",
           "contextWindow": 1000000
         }
       ]
     }
   }
   ```

   备选方案是 `providers.<id>.models[]` 嵌套模型。放弃该方案的原因是现有 `/model`、`selectedModel` 和测试都围绕扁平模型列表工作；嵌套结构会让唯一 id、展示排序和写回语义更复杂。

2. 不引入 `selectedProvider`。

   当前用户意图是选择“下一次对话使用哪个模型”，而不是独立选择 provider。`models[].provider` 已经能从模型唯一确定 provider。双选择会产生不一致状态，例如 `selectedProvider=openai` 但 `selectedModel=example-fast`，需要额外优先级规则。

3. `agentType` 归属 provider，`contextWindow` 归属 model。

   `agentType` 决定如何创建 provider agent 和 client，和 endpoint / 凭据 / 请求 headers 是一组连接语义；`contextWindow` 则跟具体模型能力相关。若 provider 缺省 `agentType`，沿用当前默认 `openai`。当 provider 的 `agentType` 为 `fake` 时不要求真实 `apiKey`。

4. 配置解析层负责归一化，运行时边界保持稳定。

   `readLlmConfig()` 应在内部解析 provider 和 model，最终仍返回现有 `LlmConfig` 形状：

   ```ts
   {
     agentType,
     apiKey,
     baseURL,
     headers,
     model,
     contextWindow,
     tools
   }
   ```

   这样 `openai-agent.ts`、`agent-setup.ts`、agent loop 和工具注册不需要理解 provider map。

5. 不保留旧结构读取兼容。

   配置必须包含 `llm.providers`，每个 model profile 必须通过 `provider` 引用 provider id。解析器不再读取 `llm.apiKey`、`llm.baseURL`、`llm.headers` 或 profile 级 provider 字段，避免新旧结构同时存在时产生继承和优先级歧义。

## Risks / Trade-offs

- [Risk] 已使用旧结构的本地配置会失败。→ Mitigation：本次已将当前用户配置迁移为 provider-backed 结构；文档只展示新结构，错误信息明确提示缺少 `providers` 或 `models[].provider`。
- [Risk] 错误信息可能暴露 provider id 之外的敏感值。→ Mitigation：错误只包含字段名、profile id、provider id，不包含 `apiKey` 或完整配置内容，并继续通过现有脱敏边界展示。
- [Risk] `models[].provider` 引用不存在时 `/model` 也可能无法展示列表。→ Mitigation：`readLlmModelConfigInfo()` 复用同一校验逻辑，返回安全错误；用户修正配置后下一次打开 `/model` 即恢复。

## Migration Plan

1. 更新配置解析，使 provider-backed 结构归一化为当前运行时 `LlmConfig`。
2. 更新 `/model` 读取的 profile 信息，使 provider-backed model 仍展示 `label`、`id`、`model`。
3. 更新 README 示例为 provider map，并说明旧的顶层/profile provider 字段不再读取。
4. 保持 `/model` 写回只修改 `llm.selectedModel`，不自动重写用户配置结构。
5. 如需回滚，实现层可恢复旧字段解析并更新文档；当前用户配置文件已有备份可用于人工恢复。

## Open Questions

- 是否需要在 `/model` 列表中显示 provider id，例如 `Example Fast · example`？本变更默认不改 UI，只保证配置生效。
- 是否允许 provider 级 `contextWindow` 作为默认值？本变更默认不支持，避免模型能力与 endpoint 连接配置混在一起。
