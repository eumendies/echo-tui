## Context

当前 Subagent 定义把模型、effort、本地工具、MCP 可见性和执行策略冻结在父 assistant run 的目录中，但 Skill 只有一个布尔层面的入口：定义包含 `use_skill` 时，子 Agent 可以按名称加载当前全局 enabled Skill。父 loop 把已按父模型窗口裁剪的 catalog 传给子 loop，子 loop 的工具 registry 却重新创建 SkillManager，因此 catalog 宣传、实际加载结果、运行中配置变化和不同模型窗口之间缺少同源保证。

该变更横跨 Subagent manifest/settings、运行时 Skill 发现与工具装配、父子 loop 协议及 `/agents` 管理 surface。设计必须维持现有约束：单次 primary run 配置冻结、项目级覆盖用户级、严格 manifest、内置安全字段不可修改、无第三方 TUI 依赖，以及 interactive/headless 相同的执行边界。

## Goals / Non-Goals

**Goals:**

- 允许每个内置或自定义 Subagent 选择全部、零个或指定名称的 enabled Skills。
- 让子运行 system prompt 中的 Skill catalog 与 `use_skill` 实际可加载集合完全一致。
- 让 Skill 发现、启用状态、正文和资源在一次 primary run 中保持稳定，后续委派不重新扫描。
- 让 Subagent 根据自身模型 context window 独立执行 catalog 预算投影。
- 通过 `/agents` 安全管理 Skill 策略，并保留暂时 disabled 或缺失的配置名称。
- 兼容没有 `skills` 字段的已有 Agent manifest 和 version 1 内置 settings。

**Non-Goals:**

- 不自动预加载 allowlist 中的 Skill 正文；模型仍须按需调用 `use_skill`。
- 不改变 `/skills` 的全局 enabled/disabled 状态、Skill 来源覆盖规则或直接 slash 调用行为。
- 不允许 Skill 配置授予 `use_skill`、文件、Bash、MCP 或其他工具能力。
- 不把 Skill allowlist 作为文件系统保密或沙箱边界；拥有文件/Bash 工具的 Agent 仍受对应工具既有路径和审批策略约束。
- 不为 Skill 名称增加来源锁定；名称继续解析为当前运行快照中按 project、user、builtin 优先级胜出的定义。

## Decisions

### 1. 使用三态名称 allowlist，并保持旧配置语义

领域模型在 `SubagentDefinition`、自定义 manifest 和内置 override 中使用可选 `skillNames`：

- `undefined`：允许父运行快照中的全部 enabled Skills；
- `[]`：明确不允许任何 Skill；
- 非空数组：仅允许名称命中的 enabled Skills。

外部 manifest 字段名为 `skills`，使用与 `tools` 相同的缩进字符串序列语法。字段可省略以保证旧 manifest 继续表示“全部 enabled Skills”；序列存在但无条目时保留为空数组。名称执行非空、有界、无控制字符和重复项校验，但引用在当前项目中不存在或 disabled 的 Skill 不使 Agent 定义失效，而是在 effective 集合中省略并提供管理诊断。这样用户级 Agent 可以安全引用只在部分项目存在的 Skill。

备选方案是把未知 Skill 判定为整个 Agent 无效。该方案更严格，但会让跨项目用户级 Agent 因项目 Skill 缺失而不可委派，因此不采用。

### 2. 内置 settings 升级为 version 2，并兼容 version 1

`agents.settings.json` 的内置 override 增加可选 `skills` 数组。读取端接受 version 1 的仅 model/effort 结构并归一化为 `skillNames: undefined`；写入端输出 version 2。Project override 仍然整体遮蔽 User override，不做字段级合并，因此项目条目省略 `skills` 表示该项目恢复“全部 enabled Skills”，而不是继承用户条目的 allowlist。

内置 prompt、capability、本地工具、MCP 和执行策略仍不可配置。Skill allowlist 只收窄 `use_skill` 能加载的数据，不改变工具集合和风险边界。

备选方案是在 manifest/settings 之外创建独立映射文件。该方案会引入第二套来源、冲突和原子写协议，也会让 `/agents` 无法保存单一完整策略，因此不采用。

### 3. 父运行捕获完整 Skill registry snapshot

父 assistant run 初始化时从同一个 SkillManager 物化不可变 snapshot，包含当时 enabled 且按既有来源优先级胜出的 catalog、正文、资源和加载元数据。Primary provider catalog、Primary `use_skill` handler 与所有后续 Subagent scope 都从该 snapshot 派生。运行中执行 `/skills`、修改 `SKILL.md` 或替换资源只影响下一次 primary run。

