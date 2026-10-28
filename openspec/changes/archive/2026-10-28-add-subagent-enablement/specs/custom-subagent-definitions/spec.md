## MODIFIED Requirements

### Requirement: 系统发现用户级与项目级自定义 Subagent
系统 SHALL 从 `~/.echo/agents/*.md` 与当前项目根的 `.echo/agents/*.md` 发现自定义 Subagent；无法确定项目根时 SHALL 使用当前工作目录作为项目级根。文件基础名 SHALL 作为稳定 Agent 名称，项目级有效定义 SHALL 覆盖同名用户级有效定义。内置 `explorer` 与 `worker` 名称 SHALL 保留且不得被自定义文件覆盖。系统 SHALL 对目录项使用确定性顺序，并 SHALL 忽略子目录、非 Markdown 文件及根目录不存在的情况。定义发现与有效性 SHALL 独立于全局启停偏好；只有按 `subagent-enablement` 规则启用且有效的胜出定义 SHALL 进入可执行目录，管理视图 SHALL 保留停用定义。

#### Scenario: 同时发现用户级与项目级定义
- **WHEN** 用户目录包含 `doc-writer.md`，项目目录包含 `security-reviewer.md`，且全局配置有效、这些名称及内置名称均全局启用
- **THEN** 当前父 assistant run 的 Subagent 目录 SHALL 同时包含两个自定义定义及内置定义
- **THEN** 每个定义 SHALL 保留其来源种类与规范化绝对来源路径供诊断使用

#### Scenario: 项目级覆盖用户级同名定义
- **WHEN** 用户级与项目级目录都包含合法的 `reviewer.md` 且该名称全局启用
- **THEN** 当前目录 SHALL 只暴露项目级 `reviewer`
- **THEN** 运行 `reviewer` SHALL 使用项目级文件的 description、能力配置和正文

#### Scenario: 内置名称不可覆盖
- **WHEN** 任一自定义目录包含 `explorer.md` 或 `worker.md`
- **THEN** 系统 SHALL 保留对应内置定义及其固定执行策略，是否进入可执行目录 SHALL 仍受全局启停配置约束
- **THEN** 系统 SHALL 为被拒绝的自定义文件产生不包含文件正文和凭据的结构化诊断

#### Scenario: 可选目录不存在
- **WHEN** 用户级或项目级 agents 目录不存在或不可读取
- **THEN** 系统 SHALL 将该来源视为空目录，并继续按启停规则提供其他有效来源与内置定义
- **THEN** 主 Agent 与 headless run SHALL NOT 因可选目录缺失而启动失败

### Requirement: 每个父 run 使用冻结且同源的 Subagent 目录
系统 SHALL 在每个 primary assistant run 初始化期间扫描并解析一次自定义文件，与内置定义合并并应用同次加载的全局启停配置，形成当前 run 的不可变可执行 Subagent 目录。停用项 SHALL 不进入可执行目录，但 SHALL 保留在管理视图中。`SubagentToolPort.listDefinitions()`、`run_subagent` 参数 enum、按名称解析和子 runtime 创建 SHALL 使用同一目录实例；当前 run SHALL NOT在委派时重新读取 Agent 文件或启停设置。文件变化 SHALL 只影响后续父 run。TUI与`--once` SHALL复用相同的发现、校验、优先级和冻结语义。

#### Scenario: Schema 与执行定义同源
- **WHEN** 父 run 已使用冻结目录生成 `run_subagent` schema并调用其中的自定义 Agent
- **THEN** Port SHALL 从同一目录取得该定义并创建子 runtime
- **THEN** 系统 SHALL NOT使用模块级可变全局目录或第二次扫描解析调用目标

#### Scenario: 运行中修改文件不改变本轮定义
- **WHEN** 父 run 初始化后自定义 Agent 文件被修改、删除或替换
- **THEN** 当前 run 后续委派 SHALL继续使用启动时冻结的定义
- **THEN** 下一父 run SHALL重新扫描并使用届时有效的目录

#### Scenario: 无效高优先级定义阻止静默回退
- **WHEN** 项目级 `reviewer.md` 无效且用户级存在同名有效定义
- **THEN** 当前 run SHALL 不暴露或执行用户级 `reviewer`
- **THEN** 目录诊断 SHALL 指向项目级无效定义，防止用户误以为项目配置已生效

