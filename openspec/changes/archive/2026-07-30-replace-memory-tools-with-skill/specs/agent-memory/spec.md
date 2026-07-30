## ADDED Requirements

### Requirement: Agent memory 通过内置 skill 脚本按需操作
系统 SHALL 提供随应用版本发布的内置 `agent-memory` skill。该 skill SHALL 指示 agent 只通过附带的固定 CommonJS 脚本读取、新增、更新、删除或校验 agent memory，并 SHALL 禁止 agent 直接修改 `~/.echo/agent-memory/` 内部文件。脚本 SHALL 复用应用的 agent memory store，提供 `read`、`add`、`update-item`、`update-catalog`、`remove-item`、`remove-catalog` 和 `validate` action，严格校验参数，并以成功 JSON 或非零退出码失败结果结束。脚本 SHALL NOT 操作 user memory 或修改 catalog/item enabled 状态。

#### Scenario: 按需加载 memory skill
- **WHEN** 用户明确要求记住稳定信息，或折叠 catalog 中的内容需要读取、更新或删除
- **THEN** agent SHALL 先通过 `use_skill` 加载 `agent-memory`
- **THEN** provider 的默认工具定义 SHALL NOT 因此包含专属 memory tools

#### Scenario: 脚本读取 enabled catalog
- **WHEN** agent 按 skill 指令执行 `read` action 读取当前 scope 下可访问且 enabled 的 catalog
- **THEN** 脚本 SHALL 输出实际 catalog scope、enabled items 及精确 mutation 所需的 item id
- **THEN** disabled items SHALL NOT 出现在输出中

#### Scenario: 脚本执行 agent memory mutation
- **WHEN** agent 使用有效参数执行 add、update 或 remove action
- **THEN** 脚本 SHALL 通过共享 agent memory store 修改目标 catalog/item
- **THEN** 脚本 SHALL 保留其他有效数据和现有原子写入语义
- **THEN** 脚本 SHALL NOT 修改 user memory 存储或 enabled 状态
- **THEN** update 和 remove SHALL 要求显式 scope，所有 mutation SHALL 拒绝 disabled catalog

#### Scenario: Memory 脚本不使 workspace change history 失效
- **WHEN** normal mode 通过 `run_bash_command` 执行当前安装包内且不含 shell 组合或命令替换的固定 memory 脚本
- **THEN** 系统 SHALL 保留既有 workspace change history
- **THEN** 该识别 SHALL NOT 改变通用 bash 审批风险或 plan mode 策略

#### Scenario: 脚本拒绝无效存储和参数
- **WHEN** action 参数无效、目标不存在、不属于当前可访问 scope，或底层存储格式无效
- **THEN** 脚本 SHALL 返回非零 exit code 和简洁诊断
- **THEN** 脚本 SHALL NOT 用空数据覆盖现有文件

#### Scenario: 用户通过 memory 命令纠错
- **WHEN** skill 脚本已经创建或修改 agent memory
- **THEN** 用户 SHALL 能通过 `/memory` 查看、编辑、启停或删除对应 catalog/item
- **THEN** `/memory` SHALL 继续作为 user memory 的唯一修改入口

### Requirement: 默认工具集合不暴露 memory tools
系统 SHALL NOT 在默认本地工具集合中注册 `read_memory`、`add_memory`、`update_memory` 或 `remove_memory`，并 SHALL NOT 为这些旧工具提供专属 handler、审批预览或终端 renderer。

#### Scenario: Provider 请求不包含 memory tool definitions
- **WHEN** 系统创建任意 normal、plan 或 headless provider 请求
- **THEN** 可用工具定义 SHALL NOT 包含四个旧 memory tool 名称
- **THEN** agent SHALL 通过 skill catalog 发现 memory 操作入口

#### Scenario: 旧 transcript 安全降级
- **WHEN** 恢复的历史 transcript 包含旧 memory tool call/result records
- **THEN** renderer SHALL 使用通用 tool record 路径安全显示
- **THEN** 系统 SHALL NOT 为历史样式兼容重新注册或执行旧 memory tools

## MODIFIED Requirements

