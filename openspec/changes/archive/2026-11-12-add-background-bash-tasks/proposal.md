## Why

构建、测试和开发服务器等长时间 Bash 命令目前会占用一次工具调用，模型必须等命令结束才能继续工作。需要让命令在当前交互会话内后台运行，并把日志和确定的执行状态写入文件，让模型复用 `read_files` 查询结果。

## What Changes

- 为现有 `run_bash_command` 增加可选 `background` 布尔参数；省略或为 false 时保持前台行为，为 true 时成功启动后立即返回任务 ID、日志与状态文件绝对路径。
- 新增会话级后台任务管理，持续写入 `output.log` 与原子更新的 `status.json`；模型工具数量不变，不新增查询、等待或停止工具。
- 提供本地 `/tasks` 列表与详情、日志快照和手动刷新、停止操作；合并当前实例条目与当前 session 持久化任务引用展示历史，结束时显示本地通知；通知不自动调用模型。transcript 只投影启动事实，底栏第一版不展示任务数量。
- 明确后台任务与 turn 中断、会话切换、退出、历史恢复及 `/undo` 的关系，保留现有权限分类和沙箱边界。
- 第一版仅支持交互式主会话的后台工具调用；headless、子 Agent、BTW/readonly run 拒绝后台请求。普通前台执行继续遵循原策略。

## Capabilities

### New Capabilities

- `background-bash-tasks`: 基于文件查询的后台任务协议、运行管理、日志限制、生命周期、通知与 `/tasks` 本地交互。

### Modified Capabilities

- `local-tool-execution`: 扩展 Bash schema 与启动结果语义，区分前台取消和后台任务取消；后台启动作为独占调度调用。
- `undo-command`: 对可能写入工作区的后台任务增加跨轮保护，禁止后台写入期间产生可安全回退的假象。

## Impact

- `src/tools/bash-command-runner.ts`、`bash-tool-handler.ts`、registry、风险与并发分类、工具结果类型和任务引用消费投影；现有 Bash journal 校验与工具调度器保持不变。
- `src/app/` 的运行上下文、turn/会话切换、可等待的退出/自动更新清理、undo 查询及执行端口、command host，及 `/tasks` 命令与后台结果渲染投影。
- 用户级项目分区内的后台任务文件；沿用 Node.js 子进程、ANSI 与现有文件读取能力，无新增依赖、PTY 或常驻 daemon。
- 更新相应自动化测试与用户文档；不改变现有前台命令、shell/shell-local 输入方式和 provider 工具名称集合。
