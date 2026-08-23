## MODIFIED Requirements

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

## ADDED Requirements

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
