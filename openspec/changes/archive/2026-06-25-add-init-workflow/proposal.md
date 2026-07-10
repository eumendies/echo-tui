## Why

Echo TUI 已能加载项目中的 `AGENTS.md`，但缺少帮助用户首次生成或持续改进该文件的产品化入口。需要提供 `/init`，让真实 agent 基于仓库证据完成分析，同时把这类“内置命令驱动 agent 执行”的能力抽成可扩展机制，为未来 `/review` 等工作流复用。

## What Changes

- 新增 `/init` 内置 slash workflow，并通过正常 assistant turn 使用现有只读工具和 `apply_patch`。
- 当项目根不存在 `AGENTS.md` 时，分析仓库并生成该文件；写入继续遵循现有审批，undo 沿用现有 best effort 语义。
- 当项目根已存在 `AGENTS.md` 时，评估内容与仓库现状，输出有证据、按优先级排列的改进建议，不自动改写文件。
- 当 `/init` 从 plan mode 启动时，先将当前 interaction mode 切换为 normal，再启动 workflow。
- 引入轻量的内置 agent workflow 定义与通用 command handler，使后续 `/review` 等命令只需新增 workflow 定义和 prompt，而无需复制路由、模式处理和提交逻辑。
- `/init` 作为内置命令优先于同名 skill，且不进入 skill discovery、启用状态或覆盖规则。

## Capabilities

### New Capabilities

- `built-in-agent-workflows`: 定义内置 agent workflow 的注册、命令转换、模式策略、metadata，以及 `/init` 的生成和评审行为。

### Modified Capabilities

- `command-host-runtime`: 默认 slash command 集合需要注册 agent workflow handlers，并继续通过现有 `submit_user_message` 边界启动普通 assistant turn。

## Impact

- 影响 `src/commands/` 下的 slash command 装配，并新增内置 workflow 定义、prompt 和通用 handler。
- 复用 `CommandHost.mode`、`CommandStartResult.submit_user_message`、正常 agent loop、tool approval 和 undo，不新增 provider 专用分支。
- 需要更新 slash command、command runtime、app 提交链路及相关单元测试，并更新 `/help` 或用户文档中的命令说明。
- 不引入第三方依赖，不改变 skill source kind、skill registry 或 AGENTS.md 加载顺序。
