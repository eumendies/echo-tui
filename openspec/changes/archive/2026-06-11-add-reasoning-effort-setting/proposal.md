## Why

当前 TUI 只能选择模型，无法在支持 reasoning 的模型上调整推理强度；用户需要通过编辑配置文件才能改变速度、成本和回答深度之间的取舍。

增加模型 profile 级 reasoning effort 配置和 `/effort` 命令，可以让用户在不切换模型、不手改 JSON 的情况下明确控制当前模型的推理等级，并在 status line 上持续看到当前设置。

## What Changes

- 在 `llm.models[]` profile 上支持 `reasoning.effort` 配置，合法值为 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`。
- `readLlmConfig()` 将当前选中 model profile 的 reasoning effort 解析到运行时 `LlmConfig`。
- OpenAI Responses 请求在配置了 effort 时发送 `reasoning: { effort }`；未配置时不发送 reasoning 字段。
- 新增 `/effort` slash command，打开 scale surface 选择推理等级，并直接覆盖当前 selected model profile 的 `reasoning.effort`。
- `/effort` 不提供 `Default` 或清除选项；如果 profile 没有 effort，打开面板时默认高亮 `medium`，确认后写入 `medium`。
- status line 展示当前模型的推理等级，例如 `LLMBox GPT5.5 · effort high`；未配置 effort 时不显示 effort 片段。

## Capabilities

### New Capabilities

### Modified Capabilities
- `streaming-llm-service-adapter`: LLM 配置和 OpenAI Responses 请求支持 model profile 级 reasoning effort。
- `terminal-tui-prototype`: 新增 `/effort` 本地命令，并让 footer status line 展示当前推理等级。

## Impact

- `src/config/llm-config.ts`：解析和校验 `models[].reasoning.effort`，并把当前值放入运行时配置。
- `src/types/agent.ts`：扩展 `LlmConfig` 以携带可选 reasoning effort。
- `src/agent/openai-agent.ts`：请求 shape 增加可选 `reasoning` 字段。
- `src/app/model-context.ts` 或新的 effort context：读取当前 effort、覆盖当前 selected profile 的 effort 并原子写回配置。
- `src/commands/` 与 command resolver：新增 `/effort` handler 并注册到 slash 命令列表。
- `src/app/app-context.ts` / `src/render/footer.ts` / render state 类型：status line 增加 effort 展示信息。
- `docs/README.md`、`docs/tui-architecture.md`：更新配置示例、命令列表和 status line 说明。
- 测试：覆盖配置解析、请求构造、`/effort` 交互、持久化写回、status line 展示和错误脱敏。
