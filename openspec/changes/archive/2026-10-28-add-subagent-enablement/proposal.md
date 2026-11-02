## Why

需要在保留内置与自定义 Subagent 定义、模型策略及管理能力的前提下，按名称统一管理全局启用状态，并确保模型可见目录与实际执行边界一致。

## What Changes

- 用户级 `~/.echo/agents.settings.json` version 3 的 `enabled` 映射按名称保存全局启停，缺省开启，所有项目共用；读取支持 version 1/2/3。
- `/agents` 每个合法 Agent 一级详情提供一个“全局启用”开关及同层保存/取消；往返策略、定义编辑子表单保留草稿，子表单独立保存。
- 模型、effort、Skills 的来源优先级保持不变：项目 override 整体遮蔽用户 override，缺省继承父策略。项目模型策略文件写 version 2、读 version 1/2，用户全局文件写 version 3。
- 全局启停影响下一主运行的冻结目录，停用项不可见也不可伪造执行；空目录不注册 `run_subagent`，审批/full-access 无法绕过。
- 全局配置异常关闭委派并诊断，主运行其他能力继续可用；定义、停用项与运行记录保持可管理、可查看。
- 全局启停使用单文件原子写入及内容指纹冲突保护，同文件模型策略与启停偏好相互保留。

## Capabilities

### New Capabilities

- `subagent-enablement`：按名称全局启停、配置校验、安全写入、目录过滤及运行快照语义。

### Modified Capabilities

- `agents-command`：停用项可发现性、独立状态展示、一级详情全局开关及草稿保存/取消。
- `custom-subagent-definitions`：模型策略版本读写、候选发现和可执行目录区分。
- `readonly-subagent-delegation`：仅对启用且有效的目标开放委派，空目录不注册工具。
- `general-purpose-worker-subagent`：Worker 委派以本轮全局启用且可用为前提。

## Impact

- 涉及 `src/agent/subagent/settings.ts`、`catalog.ts`、管理存储、委派端口、工具 registry、`/agents` command port/types/handler 与 footer 投影。
- TUI、headless `--once` 和 schema-only 路径使用相同启停规则；不新增依赖，不改变审批、沙箱、子 Agent 能力上限或 transcript schema。
- 配置、目录、工具执行、管理交互及 headless 回归测试覆盖现有边界，配置与架构文档保持一致。
