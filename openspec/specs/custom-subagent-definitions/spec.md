# custom-subagent-definitions Specification

## Purpose
TBD - created by archiving change add-custom-subagents. Update Purpose after archive.
## Requirements
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
每个自定义 Agent SHALL 使用单个 `.md` 文件声明定义。Frontmatter SHALL 包含非空 `description`、`capability` 与 `tools`，正文 SHALL 为非空角色指令；`capability` SHALL 仅接受 `readonly` 或 `general`，`tools` SHALL 为本地工具名称数组，`mcp` SHALL 为可选布尔值且缺省为 false。Frontmatter MAY包含可选 `model` 与 `effort`：`model` SHALL为非空 LLM model profile ID；`effort` SHALL仅接受 `inherit`、`default`、`none`、`low`、`medium`、`high`、`xhigh` 或 `max`，缺省 SHALL等同于`inherit`。文件名 SHALL 匹配稳定小写名称规则，系统 SHALL 对名称、description、正文和当前目录定义数量实施固定上限，并 SHALL 拒绝未知字段、重复字段、未知工具、错误类型、空模型引用、非法 effort、路径别名和超过上限的定义。合法工具集合天然受固定 capability ceiling 和重复项校验约束，不另设数量上限。解析 SHALL 不执行文件内容、环境变量替换、模板插值或外部资源引用。

#### Scenario: 解析合法只读定义
- **WHEN** `security-reviewer.md` 具有合法 frontmatter、只读工具数组、可选模型策略和非空 Markdown 正文
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

#### Scenario: 拒绝非法模型策略
- **WHEN** frontmatter 的 model 为空、effort 不在固定枚举中或字段类型不受支持
- **THEN** 系统 SHALL 将整个定义标记为无效并产生不包含凭据的字段诊断
- **THEN** 系统 SHALL NOT把非法值回退为父模型、全局模型或默认 effort

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
系统 SHALL 将自定义 Markdown 正文作为定义专属角色 section，附加在系统拥有的 capability 对应 Subagent 基础约束之后。基础约束 SHALL 明确限定只完成当前委派、遵守适用项目指令与工具审批、不得接管父任务或再次委派，并 SHALL 由运行时生成而不是由 manifest 提供。自定义 Agent SHALL 继承父 run 捕获的 cwd、配置revision、适用项目指令、memory与skill catalog；缺少定义级模型策略时 SHALL继承父模型profile与reasoning override。Manifest 的 model/effort SHALL只能在同一配置revision内选择模型profile和推理强度，SHALL NOT提供 provider凭据、system prompt覆盖或其他运行时配置字段。

#### Scenario: 自定义正文附加在固定约束之后
- **WHEN** 系统构造自定义 Agent 的首次 provider request
- **THEN** system context SHALL同时包含系统生成的基础Subagent约束和文件正文
- **THEN** 文件正文 SHALL NOT替换、删除或重新定义基础约束

#### Scenario: 自定义指令尝试放宽边界
- **WHEN** 自定义正文要求忽略审批、使用未声明工具、读取父 transcript 或再次委派
- **THEN** provider-visible工具与本地执行边界 SHALL保持解析后定义和runtime策略所规定的范围
- **THEN** 系统 SHALL NOT把该正文解释成授权或配置覆盖

#### Scenario: 自定义 Agent 继承父模型选择
- **WHEN** 自定义 Agent 未指定 model 且 effort 缺省或为 `inherit`
- **THEN** 子runtime SHALL使用同一配置revision中的父模型profile与reasoning override
- **THEN** 父run期间发生的配置变化 SHALL NOT改变该选择

#### Scenario: 自定义 Agent 使用显式模型与固定 effort
- **WHEN** 自定义 Agent 指定当前 snapshot 中存在的 model profile 和固定 effort 枚举
- **THEN** 子runtime SHALL使用该 profile 创建独立 provider adapter并应用固定 effort
- **THEN** 主 Agent 的模型选择与 effort SHALL保持不变

#### Scenario: 自定义 Agent 使用目标模型默认 effort
- **WHEN** 自定义 Agent 的 effort 为 `default`
- **THEN** 子runtime SHALL忽略父 run 的显式 effort override并使用最终 Agent profile 自身的默认 effort

#### Scenario: 显式模型引用已经失效
- **WHEN** 当前父 run 捕获的配置 snapshot 中不存在自定义 Agent 声明的 model profile
- **THEN** 当前冻结目录 SHALL把该定义标记为无效并从 `run_subagent` agent enum 排除
- **THEN** 系统 SHALL NOT静默回退父模型或全局选择

