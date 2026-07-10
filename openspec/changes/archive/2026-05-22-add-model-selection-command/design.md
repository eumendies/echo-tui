## Context

当前真实 LLM adapter 每次普通消息请求都会通过 `readLlmConfig()` 从 `~/.echo/config.json` 读取 `{ apiKey, baseURL, model }`，因此模型切换只要持久化到同一个配置文件，下一次请求即可自然生效。现有 `/model` handler 只读取 `ModelContext.createModelCommandInfo()` 并打开只读 `info` surface；现有 `/resume` 已经提供 `select` surface、Up/Down/Enter/Esc、窗口内选中项更新等交互样板。

这次变更跨越配置解析、slash command、footer surface、文档和规格，但不需要新增终端渲染框架或外部依赖。

## Goals / Non-Goals

**Goals:**

- 支持 `~/.echo/config.json` 配置多个模型 profile，并通过持久化选择解析当前生效模型。
- 要求用户级配置使用模型 profile，避免同时维护两套模型配置语义。
- 将 `/model` 变成可交互的模型选择 surface：Up/Down 移动、Enter 确认、Esc 取消。
- 选择模型后写回用户级配置文件，使后续普通消息使用新的模型。
- 继续保证敏感配置值只驻留在运行时内存中，不进入 transcript、日志、错误摘要、文档示例或测试 fixture。

**Non-Goals:**

- 不支持在 TUI 内新增、编辑、删除模型 profile；用户仍通过编辑 `config.json` 管理候选项。
- 不实现 provider 专属参数、工具调用、多模态、reasoning effort 或 token 限制等高级模型配置。
- 不在 transcript session 中记录模型切换事件。
- 不支持 response 进行中切换当前请求使用的模型；选择只影响后续普通请求。

## Decisions

### 1. 使用同一个 `config.json` 保存候选模型与当前选择

推荐配置形态：

```json
{
  "llm": {
    "apiKey": "<api-key>",
    "baseURL": "<base-url>",
    "selectedModel": "fast",
    "models": [
      {
        "id": "fast",
        "label": "Fast",
        "model": "gpt-4.1-mini"
      },
      {
        "id": "deep",
        "label": "Deep",
        "model": "gpt-4.1"
      },
      {
        "id": "other-provider",
        "label": "Other Provider",
        "apiKey": "<profile-api-key>",
        "baseURL": "<profile-base-url>",
        "model": "<provider-model-name>"
      }
    ]
  }
}
```

profile 中的 `apiKey` / `baseURL` 可覆盖顶层配置；缺省时继承顶层配置。`selectedModel` 保存 profile id。

选择这个方案是因为它符合用户直觉：模型候选项和当前选择都属于用户级 LLM 配置。备选方案是单独维护 `~/.echo/echo_tui/state.json`，但那会让“为什么当前模型不是 config 里的 model”变得不透明，也需要新增一套持久化状态边界。

### 2. `readLlmConfig()` 仍是 agent 的唯一生效配置入口

真实 adapter 不感知 profile 选择细节，只接收解析后的 `LlmConfig`。profile 的选择、继承和校验都在 `src/agent/llm-config.ts` 内完成。

这样可以保持 `openai-agent.ts` 的请求构造稳定：它仍然使用 `config.model` 创建 Responses API 请求，并继续不发送 `max_output_tokens`。

### 3. `ModelContext` 负责 `/model` 的列表读取与持久化写入

`ModelContext` 从 `llm-config.ts` 读取可展示的模型候选项、当前选择和安全错误摘要，并提供 `selectModel(id)` 写回 `llm.selectedModel`。写入时读取完整 JSON、保留未知字段、只修改 `llm.selectedModel`，并使用临时文件 + rename 进行单文件原子更新。

选择这个边界是因为 `/model` 已经通过 `ModelContext` 读取模型信息；把持久化逻辑也收敛到这里，可以避免 handler 直接解析配置文件。备选方案是新增 command effect 交给 runtime 执行写入，但当前 runtime 的 effect 主要描述 app state/transcript/session 变化，模型配置属于 ModelContext 的业务能力，引入新 effect 会扩大 runtime 表面积。

### 4. `/model` 复用现有 `select` surface 模式

当配置中存在多个有效模型 profile 时，`/model` 打开 `select` surface：

- `Up` / `Down` 更新 `selectedIndex`。
- `Enter` 调用 `ModelContext.selectModel(id)`，成功后关闭 surface 并清空 composer。
- `Esc` 取消选择，不写配置并关闭 surface。
- 其他输入事件保持会话不变。

当配置缺失、无效或没有可选择 profile 时，继续打开安全的 `info` surface 展示可操作错误摘要。

## Risks / Trade-offs

- [Risk] `config.json` 写入失败或 JSON 无效可能导致用户无法切换模型。→ Mitigation: 写入前明确校验，失败时保持 command surface 可见并展示脱敏错误；写入使用临时文件 + rename，避免半写入。
- [Risk] profile 允许覆盖 `apiKey` / `baseURL` 后，错误信息可能意外包含敏感字段。→ Mitigation: 继续复用 `redactSensitiveText()`，测试覆盖错误摘要不含 key-like 字符串。
- [Risk] `/model` 选择成功后没有 transcript 提示，用户可能错过切换结果。→ Mitigation: 选择成功后下一次打开 `/model` 会高亮当前选择；surface 标题和选项描述展示当前模型。首版不把切换事件写入 transcript，避免污染对话事实。

## Migration Plan

- 文档提供 `llm.models` / `llm.selectedModel` 配置示例。
- 旧的 `llm.model` 不再作为生效模型读取；缺少 `models` 时显示安全配置错误。

## Open Questions

- 首版是否需要给 profile 增加 `description` 字段用于 select option 的说明？默认可以先不要求，description 可由 `label` 和 `model` 派生。
- 是否需要支持 PageUp/PageDown 或过滤搜索？当前模型候选通常较少，首版沿用 Up/Down 即可。