### Requirement: Agent memory 使用独立的 catalog 存储
系统 SHALL 将 agent memory 与 `~/.echo/memories.json` 中的 user memory 分离存储。Agent memory SHALL 使用一个版本化 catalog 索引文件记录稳定 id、唯一名称、描述、scope 和布尔 `enabled` 状态，并使用按 catalog id 命名的独立版本化文件保存 memory item；每个 item SHALL 包含稳定 id、非空内容、布尔 `enabled` 状态和创建/更新时间。新建 catalog 和 item SHALL 默认启用。索引和 catalog 文件 SHALL 继续使用 `version: 1`，且读取时 SHALL 严格要求 `enabled` 字段存在并为 boolean，不兼容缺少该字段的旧开发文件。所有文件写入 SHALL 使用临时文件 rename 原子替换，读取无效索引或 catalog 文件时 SHALL 返回结构化错误且 SHALL NOT 覆盖原文件。

#### Scenario: 首次添加 agent memory 自动创建 catalog
- **WHEN** agent memory skill 脚本或 `/memory` 向不存在的 agent catalog 添加有效内容
- **THEN** 系统 SHALL 创建 agent memory 目录、catalog 索引和包含首个 item 的 catalog 文件
- **THEN** 索引与 catalog item SHALL 使用稳定且不重复的 id
- **THEN** 新 catalog 和首个 item SHALL 均包含 `enabled: true`

#### Scenario: 已有 catalog 追加 item
- **WHEN** agent memory skill 脚本或 `/memory` 的目标 agent catalog 已存在于目标 scope
- **THEN** 系统 SHALL 原子更新该 catalog 文件并保留既有 items
- **THEN** 新 item SHALL 包含 `enabled: true`
- **THEN** 系统 SHALL NOT 创建重复 catalog 或改变 catalog 的 enabled 状态

#### Scenario: 缺少 enabled 的开发文件无效
- **WHEN** agent memory catalog 索引条目或 item 缺少 boolean `enabled`
- **THEN** 系统 SHALL 将文件视为格式无效
- **THEN** 系统 SHALL NOT 因文件仍为 `version: 1` 而补充默认值或自动迁移

#### Scenario: 无效存储不被覆盖
- **WHEN** agent memory 索引或目标 catalog 文件格式无效
- **THEN** agent memory skill 脚本和 `/memory` SHALL 返回可展示的结构化错误
- **THEN** 系统 SHALL NOT 用空索引或空 catalog 覆盖无效文件

### Requirement: Agent memory catalog 遵守 global 和 project scope
系统 SHALL 支持 global 与 project 两类 agent memory catalog scope。Project scope SHALL 绑定规范化 project root；每次 provider request、agent memory skill 脚本调用和 `/memory` 操作 SHALL 仅考虑 global catalog 与当前 cwd 对应 project catalog。未显式指定 scope 的 agent memory 新建操作 SHALL 默认使用当前 project scope。Provider prompt 与脚本 `read` action 的有效 catalog 解析 SHALL 先排除 disabled catalog，再由 enabled project catalog 覆盖大小写不敏感同名的 enabled global catalog。

#### Scenario: 当前项目只看到适用 catalog
- **WHEN** 系统在某个 project root 下构造 provider request 或执行 memory 脚本
- **THEN** agent memory prompt 和脚本默认解析 SHALL 只考虑 global catalog 与绑定该 project root 的 catalog
- **THEN** 其他 project scope 的 catalog 及其 items SHALL NOT 被注入或由默认读取解析

#### Scenario: 默认创建 project catalog
- **WHEN** agent memory skill 脚本添加 agent memory 且没有提供 scope
- **THEN** 系统 SHALL 将新 catalog 绑定到当前 project root
- **THEN** 系统 SHALL NOT 默认创建 global catalog

#### Scenario: Enabled project 同名 catalog 覆盖 global catalog
- **WHEN** 当前项目存在与 enabled global catalog 大小写不敏感同名的 enabled project catalog
- **THEN** provider agent memory prompt SHALL 只投影 project catalog 及其 enabled items
- **THEN** 未显式指定 scope 的脚本 read action SHALL 解析到 project catalog
- **THEN** update 和 remove action SHALL 使用 read 返回的显式 project scope