#### Scenario: Headless 使用相同目录
- **WHEN** `--once` 主 Agent 调用合法的自定义 Subagent
- **THEN** 系统 SHALL使用与TUI相同的冻结目录和子 runtime协议
- **THEN** headless工具审批 SHALL继续遵守deny或显式full-access策略且不等待stdin

### Requirement: 内置 Agent 模型 override 不改变安全定义
系统 SHALL 从用户级 `~/.echo/agents.settings.json` 与项目级 `<project-root>/.echo/agents.settings.json` 读取版本化内置 Agent override。模型策略 version 2 SHALL 支持 `explorer` 与 `worker` 的可选 model profile、effort 策略和 Skill 名称 allowlist，并 SHALL 保持 description、prompt、capability、tools、MCP 和执行策略只读。模型策略读取 SHALL 支持 version 1/2，将 version 1 缺失的 Skill 策略归一化为全部 enabled Skills。项目模型策略文件 SHALL 写 version 2；用户全局文件 SHALL 写 version 3、读 version 1/2/3，并保留同文件的全局启停偏好与其他名称。删除最后一条项目 override SHALL 删除对应 sidecar；全局 sidecar SHALL 在 `enabled` 与 `overrides` 均空时可删除。

`AGENTS_SETTINGS_SCHEMA_VERSION` SHALL 为 2，`GLOBAL_AGENTS_SETTINGS_SCHEMA_VERSION` SHALL 为 3。`parseAgentsSettings(rawContent, maxSchemaVersion = 2)` SHALL 默认解析模型策略 version 1/2，全局读取 SHALL 指定上限 3。`serializeAgentsSettings(settings)` SHALL 在 `settings.schemaVersion === 3` 时保存 version 3，否则标准化为模型策略 version 2。

合法项目级同名 override SHALL 整体遮蔽用户级 override；未设置 override SHALL 保持父模型/effort 继承和全部 enabled Skills 可见。

#### Scenario: 项目级 override 生效
- **WHEN** Explorer 同时存在合法用户级和项目级 override，且全局启用
- **THEN** 当前父 run 的冻结目录 SHALL 只对 Explorer 使用项目级模型、effort 和 Skill 策略
- **THEN** Explorer 的固定只读定义、工具集合和 MCP 禁用 SHALL 保持不变

#### Scenario: 项目级 override 字段缺省
- **WHEN** 项目级 Worker override 只指定 effort 而用户级同名 override 指定 model 与 Skill allowlist
- **THEN** 项目级 override SHALL 整体遮蔽用户级条目，Worker model SHALL 继承父 profile且 Skill 策略 SHALL 恢复为全部 enabled Skills
- **THEN** 系统 SHALL NOT 把两个来源按字段拼接

#### Scenario: 高优先级 override 无效
- **WHEN** 结构合法的项目级内置 override 引用当前 snapshot 中不存在的 model profile
- **THEN** 系统 SHALL 产生有界诊断且 SHALL NOT 回退用户级同名 override
- **THEN** 对应内置 Agent 的模型和 effort SHALL 完整继承父 run且使用缺省 Skill 策略，是否可执行 SHALL 由全局启停偏好决定

#### Scenario: 读取旧版内置设置
- **WHEN** 用户级或项目级 settings 使用合法 version 1 schema并只包含 model与effort
- **THEN** 系统 SHALL 继续应用该 override且将缺失的 Skill 策略视为全部 enabled Skills
- **THEN** 下一次显式成功写入 SHALL 将项目模型策略保存为 version 2，用户全局文件保存为 version 3

#### Scenario: 设置文件不存在
- **WHEN** 用户级或项目级 agents settings 文件不存在
- **THEN** 系统 SHALL 将该来源视为空 override且不影响内置或自定义 Agent 发现

#### Scenario: 全局设置结构异常关闭委派
- **WHEN** 全局 settings 的格式、版本或安全读取状态无效
- **THEN** 系统 SHALL 按 `subagent-enablement` 规则关闭本次主运行的全部委派并给出有界诊断，而不是把内置 Agent 自动恢复为启用
- **THEN** 管理视图 SHALL 继续保留内置定义和物理自定义文件供诊断
