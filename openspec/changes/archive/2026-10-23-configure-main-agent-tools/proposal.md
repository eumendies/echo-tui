## Why

目前主 Agent 固定暴露内置工具及已连接的 MCP tools，用户无法按使用习惯精简工具集合；文件编辑又由单独的二选一配置控制。需要统一的主 Agent 工具选择入口，同时保证 Bash 始终可用，并让工具暴露与实际执行范围一致。

## What Changes

- 在 `/config` 新增“工具”Tab，明确配置对象为主 Agent；不将主 Agent 加入 `/agents`。
- 按工具名称提供开关，覆盖内置工具、MCP 资源读取工具及当前发现的 MCP tools。`run_bash_command` 固定开启，不允许用户禁用；`create_todos` 与 `complete_todo` 合并为一个 Todo 项，必须同时启停，其他工具独立选择。
- 将 `apply_patch` 与 `edit_file` 作为两项独立开关，允许同时开启或同时关闭；`disabledTools` 缺失默认 `[]`，两个编辑工具及其他可用工具默认开启。
- 移除“常规”Tab 中的文件编辑方式配置项，完全停止读取旧 `tools.fileEdit.mode`，移除内部 `fileEditMode` 与 `includeBothFileEditTools`；不再为任何运行保留编辑工具二选一兼容策略。
- 公共工具工厂始终构造两个编辑工具，由主 Agent 的 `disabledTools` 和子 Agent 的 `allowedToolNames` 分别筛选。Worker 的 definition 仅保留 `apply_patch`，不暴露或执行 `edit_file`；Explorer 仍无编辑工具，自定义 Agent 继续自身白名单；保留 `main-agent-tool-catalog` 作为配置页未过滤候选目录。
- 通过用户级 `tools.mainAgent.disabledTools` 持久化禁用项；只影响后续主 Agent 运行，包含 TUI 和 `--once`，不自动收窄或扩大 subagent 工具集合。
- 从 provider definitions 和执行入口同时移除禁用工具，包括 Todo、提问和委派等特殊执行分支；工具开关不能被审批授权或 `--full-access` 覆盖。
- 保持现有审批、沙箱、interaction mode、MCP 连接配置和用户主动执行的 slash/local 操作不变。这是工具选择功能，不是文件、网络或命令权限隔离。

## Capabilities

### New Capabilities

- `main-agent-tool-selection`：主 Agent 工具目录、独立开关、Bash 必选、默认空禁用名单、运行快照及主／子运行边界。

### Modified Capabilities

- `config-surface-settings`：新增工具 Tab，纳入分域保存和统一草稿保护，移除常规文件编辑方式设置。
- `local-tool-execution`：主 Agent 文件编辑工具由独立开关决定，工具装配与调用执行受同一集合约束；normal/plan 在同一配置下仍保持相同 schema。
- `general-purpose-worker-subagent`：Worker 通过自身 definition 仅暴露 `apply_patch`，拒绝 `edit_file` 调用，不继承主 Agent 禁用名单；Explorer 和自定义 Agent 继续遵守自身白名单。
- `streaming-llm-service-adapter`：各 provider 根据已筛选的 registry 投影零个、一个或两个文件编辑工具，不再假定主 Agent 文件编辑工具互斥。
- `skill-system`：自动 Skill 目录注入以当前运行注册 `use_skill` 为前提，主运行禁用该工具不影响子运行的独立 Skill snapshot 与 scope。

## Impact

- 配置：`src/config/`、`src/types/` 中的工具配置解析、snapshot、草稿及原子写入；常规设置不再拥有文件编辑方式字段。
- UI：`src/commands/config/`、command host/port 与配置 surface/render 的工具页、导航、草稿保护和高度预算。
- 运行：`src/tools/tool-registry.ts`、`src/agent/agent-setup.ts`、主 agent loop 的特殊工具分支、provider schema 和 context usage 快照失效处理。
- 配置保留：读盘不迁移；工具页保存只写本页字段，旧 JSON 字段可作为未识别数据保留但不再读取或主动清理。子 Agent 不继承主 Agent 开关，也不再读取旧编辑模式。
- 验证：增加配置解析、旧字段无效且不迁移、UI controller、registry/executor、特殊工具分支、provider、headless 与 subagent 隔离测试；更新用户配置文档。不新增依赖，不改变终端渲染架构。
