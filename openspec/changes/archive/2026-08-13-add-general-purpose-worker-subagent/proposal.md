## Why

现有 `explorer` 只适合只读调查，无法替主 Agent 独立完成需要编辑、Todo、用户澄清或 MCP 的通用开发任务。新增 `worker` 后，主 Agent 可以把一个自包含子任务交给隔离运行的通用执行者，同时继续保持单层委派、审批安全和父子状态隔离。

## What Changes

- 在动态 Subagent 定义目录中新增 `worker`，让主 Agent 可通过 `run_subagent(agent: "worker", task)` 同步委派通用任务。
- Worker 获得除 `run_subagent` 外的主 Agent 工具能力：本地读写、Bash、Web、Skill、独立 Todo、`ask_user_questions` 和已初始化 MCP tools。
- Worker 使用独立 transcript、Todo、compaction、provider continuation 和 registry；共享父运行捕获的配置、cwd、AGENTS、memory、skill catalog、MCP manager、审批会话缓存、用户交互 surface 和 change recorder。
- Worker 继承父 interaction mode：normal 使用主 Agent 风险分类，plan 继续拒绝写入、非只读 Bash 和 MCP；headless 沿用 deny/full-access，不等待用户问题输入。
- 扩展 Subagent callback/activity 协议以支持 Worker 用户问题，并用 run identity 隔离迟到问题、答案、审批和工具结果。
- 自动审批上下文加入不可信的 Worker 委派任务，并把用户通过 Worker 问题 surface 提交的答案作为经校验的可信澄清；委派任务本身不得扩大用户授权。
- 去除 `run_subagent` 外层工具和结果投影中的 Explorer 硬编码，按实际 Agent 名称显示 Worker/Explorer 状态。
- 新增 blocks 级 `subagentRail` 专属主题 token：子 Agent 外层 rail、marker 与标题不再借用顶层 `tool` 强调色；代码内默认值与全部内置主题 JSON 同步提供该 token，用户 `theme.json` 按现有 blocks token 规则覆盖。
- 保持单层委派：Explorer 与 Worker 均不获得 `run_subagent`。

## Capabilities

### New Capabilities
- `general-purpose-worker-subagent`: 定义 Worker 的完整工具能力、独立运行状态、Todo、用户问题、MCP、审批、mode/headless 语义和单层委派边界。

### Modified Capabilities
- `readonly-subagent-delegation`: 将 Subagent 目录从仅 Explorer 扩展为 Explorer 与 Worker，并把通用委派、定义和 runtime 契约与 Explorer 专属只读策略分开。
- `subagent-transcript-rendering`: 增加 Worker 用户问题活动和动态 Agent 身份投影，保持稳定过程、恢复和迟到回调隔离。
- `ask-user-questions-tool`: 允许 Worker 通过共享 choice surface 向用户提出必要问题，并在 headless 或陈旧运行中安全取消。
- `automatic-tool-approval`: 审批 reviewer 纳入 Worker 委派上下文与 Worker 问题答案，同时维持严格信任边界。
- `mcp-tool-integration`: 允许 Worker 通过独立 registry 复用主运行已初始化的 MCP manager 和审批策略。
- `footer-theme-config`: blocks 主题 token 集合新增 `subagentRail` 专属 token，并同步代码默认值、内置主题 JSON 与用户 override 合并规则。

## Impact

- 主要影响 `src/agent/subagent/`、`src/agent/loop-runtime/subagent-loop-runtime.ts`、工具 registry/risk classifier、MCP 装配、App 用户问题与审批桥接、Subagent transient state、工具渲染、主题配置与内置 theme JSON。
- `SubagentDefinition`、`SubagentLoopCallbacks`、`SubagentActivity` 等内部类型会扩展；`run_subagent` 的公开参数结构不变，但 `agent` enum 新增 `worker`。
- 不引入新依赖，不改变 MCP 连接生命周期，不允许递归 Subagent。