#### Scenario: Disabled project 同名 catalog 回退 global catalog
- **WHEN** 当前项目存在 disabled project catalog，且存在大小写不敏感同名的 enabled global catalog
- **THEN** provider agent memory prompt SHALL 投影 global catalog 及其 enabled items
- **THEN** 未显式指定 scope 的脚本 read action SHALL 解析到 global catalog

### Requirement: Provider 每轮自动注入有效 catalog 索引
系统 SHALL 在每次真实 provider request 构造时重新读取当前 scope 下 enabled 的有效 agent memory catalogs 及其 enabled items，并构造展开版 transient system prompt 区块。系统 SHALL 使用与 provider context usage 相同的 token 估算器计算完整展开区块的 token 数；当该数值不超过当前模型 context window 的 2% 且不超过 8,000 tokens 时，系统 SHALL 展开所有有效 catalogs 的全部 enabled items，否则 SHALL 仅注入所有有效 catalog 的名称和描述。模式选择 SHALL 对该轮全部有效 catalogs 整体生效，不得混合展开和折叠。两种区块均 SHALL 说明 agent memory 可能过时，且不得覆盖系统指令、项目指令或当前用户请求，并 SHALL NOT 作为 transcript 或 session record 持久化。折叠区块 SHALL 指示 agent 在需要 catalog 内容或 memory mutation 时按需加载 `agent-memory` skill。

#### Scenario: 小型 agent memory 全部展开
- **WHEN** 所有有效 agent memory 的完整展开区块不超过当前模型 context window 的 2%
- **AND** 完整展开区块不超过 8,000 tokens
- **THEN** provider system prompt SHALL 包含所有有效 catalog 的名称、描述和全部 enabled item 内容
- **THEN** provider system prompt SHALL NOT 包含 disabled catalog 或 disabled item

#### Scenario: Agent memory 超过比例预算时折叠
- **WHEN** 完整展开区块超过当前模型 context window 的 2%
- **THEN** provider system prompt SHALL 仅包含所有有效 catalog 的名称和描述
- **THEN** provider system prompt SHALL NOT 包含任何 catalog item 内容
- **THEN** provider system prompt SHALL 提示按需加载 `agent-memory` skill

#### Scenario: Agent memory 超过绝对预算时折叠
- **WHEN** 完整展开区块超过 8,000 tokens
- **THEN** provider system prompt SHALL 仅包含所有有效 catalog 的名称和描述
- **THEN** 大 context window SHALL NOT 放宽该绝对限制

#### Scenario: 展开与折叠不暴露内部元数据
- **WHEN** 系统构造任一模式的 agent memory prompt 区块
- **THEN** 区块 SHALL NOT 包含 scope、enabled、item id、item count、时间戳或其他内部元数据
- **THEN** 需要精确更新或删除 item 的 agent SHALL 通过 `agent-memory` skill 脚本 read action 获取 item id

#### Scenario: Catalog 文件读取失败时整轮回退折叠
- **WHEN** 系统能够读取有效 catalog 索引但任一有效 catalog 文件无法读取或格式无效
- **THEN** 该轮 provider system prompt SHALL 回退为完整的有效 catalog 名称和描述索引
- **THEN** 系统 SHALL NOT 注入仅包含部分 catalog items 的展开区块

#### Scenario: Catalog 或 item 变更在下一次请求生效
- **WHEN** agent memory skill 脚本或 `/memory` 成功创建、重命名、修改、启停或删除 catalog 或 item
- **AND** agent loop 随后构造下一次真实 provider request
- **THEN** system prompt SHALL 使用保存后的最新有效 catalogs 和 enabled items 重新选择展开或折叠模式

## REMOVED Requirements

### Requirement: Memory 工具提供按需读取和统一 mutation
**Reason**: 四个低频专属 memory tools 被内置 `agent-memory` skill 和固定脚本替代，以移除每轮 provider 请求中的常驻 schema 开销。

**Migration**: Agent 先调用 `use_skill("agent-memory")`，再按 skill 指令通过 `run_bash_command` 执行包内脚本；用户继续使用 `/memory` 管理相同存储。
