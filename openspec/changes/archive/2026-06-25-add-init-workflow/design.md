## Context

当前 slash command 分为两类：纯本地命令通过 `CommandHost` 直接操作 app 状态；direct skill invocation 则返回 `submit_user_message`，由 app 继续走普通 assistant turn。`/init` 需要读取大量仓库上下文、调用多个只读工具，并可能通过 `apply_patch` 创建文件，因此不适合在 command handler 内直接实现分析逻辑。

Skill 系统目前只发现用户级和项目级 skill，并允许项目级同名覆盖、通过 `/skills` 禁用。`/init` 是稳定的产品命令，不应受这些规则影响。与此同时，未来 `/review` 等命令也会需要“内置 slash 命令转换为带专用 prompt 的普通 agent turn”这一相同机制。

## Goals / Non-Goals

**Goals:**

- 提供内置 `/init`，基于当前仓库证据生成或评审项目根 `AGENTS.md`。
- 复用普通 agent loop、工具注册、审批、streaming、transcript 和 best effort undo，不建立第二套 agent 执行路径。
- 已有 `AGENTS.md` 时只输出改进建议，不自动覆盖。
- `/init` 从 plan mode 启动时先切换到 normal，使本轮能够申请 `apply_patch`。
- 建立小而明确的内置 agent workflow 定义和通用 handler，为未来 `/review` 复用。

**Non-Goals:**

- 本次不实现 `/review` 或通用用户自定义 workflow。
- 不新增 builtin skill source kind，不改变 skill discovery、覆盖或启用状态。
- 不解析 `AGENTS.md` 为结构化配置，也不保证所有仓库都能推断出完整开发规范。
- 不支持 `/init` 参数、自动覆盖已有文件或无审批写入。

## Decisions

### 1. 使用内置 agent workflow，而不是 builtin skill

新增轻量 `AgentWorkflowDefinition`，至少包含命令名、描述、参数策略、mode 策略和 prompt factory。默认 slash command 装配将每个定义转换为通用 `AgentWorkflowCommandHandler`，并把这些 handlers 放在 `SkillInvocationCommandHandler` 之前。

这样 `/init` 始终是产品内置命令，不会被 `/skills` 禁用，也不会被 `.echo/skills/init/SKILL.md` 覆盖。未来新增 `/review` 时只需新增 definition、prompt 和注册项。

备选方案是引入 builtin skill source。该方案会迫使 skill registry、source kind、覆盖优先级、状态保存和 `/skills` UI 同时扩展，且会把稳定命令暴露给禁用和覆盖机制，因此不采用。

### 2. 通用 handler 只负责路由策略，不负责仓库分析

通用 handler 解析命令和可选参数，根据 workflow 定义应用 mode 策略，然后返回现有 `submit_user_message`：

- `text` 为 workflow prompt。
- `historyText` 和 `displayText` 保留用户输入，例如 `/init`。
- metadata 记录 `agentWorkflow.source = "builtin"`、workflow 名称和可选参数。

仓库分析、文件读取和写入由正常 agent loop 完成。`CommandRuntime` 不增加 workflow effect，不执行 agent streaming，也不感知 `/init` 业务。

prompt 独立放在 workflow 模块中，不嵌入通用 handler。首版定义支持无参数与可选参数两类匹配策略，足以覆盖 `/init` 和未来可能接收 review scope 的 `/review`，不预先设计插件系统或复杂生命周期。

### 3. `/init` 仅在 plan mode 下自动切换 normal

`/init` definition 使用 `switch_plan_to_normal` 策略。handler 在返回提交结果前通过 `CommandHost.mode` 检查当前 mode；仅当 mode 为 plan 时调用 `setInteractionMode("normal")`。

随后 app 在同一次提交中启动 assistant turn，而 `AppContext.getAgentSession()` 会读取更新后的 mode，因此 agent runtime 无需增加特殊参数或重载逻辑。normal、shell 和 shell-local 不做额外切换。

自动切换是持久的当前进程状态，不在 workflow 完成后恢复 plan。恢复会使用户误以为当前仍允许写操作，且需要引入跨异步 turn 的额外状态管理。

### 4. `/init` 通过专用 prompt 决定生成或评审路径

prompt 要求 agent：

1. 根据当前工作目录和项目 marker 确定目标项目根，并检查根目录 `AGENTS.md`。
2. 优先使用 `glob`、`grep`、`read_files`，必要时使用只读 bash 检查 package 配置、源码结构、测试、文档和既有约束；不得为了保证 undo 而限制必要分析。
3. 只采用能从仓库验证的事实，不猜测命令或规范。
4. 若文件不存在，生成简洁的 `AGENTS.md`，并使用 `apply_patch` 新建；审批沿用现有机制，undo 仅在本轮 checkpoint 仍可安全追踪时 best effort 提供。
5. 若文件存在，读取并对照仓库现状，输出按优先级排列、带证据和建议文案的改进项；不得调用 `apply_patch` 修改该文件。
6. 完成新建后说明新指令从下一次 agent run 开始加载。

存在性判断放在 agent workflow 内，而不是 command handler 内。handler 若自行读文件会扩大 `CommandHost` 文件系统能力，并仍无法替代后续仓库分析。

### 5. workflow metadata 与 skill metadata 分离

workflow user record 使用独立 `agentWorkflow` metadata，不伪装成 `skillInvocation`。这保留 transcript 可观测性，也让未来统计或恢复 workflow 使用时有稳定识别字段，同时不污染现有 skill 使用记录。

首版只负责写入 metadata，不新增 workflow 历史查询 UI。

## Risks / Trade-offs

- [模型可能遗漏仓库证据或不严格遵守已有文件只评审规则] → prompt 明确列出决策顺序、允许和禁止动作，并增加 prompt 内容单元测试；文件写入仍需用户审批。
- [自动切换 normal 改变用户后续 mode] → 只在 plan 下切换，并在 `/init` 的可见执行结果或文档中明确该行为。
- [通用 workflow 抽象过早膨胀] → 首版只抽取 definition、匹配、mode 策略、metadata 和提交结果，不增加 hook、事件总线、独立 registry class 或 provider 分支。
- [从子目录启动时目标根判断错误] → prompt 要求优先使用最近 `.git` 或项目 `.echo` marker，并在写入前明确目标路径；`apply_patch` 审批预览继续暴露目标文件。
- [新建 AGENTS.md 不影响当前 run] → agent loop 每轮初始化时加载指令，workflow 完成时明确提示从下一轮开始生效。

## Migration Plan

该变更为向后兼容增量。注册 `/init` 后，同名项目或用户 skill 的 direct slash invocation 将被内置命令优先匹配，但该 skill 仍可由模型通过 `use_skill` 加载。若需回滚，可移除 workflow 注册和相关模块，不涉及持久化数据迁移。

## Open Questions

- 未来 `/review` 的默认 mode 策略应结合其是否允许自动修复单独决定，不在本次固化。
- 后续若 workflow 数量明显增长，再评估是否需要独立 catalog 或帮助分组；首版沿用现有 slash descriptor 聚合。