### Requirement: Agent 管理存储安全地创建、更新和删除定义
系统 SHALL 提供面向 `user` 与 `project` scope 的 Agent 定义管理存储，从合法 scope、项目根和经过名称校验的文件名构造目标路径。存储 SHALL只操作对应 agents 目录中的直接普通 `.md` 文件，SHALL拒绝保留名称、路径逃逸、符号链接和非普通文件。创建 SHALL使用排他语义；更新与删除 SHALL要求匹配读取时取得的内容指纹。合法写入 SHALL使用同目录临时文件完整写入并原子替换，失败 SHALL不得留下被当作 Agent 候选的部分文件。

#### Scenario: 创建合法用户级定义
- **WHEN** 管理端提交通过共享 parser、capability 和模型目录校验的新用户级定义，且目标不存在
- **THEN** 存储 SHALL创建 `~/.echo/agents/<name>.md` 的规范化 manifest
- **THEN** 新文件 SHALL在下一次 primary assistant run 扫描时参与目录合并

#### Scenario: 拒绝路径逃逸或符号链接
- **WHEN** 名称非法、目标解析到 agents 目录外或目标为符号链接
- **THEN** 存储 SHALL拒绝操作且 SHALL NOT读取或修改目录外目标

#### Scenario: 更新前文件已经变化
- **WHEN** 更新或删除携带的内容指纹与磁盘当前普通文件不一致
- **THEN** 存储 SHALL返回冲突并保留磁盘内容
- **THEN** 系统 SHALL NOT使用无条件 rename 或 unlink 覆盖该冲突

#### Scenario: 管理写入与 runtime 校验同源
- **WHEN** command port 在写入前验证结构化 Agent 草稿
- **THEN** 它 SHALL复用与 catalog loader 相同的名称、manifest、capability ceiling、MCP、输入预算和模型目录规则
- **THEN** surface 提供的字段 SHALL NOT被视为越过存储校验的授权

### Requirement: 内置 Agent 模型 override 不改变安全定义
系统 SHALL从用户级 `~/.echo/agents.settings.json` 与项目级 `<project-root>/.echo/agents.settings.json` 读取版本化内置 Agent override。设置 SHALL只接受 `explorer` 与 `worker` 的可选 model profile和effort策略，不得承载 description、prompt、capability、tools、MCP或执行策略。项目级同名 override SHALL整体遮蔽用户级 override；未设置 override SHALL保持父模型/effort继承。

#### Scenario: 项目级 override 生效
- **WHEN** Explorer 同时存在合法用户级和项目级 override
- **THEN** 当前父 run 的冻结目录 SHALL只对 Explorer 使用项目级模型策略
- **THEN** Explorer 的固定只读定义和 MCP 禁用 SHALL保持不变

#### Scenario: 项目级 override 字段缺省
- **WHEN** 项目级 Worker override 只指定 effort 而用户级同名 override 指定 model
- **THEN** 项目级 override SHALL整体遮蔽用户级条目，Worker model SHALL继承父 profile
- **THEN** 系统 SHALL NOT把两个来源按字段拼接

#### Scenario: 高优先级 override 无效
- **WHEN** 项目级内置 override 格式无效或引用当前 snapshot 中不存在的 model profile
- **THEN** 系统 SHALL产生有界诊断且 SHALL NOT回退用户级同名 override
- **THEN** 对应内置 Agent SHALL仍存在，并对模型和effort完整继承父 run

#### Scenario: 设置文件不存在
- **WHEN** 用户级或项目级 agents settings 文件不存在
- **THEN** 系统 SHALL将该来源视为空 override且不影响内置或自定义 Agent 发现

### Requirement: 模型策略与 Subagent catalog 在父 run 内冻结
系统 SHALL在 primary assistant run 初始化时使用同一 `AgentUserConfigSnapshot` 解析主模型、显式 Subagent model profile、effort策略与内置 override，并将结果放入该 run 的冻结目录。定义管理文件或 LLM 配置在 run 期间变化 SHALL只影响后续 primary run。TUI 与 `--once` SHALL复用相同的严格模型引用、effort和诊断语义。

#### Scenario: 管理界面保存不改变当前 run
- **WHEN** `/agents` 保存定义或内置 override，而一个已初始化的父 run 仍持有冻结目录
- **THEN** 当前 run 的 `run_subagent` schema、按名称解析和模型策略 SHALL保持不变
- **THEN** 下一 primary run SHALL重新扫描并使用届时合法的配置

#### Scenario: Headless 使用显式 Subagent 模型
- **WHEN** `--once` 运行发现引用合法 model profile 的自定义 Agent并委派给它
- **THEN** 子runtime SHALL在该 headless run 的配置 snapshot 中严格解析同一 profile和effort策略
- **THEN** headless审批、安全工具边界和不等待stdin的语义 SHALL保持不变
