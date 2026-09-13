## MODIFIED Requirements

### Requirement: Markdown manifest 形成严格且有界的定义
每个自定义 Agent SHALL 使用单个 `.md` 文件声明定义。Frontmatter SHALL 包含非空 `description`、`capability` 与 `tools`，正文 SHALL 为非空角色指令；`capability` SHALL 仅接受 `readonly` 或 `general`，`tools` SHALL 为本地工具名称数组，`mcp` SHALL 为可选布尔值且缺省为 false。Frontmatter MAY 包含可选 `model`、`effort` 与 `skills`：`model` SHALL 为非空 LLM model profile ID；`effort` SHALL 仅接受 `inherit`、`default`、`none`、`low`、`medium`、`high`、`xhigh` 或 `max`，缺省 SHALL 等同于 `inherit`；`skills` SHALL 为 Skill 名称字符串序列，字段缺省 SHALL 表示允许父运行快照中的全部 enabled Skills，存在但为空 SHALL 表示不允许任何 Skill，非空 SHALL 表示名称 allowlist。文件名 SHALL 匹配稳定小写名称规则，系统 SHALL 对名称、description、正文、单个 Skill 名称和当前目录定义数量实施固定上限，并 SHALL 拒绝未知字段、重复字段、重复 Skill 名称、未知工具、错误类型、空模型引用、非法 effort、非法 Skill 名称、路径别名和超过上限的定义。合法工具集合天然受固定 capability ceiling 和重复项校验约束，不另设数量上限。解析 SHALL 不执行文件内容、环境变量替换、模板插值或外部资源引用；当前运行中不存在或 disabled 的合法 Skill 名称 SHALL 保留在策略中但 SHALL NOT 使整个 Agent 定义失效。

#### Scenario: 解析合法只读定义
- **WHEN** `security-reviewer.md` 具有合法 frontmatter、只读工具数组、可选模型和 Skill 策略以及非空 Markdown 正文
- **THEN** 系统 SHALL 生成名称为 `security-reviewer` 的解析后定义
- **THEN** Markdown 正文 SHALL 作为该定义的专属角色指令，而 SHALL NOT 进入委派任务 user message

#### Scenario: 缺少必填字段
- **WHEN** 自定义文件缺少 description、capability、tools 或非空正文中的任一项
- **THEN** 系统 SHALL 将该文件标记为无效且不放入 `run_subagent` agent enum
- **THEN** 诊断 SHALL 包含来源路径和可操作的字段错误，但 SHALL NOT 包含完整正文

#### Scenario: 拒绝未知字段和工具
- **WHEN** frontmatter 包含未知字段、重复字段或 tools 数组包含未知本地工具名
- **THEN** 系统 SHALL 拒绝整个定义而不是静默忽略错误项
- **THEN** 未知项 SHALL NOT 进入 provider-visible schema 或 executable registry

#### Scenario: 拒绝非法模型策略
- **WHEN** frontmatter 的 model 为空、effort 不在固定枚举中或字段类型不受支持
- **THEN** 系统 SHALL 将整个定义标记为无效并产生不包含凭据的字段诊断
- **THEN** 系统 SHALL NOT 把非法值回退为父模型、全局模型或默认 effort

#### Scenario: 区分缺省与空 Skill 策略
- **WHEN** 一个合法 manifest 省略 `skills`，另一个合法 manifest 声明不含条目的 `skills` 序列
- **THEN** 第一个定义 SHALL 保留允许全部 enabled Skills 的缺省策略
- **THEN** 第二个定义 SHALL 保留明确禁止全部 Skills 的空 allowlist，parser 与 serializer SHALL NOT 合并两种状态

#### Scenario: 拒绝非法 Skill 序列
- **WHEN** `skills` 使用内联值、包含空名称、控制字符、超过名称上限的值或重复名称
- **THEN** 系统 SHALL 将整个定义标记为无效并产生有界字段诊断
- **THEN** 非法项 SHALL NOT 被静默删除后继续执行定义

#### Scenario: 暂时不可用的 Skill 引用不使定义失效
- **WHEN** 合法 `skills` allowlist 包含当前项目未发现或被全局禁用的 Skill 名称
- **THEN** 系统 SHALL 保留该名称供后续项目和管理界面使用
- **THEN** 当前运行的 effective Skill 集合 SHALL 忽略该名称且 SHALL NOT 因此放宽到全部 Skills

#### Scenario: 输入预算限制
- **WHEN** 自定义名称、description、正文、单个 Skill 名称或目录定义数量超过固定上限
- **THEN** 系统 SHALL 以确定性规则拒绝超限定义并产生有界诊断
- **THEN** `run_subagent` 工具 schema 与 system context SHALL 保持在相应预算内

