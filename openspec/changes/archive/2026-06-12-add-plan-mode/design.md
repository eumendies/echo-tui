## Context

当前 app 只有普通执行模式。用户提交普通消息后，`src/app/main.ts` 追加 user transcript record，启动 assistant turn，并通过 `RunAgent` 调用 provider-neutral agent loop。agent loop 每轮通过 `prepareAgent()` 读取配置、创建默认工具 registry、初始化 provider agent，再把 provider records 和全部工具定义交给 OpenAI adapter。

本地 slash 命令已经通过统一 command runtime 和 `CommandHost` 集成，`/model`、`/effort`、`/resume` 等命令不进入 transcript、不启动 agent。status line 当前只展示 `idle`、`command`、`thinking`、`streaming`、`tool` 等 transient 状态。plan mode 需要同时影响 slash command、运行时状态、status line、system prompt 和工具暴露边界，因此是跨模块变更。

## Goals / Non-Goals

**Goals:**

- 提供 `/plan`、`/plan on`、`/plan off` 切换当前进程内 plan mode。
- plan mode 下 status line mode 显示为 `plan`，但不在 status line 展示退出说明。
- plan mode 下模型可使用只读工具探索代码和资料，但不能获得写入或命令执行工具。
- plan mode 下给 provider input 注入 system prompt，说明只读规划语义和 `/plan off` 退出方式。
- plan mode 开关不写 transcript、不进入输入历史、不启动 agent、不持久化配置。
- 普通模式下现有工具和响应生命周期保持不变。

**Non-Goals:**

- 不引入权限审批替代 plan mode；plan mode 中写入工具不应出现，而不是出现后再审批。
- 不把 plan mode 持久化到 `~/.echo/config.json`。
- 不增加复杂 mode selector UI；第一版只做 `/plan` 命令。
- 不允许 plan mode 通过 bash 白名单执行只读 shell 命令；第一版完全不暴露 bash。
- 不把 `/plan off` 写入 status line key hint；退出方式由 system prompt 指导模型在需要时提示用户。

## Decisions

### 使用 `/plan` slash command 控制进程内模式

新增 `PlanCommandHandler`。匹配规则只接受纯 `/plan`、`/plan on`、`/plan off`，其他 `/plan ...` 打开 info surface 或回退普通消息需在实现时保持一致的本地命令语义。推荐语义是 `/plan` toggle，`/plan on/off` 显式设置。

handler 通过 `CommandHost` 调用 app mode 能力，例如 `host.mode.getInteractionMode()` 和 `host.mode.setInteractionMode(mode)`。这样 command runtime 仍只负责路由和 session，具体 app 状态由 AppContext 管理。

### 在 AppContext 持有 interaction mode

AppContext 新增 `interactionMode: 'normal' | 'plan'` 或独立 `ModeContext`。这是当前进程内状态，不参与 transcript persistence。`createRenderState()` 根据该模式派生 status line。

status line mode 应扩展为 `plan`。当没有 active command surface 且没有 pending/tool 状态时，plan mode 显示 `plan`；当 assistant 正在 thinking/streaming/tool 时，仍可显示对应 transient mode，或保留 `plan` 作为更高优先级。建议第一版让 `plan` 覆盖 idle，但不覆盖 thinking/streaming/tool，以免响应中状态丢失。

### agent session 显式携带 interaction mode

`AgentSessionInput` 增加 `interactionMode` 或 `planMode` 字段，由 app 在调用 `runAgent()` 时传入。agent loop 根据该字段决定工具 registry 和 plan-mode system prompt。

不要让 agent loop 直接读取 AppContext；保持 provider-neutral runtime 仍由输入 session 和依赖决定行为。测试也可以直接构造 plan-mode session 验证工具过滤和 provider records。

### 使用只读工具 registry，而不是运行时拦截写工具

新增工具 registry 过滤能力或 `createReadOnlyToolRegistry()`，只包含：

- `glob`
- `grep`
- `read_files`
- `web_fetch`
- `web_search`
- `use_skill`

不包含 `run_bash_command`、`apply_patch`、`ask_user_questions`。`ask_user_questions` 不暴露的原因是模型可以直接在回复里提问，减少 plan mode 中额外交互 surface 和状态复杂度。若以后需要结构化提问，可作为后续扩展。

相比在 tool executor 层拒绝写工具，直接不暴露工具定义更符合“模型只能看到只读能力”的安全边界，也能减少 provider 产生不可执行 tool call 的概率。

### 注入 plan-mode system prompt

plan mode 下 provider input 应包含一段本地 system prompt，内容说明：

- 当前是 plan mode。
- 可以只读探索、搜索、读取文件和资料、比较方案、提问、给出计划。
- 禁止修改文件、应用 patch、提交 commit、安装依赖、运行会改变系统的命令或执行计划。
- 如果用户要求实现、修改、提交或执行，模型应说明需要先退出 plan mode。
- 退出方式是 `/plan off`。

该 prompt 应进入 provider request，不写入 app transcript、不持久化到 session。实现位置可以在 `buildProviderRecords()` 附近，和现有内置 system prompt/skill catalog 注入保持同一边界。

### `/plan` 的用户反馈使用本地 notice 或 info surface

切换成功后不启动 agent。可以直接打开短暂 info surface，也可以追加本地 notice。为了“不写 transcript”的约束，建议使用 info surface 或 footer local notice 形式；现有 command surface 已成熟，第一版可用 `info` surface 显示“Plan mode enabled / disabled”，Esc 关闭。也可以在切换后直接关闭命令并通过 status line 体现，具体实现以不污染 transcript 为原则。

## Risks / Trade-offs

- [Risk] status line 中 `plan` 与 thinking/streaming/tool 状态优先级不清。→ Mitigation: 规格明确 plan 只替代 idle，响应进行中仍显示 transient mode；普通输入态恢复后显示 plan。
- [Risk] 模型可能在 plan mode 中仍返回未暴露工具的 tool call。→ Mitigation: 因 provider 不应看到写工具定义，概率较低；runtime 若收到未知 tool call，按现有 unknown tool failure 处理，并保持不执行。
- [Risk] 只读工具列表遗漏未来新增只读工具。→ Mitigation: 用显式 allowlist，并在新增工具时要求判断是否加入 plan allowlist。
- [Risk] 不暴露 bash 会降低探索便利性。→ Mitigation: 保持第一版边界简单安全；后续可单独设计只读 shell 或安全命令工具。
- [Risk] system prompt 和工具过滤分散在不同模块。→ Mitigation: agent session 中显式传 mode，agent setup/runtime 统一派生 prompt 和 registry，测试覆盖同一入口。

## Migration Plan

无需数据迁移。plan mode 是进程内状态，重启后回到 normal。已有 transcript session 不变；恢复历史后是否处于 plan mode 由当前进程状态决定。

## Open Questions

- `/plan something` 应该显示用法错误 surface，还是作为普通消息提交？倾向显示用法错误 surface，因为 `/plan` 是明确本地命令前缀。
- 切换成功后是否自动关闭 command surface，仅依赖 status line 显示模式？如果要减少交互摩擦，倾向切换后直接回到 composer，并让 status line 显示 `plan`。
