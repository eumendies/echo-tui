## Why

当前 TUI 只有普通 agent 执行模式：模型可以在同一轮中规划、读取、调用工具并执行变更。用户需要一个低风险的 plan mode，用来让模型先做只读探索和方案规划，同时明确禁止修改文件、运行写操作或执行计划。

## What Changes

- 新增本地 slash 命令 `/plan`，支持 `/plan` toggle、`/plan on` 开启、`/plan off` 关闭。
- plan mode 为当前进程内状态，不写入 transcript、不启动 agent、不进入输入历史，也不持久化到配置文件。
- plan mode 下 status line 的 mode SHALL 显示为 `plan`，但 status line 不显示退出提示。
- plan mode 下真实 agent 请求 SHALL 注入 plan-mode system prompt，让模型知道当前只能只读探索和规划，并在用户要求执行时提示使用 `/plan off` 退出。
- plan mode 下 provider 只暴露只读工具：`glob`、`grep`、`read_files`、`web_fetch`、`web_search`、`use_skill`。写入或执行类工具 SHALL 不暴露给模型。
- 普通模式下现有工具、slash command、响应生命周期和 status line 行为保持不变。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `terminal-tui-prototype`: 修改本地 slash 命令、status line、agent lifecycle 和工具暴露要求，新增 plan mode 交互和只读工具边界。

## Impact

- 影响 app runtime 状态：需要新增当前交互模式并参与 render state/status line 派生。
- 影响 slash command handlers：新增 `/plan` handler，并加入默认 handler 和 slash suggestions。
- 影响 agent setup/runtime：需要根据 plan mode 注入 system prompt，并限制 tool registry 为只读工具集合。
- 影响 tool registry：需要提供只读 registry 或过滤能力。
- 影响测试：需要覆盖 `/plan` 命令、status line mode、plan-mode system prompt、只读工具暴露和普通模式回归。
- 影响文档：README 和架构文档需要说明 plan mode 的进入、退出和工具边界。