### Requirement: 内置 Agent 模型 override 不改变安全定义
系统 SHALL 从用户级 `~/.echo/agents.settings.json` 与项目级 `<project-root>/.echo/agents.settings.json` 读取版本化内置 Agent override。Version 2 设置 SHALL 只接受 `explorer` 与 `worker` 的可选 model profile、effort 策略和 Skill 名称 allowlist，不得承载 description、prompt、capability、tools、MCP 或执行策略；读取端 SHALL 兼容没有 Skill 字段的 version 1 设置，并将其归一化为允许全部 enabled Skills。项目级同名 override SHALL 整体遮蔽用户级 override；未设置 override SHALL 保持父模型/effort 继承和全部 enabled Skills 可见。

#### Scenario: 项目级 override 生效
- **WHEN** Explorer 同时存在合法用户级和项目级 override
- **THEN** 当前父 run 的冻结目录 SHALL 只对 Explorer 使用项目级模型、effort 和 Skill 策略
- **THEN** Explorer 的固定只读定义、工具集合和 MCP 禁用 SHALL 保持不变

#### Scenario: 项目级 override 字段缺省
- **WHEN** 项目级 Worker override 只指定 effort 而用户级同名 override 指定 model 与 Skill allowlist
- **THEN** 项目级 override SHALL 整体遮蔽用户级条目，Worker model SHALL 继承父 profile且 Skill 策略 SHALL 恢复为全部 enabled Skills
- **THEN** 系统 SHALL NOT 把两个来源按字段拼接

#### Scenario: 高优先级 override 无效
- **WHEN** 项目级内置 override 格式无效或引用当前 snapshot 中不存在的 model profile
- **THEN** 系统 SHALL 产生有界诊断且 SHALL NOT 回退用户级同名 override
- **THEN** 对应内置 Agent SHALL 仍存在，并对模型和 effort 完整继承父 run且使用缺省 Skill 策略

#### Scenario: 读取旧版内置设置
- **WHEN** 用户级或项目级 settings 使用合法 version 1 schema并只包含 model与effort
- **THEN** 系统 SHALL 继续应用该 override且将缺失的 Skill 策略视为全部 enabled Skills
- **THEN** 下一次成功写入 SHALL 使用包含可选 Skill 策略的 version 2 规范化格式

#### Scenario: 设置文件不存在
- **WHEN** 用户级或项目级 agents settings 文件不存在
- **THEN** 系统 SHALL 将该来源视为空 override且不影响内置或自定义 Agent 发现

## ADDED Requirements

### Requirement: Subagent Skill 策略只收窄按需加载范围
每个冻结 Subagent 定义 SHALL 携带可选 Skill 名称 allowlist。系统 SHALL 以父运行冻结的 enabled Skill snapshot 为上限计算 effective 集合；缺省策略 SHALL 取全部 snapshot 条目，空 allowlist SHALL 取空集合，非空 allowlist SHALL 取名称交集。若定义的本地工具集合不包含 `use_skill`，effective 集合 SHALL 强制为空。Skill 策略 SHALL NOT 自动注册 `use_skill`、预加载 Skill 正文、授予 Skill 所提及的工具、改变风险审批或允许递归委派。

#### Scenario: 指定 Skill allowlist
- **WHEN** 自定义 Agent 配置 `skills` 为 `code-review` 与 `unit-test`，且两者在父运行 snapshot 中 enabled
- **THEN** 子运行 catalog 与 `use_skill` SHALL 只允许这两个名称
- **THEN** 其他 enabled Skill 即使名称可被模型猜测也 SHALL 加载失败

#### Scenario: 空 allowlist 禁止所有 Skill
- **WHEN** Subagent 定义保留 `use_skill` 工具但配置空 Skill allowlist
- **THEN** provider system prompt SHALL 不注入 Skill catalog
- **THEN** 任意 `use_skill` 调用 SHALL 返回失败且不读取目标 Skill 正文

#### Scenario: 未配置 use_skill 工具
- **WHEN** 自定义定义配置了 Skill 名称但本地 tools 不包含 `use_skill`
- **THEN** 子 provider schema SHALL 不包含 `use_skill` 且 Skill catalog SHALL 为空
- **THEN** 系统 SHALL NOT 因 Skill 配置自动补入该工具

#### Scenario: Skill 策略随父目录冻结
- **WHEN** primary run 已冻结 Subagent 定义后，对应 Agent manifest 或内置 override 的 `skills` 被修改
- **THEN** 当前 run 后续委派 SHALL 继续使用冻结定义中的原策略
- **THEN** 新策略 SHALL 只影响下一次 primary assistant run