Agent/tool 装配允许显式注入 `SkillRegistry`，而不是由每个 `createDefaultToolRegistry` 无条件重新扫描。共享 snapshot 不持有 provider continuation、Todo 或 transcript 状态，因此不会破坏子 runtime 隔离。

备选方案是让每个子 runtime 重新创建 SkillManager。它实现简单，但不能保证 prompt、handler 和运行 revision 一致，故不采用。

### 4. 通过 scoped SkillRegistry 同时过滤 catalog 和加载

每次子运行根据定义的三态策略和 `localToolNames` 创建只读 scoped registry：

1. 若不存在 `use_skill` 本地工具，effective registry 恒为空；
2. 若 `skillNames` 未设置，暴露 snapshot 中全部条目；
3. 否则只暴露 allowlist 与 snapshot enabled 名称的交集。

scoped registry 的 `listCatalog()` 和 `loadSkill(name)` 使用同一个允许名称集合。对未授权、disabled 或不存在名称的加载返回失败，并且失败结果中的 available Skills 也只列出当前 scope，避免通过错误消息泄露被隐藏目录。provider tool schema 仍只有一个 `use_skill` 工具，不为每个 Skill 创建独立工具。

只过滤 prompt 而不限制 handler 会被猜测名称绕过；只过滤 handler 又会诱导模型调用不可用 Skill，因此两种方案均不采用。

### 5. Subagent 使用自身窗口生成一次 catalog 投影

父子运行协议传递完整 snapshot 或可从其建立 scope 的 registry，不再传递父模型已裁剪的 `skillCatalogProjection` 作为子请求事实。子 runtime 在最终 LLM config 和 context window 解析后，用 scoped catalog 与同一 run 的 `skillCatalogContextRatio` 调用 `createSkillCatalogPromptProjection()`，并在该子运行所有 continuation 中复用结果。

Primary run 继续用自己的 context window 生成独立投影。这样不同模型既不会继承过度截断的父 catalog，也不会超过自己的预算。

### 6. `/agents` 使用独立 Skills 多选层管理策略

Agent 管理 snapshot 增加当前发现 Skill 的名称、来源与 enabled 状态。自定义和内置表单都增加 `Skills` 字段，进入独立多选层：

- 提供“全部 enabled Skills”策略选项；
- 关闭该选项后允许逐项选择；
- 零项选择表达显式空 allowlist；
- 已配置但当前 missing/disabled 的名称继续显示为不可用配置项，可被用户移除，保存时不得静默丢失；
- 列表和详情显示 `all skills`、`no skills` 或选中数量摘要。

Custom 表单仍由管理存储复用 runtime parser 和策略校验；Builtin 表单继续通过版本化 sidecar、完整文件指纹与原子替换写入。保存只影响下一次 primary turn。

## Risks / Trade-offs

- **[Skill 名称被项目级同名定义覆盖]** → allowlist 明确按名称授权当前 effective Skill，并在 UI 展示来源；沿用现有 Skill 名称解析规则，避免引入不可移植的绝对路径身份。
- **[配置引用长期缺失导致误判]** → 不扩大权限，effective 集合只取 enabled 交集；`/agents` 保留并标记 stale 名称，便于修复。
- **[完整 snapshot 增加内存占用]** → Skill registry 当前发现阶段已经读取正文和资源索引；snapshot 复用有界目录并仅复制结构，不在每个子运行复制正文。
- **[version 2 被旧版本拒绝]** → 新版本兼容读取 version 1；回滚到旧程序前需移除 `skills` 配置或恢复 version 1 sidecar。
- **[无 `use_skill` 工具却配置 Skills]** → runtime 始终返回空 effective catalog，管理界面显示策略未生效提示；不自动增加工具，避免配置侧向提权。
- **[被隐藏 Skill 仍可通过文件工具读取]** → 文档和 UI 将该功能描述为 `use_skill` 暴露 allowlist；真正的文件保密需要独立的跨工具路径 ACL，不纳入本变更。

## Migration Plan

1. 先扩展 parser 读取旧 manifest 和 settings version 1，并为缺省 Skill 策略建立向后兼容语义。
2. 引入 snapshot/scoped registry 和注入式工具装配，使未配置 allowlist 时行为保持不变。
3. 接入 Subagent 独立 catalog 投影，再开放 manifest、settings 写入和 `/agents` UI。
4. 新版本首次保存内置 override 时将 sidecar 规范化为 version 2；自定义 manifest 仅在用户保存时按新 serializer 输出。
5. 回滚时，未使用新字段的文件无需处理；使用 `skills` 的 manifest 和 version 2 settings 需要移除新字段或从版本控制恢复。

## Open Questions

无。实现按“缺省全部、空列表禁止全部、名称按当前 effective 来源解析、缺失引用不使 Agent 失效”的语义执行。
