## ADDED Requirements

### Requirement: 系统发现用户级与项目级自定义 Subagent
系统 SHALL 从 `~/.echo/agents/*.md` 与当前项目根的 `.echo/agents/*.md` 发现自定义 Subagent；无法确定项目根时 SHALL 使用当前工作目录作为项目级根。文件基础名 SHALL 作为稳定 Agent 名称，项目级有效定义 SHALL 覆盖同名用户级有效定义。内置 `explorer` 与 `worker` 名称 SHALL 保留且不得被自定义文件覆盖。系统 SHALL 对目录项使用确定性顺序，并 SHALL 忽略子目录、非 Markdown 文件及根目录不存在的情况。

#### Scenario: 同时发现用户级与项目级定义
- **WHEN** 用户目录包含 `doc-writer.md`，项目目录包含 `security-reviewer.md`
- **THEN** 当前父 assistant run 的 Subagent 目录 SHALL 同时包含两个自定义定义及内置定义
- **THEN** 每个定义 SHALL 保留其来源种类与规范化绝对来源路径供诊断使用

#### Scenario: 项目级覆盖用户级同名定义
- **WHEN** 用户级与项目级目录都包含合法的 `reviewer.md`
- **THEN** 当前目录 SHALL 只暴露项目级 `reviewer`
- **THEN** 运行 `reviewer` SHALL 使用项目级文件的 description、能力配置和正文

#### Scenario: 内置名称不可覆盖
- **WHEN** 任一自定义目录包含 `explorer.md` 或 `worker.md`
- **THEN** 系统 SHALL 保留对应内置定义及其固定执行策略
- **THEN** 系统 SHALL 为被拒绝的自定义文件产生不包含文件正文和凭据的结构化诊断

#### Scenario: 可选目录不存在
- **WHEN** 用户级或项目级 agents 目录不存在或不可读取
- **THEN** 系统 SHALL 将该来源视为空目录并继续提供其他来源与内置定义
- **THEN** 主 Agent 与 headless run SHALL NOT 因可选目录缺失而启动失败

### Requirement: Markdown manifest 形成严格且有界的定义
每个自定义 Agent SHALL 使用单个 `.md` 文件声明定义。Frontmatter SHALL 包含非空 `description`、`capability` 与 `tools`，正文 SHALL 为非空角色指令；`capability` SHALL 仅接受 `readonly` 或 `general`，`tools` SHALL 为本地工具名称数组，`mcp` SHALL 为可选布尔值且缺省为 false。文件名 SHALL 匹配稳定小写名称规则，系统 SHALL 对名称、description、正文和当前目录定义数量实施固定上限，并 SHALL 拒绝未知字段、重复字段、未知工具、错误类型、路径别名和超过上限的定义。合法工具集合天然受固定 capability ceiling 和重复项校验约束，不另设数量上限。解析 SHALL 不执行文件内容、环境变量替换、模板插值或外部资源引用。

#### Scenario: 解析合法只读定义
- **WHEN** `security-reviewer.md` 具有合法 frontmatter、只读工具数组和非空 Markdown 正文
- **THEN** 系统 SHALL 生成名称为 `security-reviewer` 的解析后定义
- **THEN** Markdown 正文 SHALL 作为该定义的专属角色指令，而 SHALL NOT进入委派任务 user message

#### Scenario: 缺少必填字段
- **WHEN** 自定义文件缺少 description、capability、tools 或非空正文中的任一项
- **THEN** 系统 SHALL 将该文件标记为无效且不放入 `run_subagent` agent enum
- **THEN** 诊断 SHALL 包含来源路径和可操作的字段错误，但 SHALL NOT包含完整正文

#### Scenario: 拒绝未知字段和工具
- **WHEN** frontmatter 包含未知字段、重复字段或 tools 数组包含未知本地工具名
- **THEN** 系统 SHALL 拒绝整个定义而不是静默忽略错误项
- **THEN** 未知项 SHALL NOT进入 provider-visible schema 或 executable registry

#### Scenario: 输入预算限制
- **WHEN** 自定义名称、description、正文或目录定义数量超过固定上限
- **THEN** 系统 SHALL 以确定性规则拒绝超限定义并产生有界诊断
- **THEN** `run_subagent` 工具 schema 与 system context SHALL 保持在相应预算内

