## Context

内置与自定义 Agent 通过一级详情的“全局启用”开关按名称统一管理，所有项目共享，缺省开启。模型、effort、Skills 策略保留既有来源优先级与管理入口。

## Goals / Non-Goals

- 一级详情提供全局开关、草稿与同层保存/取消，下一主运行生效。
- 保留模型策略配置、自定义定义创建/编辑/删除及来源诊断。
- 保持定义发现优先级、候选限额、内置安全字段、审批、取消传播与运行记录语义。

## Decisions

### 1. 全局配置与模型策略

用户级 `~/.echo/agents.settings.json` version 3 保存 `enabled` 与 `overrides`。`enabled` 以合法 Agent 名称映射布尔值；文件、映射或名称键缺失表示 true。用户全局文件读取支持 version 1/2/3；无法安全读取或结构无效时关闭本轮全部委派并输出有界诊断，主运行其他能力继续可用。

`AGENTS_SETTINGS_SCHEMA_VERSION = 2` 用于模型策略，`GLOBAL_AGENTS_SETTINGS_SCHEMA_VERSION = 3` 用于用户全局配置。`parseAgentsSettings(rawContent, maxSchemaVersion = 2)` 默认解析模型策略 version 1/2，全局读取指定上限 3。`serializeAgentsSettings(settings)` 在 `settings.schemaVersion === 3` 时保存 version 3，否则标准化为模型策略 version 2。项目模型策略文件写 version 2、读 version 1/2。

模型 override 支持内置 Explorer/Worker 的 model、effort 与 Skill allowlist；项目条目整体遮蔽用户条目，缺省继承父模型/effort 并允许全部 enabled Skills。高优先级策略异常或模型引用失效时完整继承父策略并诊断，不回退用户 override。该策略解析与全局启停分别处理。

用户模型策略写删保留同文件启停偏好及其他名称，`enabled` 与 `overrides` 均空时可删除全局 sidecar；删除最后一个项目 override 时删除对应模型策略 sidecar。

### 2. 详情草稿与独立保存

一级详情展示“全局启用”、保存更改/取消，与策略和编辑入口同层。Enter、Space 或左右键修改草稿，底部操作提示标记未保存；Esc/取消丢弃草稿。列表状态表达启用/停用，全局来源异常时开关只读，模型策略诊断单独展示。

策略、定义编辑和创建表单围绕各自字段组织；往返子表单保留全局草稿，保存子表单不顺带提交开关。全局开关保存只修改用户全局 sidecar，保留 Markdown 定义与模型策略。

显式保存模型策略提交整条 override，包括全部继承父策略的缺省值；“没有 override”和“显式继承父策略”在整体覆盖规则下不等价。未修改的自定义定义返回详情但不写文件、不提示已保存。策略来源无效时在详情入口报告有界错误。

UI 草稿与运行目录共用启停 selector，以自有属性检查避免 `constructor` 等合法名称读取对象原型。启停结果表示有效值或不可用状态，物理来源与指纹由 settings 快照提供。主工具配置读取异常只输出固定诊断并标为未知，管理入口继续可用。

保存调用单文件原子 mutation，失败保留原文件、草稿和旧指纹。用户模型策略写入/移除成功时，仅在其旧指纹与详情一致时推进全局草稿指纹，避免自身写入冲突；项目策略写入保留全局旧指纹，以检测全局文件的外部变化。

创建与删除使用默认聚焦“取消”的两项确认，上下键只在取消与目标动作间移动。删除提示优先目标绝对路径；存在同名用户定义时补充来源接替和全局启用状态的后果。

### 3. 冻结目录及信任边界

定义先按既有来源优先级和限额选择，再按全局开关过滤。全局停用某名称时，该名称的项目胜出定义不会回退同名用户定义。删除定义保留全局偏好，未知名称偏好不会创建定义，32 个自定义候选限额包含停用项。

描述符、enum、按名执行和子 runtime 共用同一主运行冻结目录；空目录不注册 `run_subagent`，schema-only 路径保持一致。伪造停用名称在 runtime/start/审批/provider 前拒绝，headless full-access 无例外。变更仅下一主运行生效，当前任务、运行记录及父取消传播保持不变。

## Risks / Trade-offs

- 全局配置异常采用 fail-closed：委派关闭，管理视图保留定义与诊断，主运行其他能力继续可用。
- 全局启停与用户模型策略共用一个文件，必须维护内容指纹并区分自身写入与外部修改。
- 运行目录按主运行冻结，保存后的状态需要下一主运行才生效。

## Open Questions

无。
