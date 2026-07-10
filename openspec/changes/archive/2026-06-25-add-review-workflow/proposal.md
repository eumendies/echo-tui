## Why

Echo TUI 已具备可扩展的内置 agent workflow，但尚无稳定入口帮助用户审查当前工作区代码变更。需要提供 `/review`，让 agent 以低误报为原则，优先发现并验证正确性问题，再检查架构和代码风格问题，并按严重级别输出可执行的审查结果。

## What Changes

- 新增 `/review` 内置 agent workflow，审查当前工作区相对合适基线的代码变更。
- review 按正确性、架构、代码风格的优先级依次检查；正确性问题包括行为错误、回归、边界条件、错误处理、安全性、数据损坏和需求偏差。
- 要求 agent 在提出每个 finding 前通过代码路径、调用关系、配置、测试或可执行验证确认问题成立；证据不足时不报告，宁可漏报不要误报。
- finding 必须包含严重级别、位置、触发条件、证据和影响，并按严重级别从高到低排列。
- 没有达到报告门槛的问题时，明确输出未发现可确认问题，而不是生成推测性建议。
- `/review` 复用现有内置 workflow definition、通用 handler、普通 assistant turn、只读工具和 tool approval，不新增独立 review runtime。
- `/review` 在 plan mode 下切换到 normal mode，使 agent 能使用完整的验证工具；workflow 自身不得修改代码。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `built-in-agent-workflows`: 增加 `/review` 的命令注册、审查范围、验证门槛、严重级别和结果排序要求。
- `command-host-runtime`: 默认 slash command 集合增加 `/review` 内置 workflow，并保持其优先于同名 skill fallback。

## Impact

- 影响 `src/commands/agent-workflows/` 下的 workflow 注册和 prompt 定义。
- 更新默认 slash command、帮助信息、slash suggestions 及相关测试。
- 复用现有 `AgentWorkflowCommandHandler`、workflow metadata、mode 策略、agent loop 和工具系统。
- 不引入第三方依赖，不新增持久化格式，不改变 skill discovery 或 provider adapter。
