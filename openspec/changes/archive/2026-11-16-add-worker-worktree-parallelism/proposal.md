## Why

当前 Worker 虽有独立模型上下文和工具 registry，却共享父工作目录，因此只能独占执行，无法安全并行修改项目。需要复用现有子运行与并行调度基础，在 Git 项目中提供独立 worktree，同时让非 Git 项目保持现有串行行为。

## What Changes

- 内置 Worker 在允许普通任务执行的 Git 工作区中自动使用独立 detached worktree；同一连续 Worker 段从同一个固定 HEAD commit 启动并行任务。
- 扩展现有调度器为“屏障后异步预检、同步分类读取快照、再执行”；段级探测失败原序返回失败，单个工作区创建失败不影响其他 Worker。
- 允许父工作区有 staged、unstaged、未跟踪文件；不复制这些内容，不要求干净目录，不 stash、不自动提交，由父 Agent 负责任务依赖和最终集成。
- 非 Git 项目沿用共享 cwd 的串行 Worker；Git 不可用、仓库损坏、无有效 HEAD 或 worktree 创建失败属于明确错误，不静默降级。
- 区分项目身份与执行目录，保证文件/Bash 默认目录、适用写入边界、usage 归属和会话持久化一致。
- Worker 返回最终报告和系统生成的工作区交接信息；成果在集成前保留。父 Agent 使用既有工具审阅和串行集成，不自动 merge、commit 或 push。
- 扩展并行过程展示、用户问题排队、取消和崩溃后的工作区保留；不改变 readonly、plan、headless 和工具审批权限。
- 明确工作文件、worktree 私有 Git 目录和 common directory 的区别；不自动为 Worker Bash 开放 Git 元数据写权限，第一版不依赖暂存或提交完成任务。
- 成果留在工作区本身；登记按父 projectCwd 分区，fork 仅继承只读历史引用，不转移源工作区所有权。
- 不新增模型侧分组或 spawn/wait 协议，不实现非 Git 目录快照，不扩展自定义 general Agent 的并行资格。

## Capabilities

### New Capabilities

- `worker-worktree-execution`：Git 检测、固定基线、worktree 执行、变更交接、成果保留与非 Git 串行回退。

### Modified Capabilities

- `local-tool-execution`：增加独立工作区 Worker 并发类别、连续段屏障及结果/取消顺序，保持只读并发与权限分类分离。
- `general-purpose-worker-subagent`：分离项目身份和执行目录，隔离子工作区变更记录，保留普通执行策略。
- `readonly-subagent-delegation`：允许内置 Worker 的受管执行目录及系统生成的工作区交接信息，保留同步委派和单层边界。
- `subagent-failure-handoff`：成功或非取消失败时允许附加工作区交接，不改变失败事实与父级取消语义。
- `ask-user-questions-tool`：并行子运行的问题使用 FIFO 队列，避免后来的请求替换前一个请求。
- `bash-sandbox`：明确 Worker workspace 根、Git 元数据不自动放行及只读 Git 检查的边界。
- `bounded-tool-results`：为工作区定位与基线语义预留结果预算，报告正文按既有上限截断。
- `subagent-transcript-rendering`：持久化可选工作区事实，保证单/并行投影、旧记录和恢复时的工作区定位一致。
- `subagent-session-view`：子会话窗口展示工作区方式、基线、成果状态及历史引用归属。

## Impact

- 主要涉及 `src/agent/subagent/`、`src/agent/loop-runtime/`、工具并发分类、文件写入约束、Bash 沙箱装配与 `src/app/state/user-question-context.ts`。
- 复用现有 subagent transcript、并行 footer、工具报告离线存储、审批队列、change recorder 和 usage store；补充受管工作区登记与恢复信息。
- 受管登记独立于 session journal，稳定工作区字段使用既有 append_records 协议，不新增 journal 操作或迁移分区键；不改通用工具渲染契约。Worker 仍不注入后台任务管理器，background: true 保持执行及审批前拒绝，不扩展 background-bash-tasks 能力。
- `run_subagent` 保留 `agent`、`task` 参数，隔离方式由 runtime 决定，不允许模型指定任意工作区路径。
- 使用现有 Git CLI，不新增第三方 TUI、构建系统或数据库依赖；增加真实临时 Git 仓库和非 Git 目录的自动化测试。
- 本变更仅新增提案与规范，不实施运行时代码，不提交 Git commit。