### Requirement: 能力模板只能收窄工具与执行权限
解析后的自定义定义 SHALL 把 `capability` 映射到系统拥有的固定执行策略与工具上限。`readonly` 定义的 tools SHALL 只能是 Explorer 本地工具上限的子集且 SHALL 强制禁用 MCP；`general` 定义的 tools SHALL 只能是 Worker 本地工具上限的子集，并仅在 `mcp: true` 时合并父运行已初始化的 MCP tools。所有自定义定义 SHALL 禁止 `run_subagent`，且 SHALL NOT通过 description、正文、tools 或 mcp 字段改变风险分类、审批、interaction mode、headless policy、委派预算、取消传播或 transcript 隔离。

#### Scenario: 只读定义收窄工具集合
- **WHEN** readonly 定义只声明 `read_files`、`glob` 与 `grep`
- **THEN** 子 provider-visible schema和 executable registry SHALL 只包含这些可用本地工具
- **THEN** 系统 SHALL NOT自动补入 Bash、Web、Skill、MCP、编辑、Todo、提问或委派工具

#### Scenario: 只读定义请求越权工具
- **WHEN** readonly 定义声明文件编辑、Todo、提问、MCP 或其他超出 Explorer 上限的能力
- **THEN** 系统 SHALL 将整个定义标记为无效
- **THEN** prompt 中关于写入或免审批的文字 SHALL NOT放宽该结果

#### Scenario: 通用定义显式启用 MCP
- **WHEN** general 定义合法声明本地工具并设置 `mcp: true`
- **THEN** 子 registry SHALL 包含声明且当前可用的本地工具以及父运行当前发现的 MCP tools
- **THEN** MCP调用 SHALL 继续遵守父 normal、plan、interactive 或 headless 的现有风险和审批语义

#### Scenario: 所有自定义定义禁止递归委派
- **WHEN** 系统为任一 custom definition 构造 provider-visible schema和 executable registry
- **THEN** 两者 SHALL NOT包含 `run_subagent`
- **THEN** 伪造的嵌套委派调用 SHALL在本地执行边界返回失败结果

### Requirement: 每个父 run 使用冻结且同源的 Subagent 目录
系统 SHALL 在每个 primary assistant run 初始化期间扫描并解析一次自定义文件，与内置定义合并为当前 run 的不可变 Subagent 目录。`SubagentToolPort.listDefinitions()`、`run_subagent` 参数 enum、按名称解析和子 runtime 创建 SHALL 使用同一目录实例；当前 run SHALL NOT在委派时重新读取 Agent 文件。文件变化 SHALL 只影响后续父 run。TUI与`--once` SHALL复用相同的发现、校验、优先级和冻结语义。

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

### Requirement: 自定义角色指令不能替换运行时安全约束
系统 SHALL 将自定义 Markdown 正文作为定义专属角色 section，附加在系统拥有的 capability 对应 Subagent 基础约束之后。基础约束 SHALL 明确限定只完成当前委派、遵守适用项目指令与工具审批、不得接管父任务或再次委派，并 SHALL 由运行时生成而不是由 manifest 提供。自定义 Agent SHALL 继承父 run 捕获的模型profile、reasoning override、cwd、配置revision、适用项目指令、memory与skill catalog；第一版 manifest SHALL NOT提供模型、reasoning、系统prompt覆盖或其他运行时配置字段。

#### Scenario: 自定义正文附加在固定约束之后
- **WHEN** 系统构造自定义 Agent 的首次 provider request
- **THEN** system context SHALL同时包含系统生成的基础Subagent约束和文件正文
- **THEN** 文件正文 SHALL NOT替换、删除或重新定义基础约束

#### Scenario: 自定义指令尝试放宽边界
- **WHEN** 自定义正文要求忽略审批、使用未声明工具、读取父 transcript 或再次委派
- **THEN** provider-visible工具与本地执行边界 SHALL保持解析后定义和runtime策略所规定的范围
- **THEN** 系统 SHALL NOT把该正文解释成授权或配置覆盖

#### Scenario: 自定义 Agent 继承父模型选择
- **WHEN** 父run使用已选择的模型profile与reasoning override启动自定义Agent
- **THEN** 子runtime SHALL使用同一配置revision中的父模型选择与override
- **THEN** manifest SHALL NOT使子runtime切换到另一模型或重新读取新配置revision
