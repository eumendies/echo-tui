## Why

当前用户需要手动编辑 `~/.echo/config.json` 才能在不同模型或 provider profile 之间切换。随着真实 LLM adapter 已经成为默认对话路径，模型切换应成为本地 TUI 内可发现、可操作且可持久化的能力。

## What Changes

- 扩展用户级 `~/.echo/config.json` 的 LLM 配置 schema，支持多个模型 profile。
- 将 `/model` 从只读 `info` command surface 改为 `select` command surface，允许用户通过 Up/Down/Enter 选择模型，Esc 取消。
- 选择模型后将当前选择持久化到 `config.json`，后续普通消息请求由真实 LLM adapter 读取并使用新的生效模型。
- 模型 profile 可继承顶层 `apiKey` / `baseURL`，也可覆盖这些 provider 配置，以支持同 provider 多模型和跨 provider 切换。
- 配置读取、写入和错误反馈继续保持敏感字段脱敏；`/model` 不启动真实 agent，也不写入 transcript。
- Breaking change：LLM 配置需要使用 `llm.models` / `llm.selectedModel`；旧的 `llm.model` 不再作为生效模型读取。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `streaming-llm-service-adapter`: LLM 配置读取改为从多 profile 和持久化选择解析当前生效模型。
- `terminal-tui-prototype`: `/model` 命令从只读模型信息面板变为模型选择 command surface，并在确认后持久化所选模型。

## Impact

- `src/agent/llm-config.ts`: 解析多模型 profile 配置，提供安全配置错误。
- `src/types/agent.ts`: 必要时扩展 LLM 配置类型以表达 profile 解析结果。
- `src/app/model-context.ts`: 为 `/model` 提供模型列表、当前选择和持久化选择能力。
- `src/commands/model-command-handler.ts`: 复用现有 `select` surface 模式处理模型选择交互。
- `src/types/command.ts` / `src/commands/command-effects.ts` / `src/app/command-runtime.ts`: 如需要把持久化动作放入统一 effect interpreter，扩展对应 effect；若 handler 通过注入 context 完成写入，则保持现有 effect surface。
- `test/agent`、`test/app`、`test/commands`、`test/render` 相关测试需要覆盖多 profile 配置、选择交互、持久化写入和错误展示。
- `docs/README.md`、`docs/tui-architecture.md` 和相关 OpenSpec 主规格需要更新配置示例与 `/model` 行为说明。
