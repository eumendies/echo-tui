# skill-system Specification

## Purpose
定义 `echo_tui` skill 系统的外部行为，包括 skill 文件发现、元数据解析、短 catalog 常驻注入、完整内容按需加载、使用记录识别、skill 启用管理、按 skill 的模型策略，以及 slash command 边界。

## Requirements

### Requirement: skill 文件发现和元数据解析
系统 SHALL 从项目级 `.echo/skills/<skill-name>/SKILL.md` 和用户级 `~/.echo/skills/<skill-name>/SKILL.md` 发现 skill。每个有效 skill SHALL 至少提供名称和描述，供系统生成可注入 provider 的短 catalog。

#### Scenario: 发现项目级 skill
- **WHEN** 当前工作区存在 `.echo/skills/code-review/SKILL.md`
- **THEN** 系统 SHALL 把 `code-review` 识别为可用 skill
- **THEN** catalog SHALL 包含该 skill 的名称和描述

#### Scenario: 发现用户级 skill
- **WHEN** 用户目录存在 `~/.echo/skills/unit-test/SKILL.md`
- **THEN** 系统 SHALL 把 `unit-test` 识别为可用 skill
- **THEN** 该 skill SHALL 可被 `use_skill` 工具按名称加载

#### Scenario: 项目级 skill 覆盖同名用户级 skill
- **WHEN** 项目级目录和用户级目录同时存在同名 skill
- **THEN** 系统 SHALL 使用项目级 skill 的元数据和内容
- **THEN** catalog SHALL 只包含该名称的一条 skill 记录

#### Scenario: 解析 SKILL.md frontmatter
- **WHEN** `SKILL.md` 以包含 `name` 和 `description` 的 frontmatter 开头
- **THEN** 系统 SHALL 使用 frontmatter 中的字段作为 skill 元数据
- **THEN** 系统 SHALL 把 frontmatter 后的 markdown 正文作为可加载的 skill 内容

#### Scenario: 无效 skill 不阻断主流程
- **WHEN** 某个 `SKILL.md` 缺少必要元数据或内容无法读取
- **THEN** 系统 SHALL 不因该文件阻止 TUI 启动或普通 agent 请求
- **THEN** 对该 skill 的显式加载 SHALL 返回明确失败信息

### Requirement: skill catalog 常驻注入
系统 SHALL 在 provider system prompt 中注入短 skill catalog，使模型知道当前可用 skill 及其适用场景。catalog SHALL 只包含 skill 名称和描述，不得包含完整 `SKILL.md` 正文。

#### Scenario: 存在 skill 时注入短 catalog
- **WHEN** 发起 provider 请求且 registry 中存在可用 skill
- **THEN** system prompt SHALL 包含可用 skill 的名称和描述
- **THEN** system prompt SHALL 指示模型在任务匹配时调用 `use_skill`

#### Scenario: 无 skill 时不注入空 catalog
- **WHEN** 发起 provider 请求且 registry 中没有可用 skill
- **THEN** system prompt SHALL 不包含空的 skill catalog 区块

#### Scenario: catalog 不包含完整正文
- **WHEN** skill 的 `SKILL.md` 正文包含长工作流说明
- **THEN** system prompt 中的 catalog SHALL NOT 包含该长正文
- **THEN** 该正文 SHALL 只能通过 `use_skill` 工具加载

### Requirement: skill 内容按需加载
系统 SHALL 通过 `use_skill` 工具按名称加载完整 skill 内容。加载结果 SHALL 包含 skill 名称、来源、可选参数和正文，并 SHALL 作为普通 tool result 进入 transcript。

#### Scenario: 加载存在的 skill
- **WHEN** `use_skill` 收到 `{ "name": "code-review" }`
- **THEN** 系统 SHALL 读取匹配的 `SKILL.md`
- **THEN** tool result SHALL 标记成功并包含 skill 正文

#### Scenario: 加载时携带参数
- **WHEN** `use_skill` 收到 `{ "name": "code-review", "arguments": "src/foo.ts" }`
- **THEN** tool result SHALL 包含该 arguments 文本
- **THEN** tool result SHALL 保留完整 skill 正文供模型继续执行

#### Scenario: 加载不存在的 skill
- **WHEN** `use_skill` 收到未知 skill 名称
- **THEN** tool result SHALL 标记失败
- **THEN** result 文本 SHALL 包含可用 skill 名称或提示用户查看 catalog

### Requirement: skill 附加资源发现
系统 SHALL 在加载有效 skill 时发现该 skill root 下的附加资源文件，并在加载结果中提供稳定的扁平相对路径清单。资源清单 SHALL 只作为发现索引，不自动读取文件内容、不自动执行脚本、不改变工具审批或执行权限。

#### Scenario: 加载 skill 时包含资源清单
- **WHEN** skill root 下存在 `reference/checklist.md` 和 `scripts/collect-diff.sh`
- **AND** 用户或模型加载该 skill
- **THEN** 加载结果 SHALL 包含 `[Skill Resources]` 区块
- **THEN** 该区块 SHALL 包含 `- reference/checklist.md` 和 `- scripts/collect-diff.sh` 形式的扁平相对路径条目

#### Scenario: 没有资源时不输出空区块
- **WHEN** skill root 下不存在可发现的附加资源文件
- **AND** 用户或模型加载该 skill
- **THEN** 加载结果 SHALL 包含 skill 正文
- **THEN** 加载结果 SHALL NOT 包含空的 `[Skill Resources]` 区块

#### Scenario: catalog 不包含资源清单
- **WHEN** provider system prompt 注入 skill catalog
- **THEN** catalog SHALL 仍只包含 skill 名称和描述
- **THEN** catalog SHALL NOT 包含该 skill 的附加资源路径

#### Scenario: direct slash 调用包含同样资源清单
- **WHEN** 用户通过 `/<skill-name> [arguments...]` 直接调用带有附加资源的 enabled skill
- **THEN** 追加的 user transcript record SHALL 包含 skill 正文
- **THEN** 该 user transcript record SHALL 包含与 `use_skill` 加载结果等价的扁平资源路径清单

#### Scenario: 资源发现失败不影响 skill 加载
- **WHEN** 某个资源目录不可读或包含不可列出的条目
- **AND** `SKILL.md` 本身有效且可读取
- **THEN** 系统 SHALL 仍允许该 skill 出现在 catalog 并被加载
- **THEN** 系统 SHALL 跳过无法发现的资源，而不是让 skill 加载失败

### Requirement: skill 使用记录
系统 SHALL 能从 transcript 中识别 skill 使用记录。第一版 skill 使用记录 SHALL 来自模型调用 `use_skill` 后产生的 tool_call/tool_result 记录。

#### Scenario: 模型自动调用产生使用记录
- **WHEN** 模型调用 `use_skill` 并得到 tool result
- **THEN** agent loop SHALL 追加对应 `tool_call` record
- **THEN** agent loop SHALL 追加对应 `tool_result` record
- **THEN** 系统 SHALL 能从 transcript 中识别该次 skill 使用

#### Scenario: 非 use_skill 工具调用不计为 skill 使用
- **WHEN** transcript 包含其他工具的 tool_call/tool_result 记录
- **THEN** 系统 SHALL NOT 把这些记录识别为 skill 使用记录

### Requirement: 第一版不提供 slash skill command
系统 SHALL NOT 在本 change 中新增 `/skill` slash command。未来若引入 slash 方式加载 skill，该 slash 调用产生的 skill 内容 SHALL 以 user message 形式进入上下文，而不是伪造为模型发起的 `use_skill` tool_call/tool_result。

#### Scenario: 默认 slash command 不包含 /skill
- **WHEN** 系统创建默认 slash command handlers 或 suggestion descriptors
- **THEN** 默认命令集合 SHALL NOT 包含 `/skill`

#### Scenario: slash skill 调用不伪造工具调用
- **WHEN** 后续 change 设计 slash skill 调用
- **THEN** 该设计 SHALL NOT 要求把用户 slash 调用表达为模型 `use_skill` tool_call
- **THEN** 加载出的 skill 内容 SHALL 以 user message 语义注入后续上下文

### Requirement: skill 启用状态持久化
系统 SHALL 支持在 skill 存储目录内持久化 skill 启用状态。每个 discovered skill 默认 enabled；被禁用的 skill SHALL 记录在其当前生效来源 root 下的 JSON 状态文件中。

#### Scenario: 默认 skill 为 enabled
- **WHEN** 项目级或用户级 skill root 中存在有效 `SKILL.md` 且没有状态文件
- **THEN** 系统 SHALL 将该 skill 视为 enabled
- **THEN** 该 skill SHALL 可进入 enabled catalog、slash suggestion 和 `use_skill` 加载路径

#### Scenario: 从项目级状态文件读取 disabled skill
- **WHEN** `.echo/skills/skills.json` 包含 `{ "schemaVersion": 1, "disabled": ["code-review"] }`
- **THEN** 项目级 `code-review` skill SHALL 被视为 disabled
- **THEN** 其他未列入 disabled 的项目级 skill SHALL 仍被视为 enabled

#### Scenario: 从用户级状态文件读取 disabled skill
- **WHEN** `~/.echo/skills/skills.json` 包含 `{ "schemaVersion": 1, "disabled": ["unit-test"] }`
- **THEN** 用户级 `unit-test` skill SHALL 被视为 disabled
- **THEN** 其他未列入 disabled 的用户级 skill SHALL 仍被视为 enabled

#### Scenario: 状态跟当前生效 skill source root 绑定
- **WHEN** 项目级和用户级存在同名 skill，且项目级 skill 按覆盖规则生效
- **THEN** 系统 SHALL 使用项目级 skill root 的状态决定该 skill 是否 enabled
- **THEN** `/skills` 保存该 skill 状态时 SHALL 写入项目级 skill root 的状态文件，而不是用户级状态文件

#### Scenario: 状态文件损坏时安全降级
- **WHEN** skill root 下的 `skills.json` 不可读、不是合法 JSON 或 disabled 字段无效
- **THEN** 系统 SHALL NOT 阻止 TUI 启动或普通 agent 请求
- **THEN** 系统 SHALL 对该 root 下 discovered skills 使用默认 enabled 状态

### Requirement: skills 命令
系统 SHALL 提供单一 `/skills` slash command 作为 skill 管理入口。`/skills` SHALL 展示所有有效 discovered skills 及其 enabled/disabled 状态、来源和描述，并 SHALL 允许用户在 command surface 中批量切换 skill 启用状态并保存。

#### Scenario: /skills 打开管理面板
- **WHEN** 用户提交纯 `/skills`
- **THEN** 系统 SHALL 打开包含所有有效 discovered skills 的 skills command surface
- **THEN** 每个 skill 的初始开关状态 SHALL 反映当前持久化 enabled 状态
- **THEN** disabled skill SHALL 仍出现在 surface 中以便重新启用
- **THEN** 系统 SHALL NOT 触发 agent 请求

#### Scenario: /skills 展示 list 信息
- **WHEN** `/skills` surface 处于活跃状态且存在 discovered skills
- **THEN** 每个 skill SHALL 显示名称、来源、描述和 enabled/disabled 状态
- **THEN** surface SHALL 显示当前 enabled skill 数量和总 skill 数量

#### Scenario: /skills 空状态
- **WHEN** 用户提交纯 `/skills` 且当前没有有效 discovered skills
- **THEN** 系统 SHALL 打开可关闭的本地 command surface
- **THEN** surface SHALL 告知当前没有发现可用 skill
- **THEN** surface SHALL 提示项目级和用户级 skill 目录位置

#### Scenario: /skills 中切换草稿状态
- **WHEN** `/skills` surface 处于活跃状态且用户按 Space
- **THEN** 系统 SHALL 切换当前选中 skill 的草稿 enabled 状态
- **THEN** 系统 SHALL 只更新 command session surface/data
- **THEN** 系统 SHALL NOT 立即写入 skill 状态文件

#### Scenario: /skills 中确认保存状态
- **WHEN** `/skills` surface 处于活跃状态且用户切换若干 skill 后按 Enter
- **THEN** 系统 SHALL 将草稿状态保存到对应 skill root 的 `skills.json`
- **THEN** 系统 SHALL 关闭 command session 并清空 composer
- **THEN** 系统 SHALL NOT 触发 agent 请求

#### Scenario: /skills 中取消不保存
- **WHEN** `/skills` surface 处于活跃状态且用户切换若干 skill 后按 Esc
- **THEN** 系统 SHALL 放弃草稿状态
- **THEN** 系统 SHALL NOT 修改任何 skill 状态文件
- **THEN** 系统 SHALL 关闭 command session 并清空 composer

#### Scenario: /skills 子命令不再命中本地命令
- **WHEN** 用户提交以 `/skills` 开头但不精确等于 `/skills` 的输入，例如 `/skills list` 或 `/skills manage`
- **THEN** `SkillsCommandHandler` SHALL NOT 命中该输入
- **THEN** 该输入 SHALL 按通用 slash 解析后续规则处理，而不是打开 skills command surface

### Requirement: slash 直接调用 skill
系统 SHALL 支持用户通过 `/<skill-name> [arguments...]` 直接调用 enabled skill。该调用 SHALL 读取 skill 完整正文，并将 skill 内容与 arguments 作为一条 user message 追加到 transcript，然后沿用普通用户提交路径触发 agent。

#### Scenario: 调用 enabled skill
- **WHEN** 用户提交 `/<skill-name> [arguments...]` 且该名称匹配 enabled skill
- **THEN** 系统 SHALL 读取该 skill 的完整 `SKILL.md` 正文
- **THEN** 系统 SHALL 追加一条 `role: user` 的 transcript record，内容包含 skill 名称、来源、arguments 和正文
- **THEN** 系统 SHALL 使用包含该 user record 的 transcript 触发普通 agent 请求

#### Scenario: slash skill 调用不伪造工具调用
- **WHEN** 用户通过 slash 直接调用 skill
- **THEN** 系统 SHALL NOT 追加 `use_skill` tool_call record
- **THEN** 系统 SHALL NOT 追加 `use_skill` tool_result record
- **THEN** 加载出的 skill 内容 SHALL 以 user message 语义进入后续上下文

#### Scenario: 调用 disabled skill 时提示
- **WHEN** 用户提交 `/<skill-name> [arguments...]` 且该名称匹配 disabled skill
- **THEN** 系统 SHALL 不执行 skill 注入
- **THEN** 系统 SHALL 展示该 skill 已禁用并可通过 `/skills` 启用的提示
- **THEN** 系统 SHALL NOT 将该 slash 文本作为普通 user message 发送给 agent

#### Scenario: 输入历史保留原始 slash 文本
- **WHEN** 用户通过 slash 直接调用 skill 并触发 agent
- **THEN** transcript 中的 user record SHALL 包含加载后的 skill 内容
- **THEN** composer 历史 SHALL 记录用户输入的原始 slash 文本，而不是完整 skill 正文

### Requirement: slash skill suggestion 只显示 enabled skills
系统 SHALL 在 slash suggestion 中显示内置 slash commands 和当前 enabled skills 对应的 direct invocation entries。disabled skills SHALL NOT 出现在 slash suggestion 中，但仍 SHALL 出现在 `/skills` 管理面板中。

#### Scenario: disabled skill 不提示
- **WHEN** 某个 discovered skill 被状态文件标记为 disabled
- **THEN** slash suggestion SHALL NOT 包含 `/<skill-name>` entry
- **THEN** `/skills` SHALL 仍展示该 skill 及 disabled 状态
- **THEN** `/skills` SHALL 允许用户重新启用该 skill

#### Scenario: manage 保存后 suggestion 立即刷新
- **WHEN** 用户在 `/skills` 中禁用某个 skill 并按 Enter 保存
- **THEN** 后续 slash suggestion SHALL 不再显示该 skill
- **THEN** 系统 SHALL NOT 要求重启 TUI 才刷新 suggestion

#### Scenario: enabled skill 作为 direct slash suggestion
- **WHEN** 某个 discovered skill 处于 enabled 状态且名称不与内置 slash command 冲突
- **THEN** slash suggestion SHALL 包含 `/<skill-name>` entry
- **THEN** 该 entry 的描述 SHALL 来自 skill description 或等价短描述

### Requirement: skill 使用记录包含 slash 来源
系统 SHALL 能从 transcript 中识别 slash 直接调用产生的 skill 使用记录。slash 来源的使用记录 SHALL 来自带有 skill invocation metadata 的 user record，并 SHALL 与模型自动调用 `use_skill` 的记录区分来源。

#### Scenario: slash 调用产生使用记录
- **WHEN** transcript 包含由 slash skill invocation 追加的 user record
- **THEN** 系统 SHALL 能识别该次 skill 使用的 skill 名称、arguments 和 createdAt
- **THEN** 该使用记录的 source SHALL 标识为 slash 或等价来源

#### Scenario: tool 和 slash 使用记录可共存
- **WHEN** transcript 同时包含 `use_skill` tool_call 和 slash skill invocation user record
- **THEN** 系统 SHALL 分别识别两类 skill 使用记录
- **THEN** 系统 SHALL NOT 将普通 user record 误识别为 skill 使用记录

### Requirement: 默认 setup skill 作为用户级 skill 发现
系统 SHALL 将 bootstrap 创建的 `echo-tui-setup` 作为普通用户级 skill 发现、展示、启用/禁用和加载。系统 SHALL NOT 为该 skill 新增 builtin source kind 或绕过现有 skill registry。

#### Scenario: 默认 setup skill 出现在 catalog
- **WHEN** bootstrap 已创建 `~/.echo/skills/echo-tui-setup/SKILL.md`
- **AND** 该 skill 未被用户级 `skills.json` 禁用
- **THEN** skill catalog SHALL 包含 `echo-tui-setup`
- **THEN** 该 catalog entry 的 `sourceKind` SHALL 为 `user`

#### Scenario: use_skill 加载默认 setup skill
- **WHEN** `use_skill` 收到 `{ "name": "echo-tui-setup" }`
- **THEN** 系统 SHALL 按用户级 skill 读取 `~/.echo/skills/echo-tui-setup/SKILL.md`
- **THEN** tool result SHALL 包含该 skill 的正文内容

#### Scenario: 项目级同名 skill 仍然覆盖用户级默认 skill
- **WHEN** 当前工作区存在 `.echo/skills/echo-tui-setup/SKILL.md`
- **AND** 用户目录也存在 bootstrap 创建的 `~/.echo/skills/echo-tui-setup/SKILL.md`
- **THEN** 系统 SHALL 使用项目级 skill 的元数据和内容
- **THEN** catalog SHALL 只包含一条 `echo-tui-setup` 记录

#### Scenario: /skills 可管理默认 setup skill
- **WHEN** 用户提交纯 `/skills`
- **AND** 默认 setup skill 是当前生效的用户级 skill
- **THEN** `/skills` surface SHALL 展示 `echo-tui-setup` 及其 enabled/disabled 状态
- **THEN** 用户保存状态时 SHALL 使用用户级 skill root 的 `skills.json`

### Requirement: skill 模型策略持久化
系统 SHALL 支持在当前生效 skill source root 的 `skills.json` 中持久化按 skill 名称配置的可选 model profile override。未配置 override 的 skill SHALL 在每次显式调用时动态使用全局当前模型；固定 override SHALL 引用 LLM model profile ID，且 SHALL NOT 包含 provider 凭据或改写 `llm.selectedModel`。

#### Scenario: 未配置模型时跟随当前模型
- **WHEN** discovered skill 没有持久化 model profile override
- **THEN** 系统 SHALL 将该 skill 的模型策略显示为“当前模型”或等价动态状态
- **THEN** 用户显式调用该 skill 时 SHALL 使用调用开始时的全局当前 model profile

#### Scenario: 按生效 source root 读取固定模型
- **WHEN** 当前生效 skill 所属 root 的 `skills.json` 为该 skill 保存了有效 model profile ID
- **THEN** 系统 SHALL 将该 profile 作为该 skill 的固定模型策略
- **THEN** 同名但未生效的另一 source root 状态 SHALL NOT 覆盖该策略

#### Scenario: 旧状态文件保持兼容
- **WHEN** skill root 包含只有 `schemaVersion` 和 `disabled` 的旧状态文件
- **THEN** 系统 SHALL 保留该文件表达的 enabled/disabled 状态
- **THEN** 系统 SHALL 将所有未记录模型策略的 skill 视为使用当前模型

#### Scenario: 无效模型状态独立降级
- **WHEN** `skills.json` 的 disabled 字段有效但 model override 字段缺失或格式无效
- **THEN** 系统 SHALL 保留有效的 enabled/disabled 状态
- **THEN** 系统 SHALL 将该 root 的无效模型配置降级为空 override

### Requirement: /skills 行内管理模型策略
系统 SHALL 在现有 `/skills` 单层 surface 中展示每个 skill 的模型策略，并 SHALL 使用 Left/Right 在“当前模型”和已配置 model profiles 之间循环切换当前选中 skill 的草稿策略。系统 SHALL NOT 为模型选择打开下拉列表或二级菜单。

#### Scenario: 打开 surface 时展示模型策略
- **WHEN** 用户提交纯 `/skills` 且存在 discovered skills
- **THEN** 每个 skill 行 SHALL 展示其 enabled 状态、名称和当前模型策略
- **THEN** 未配置 override 的 skill SHALL 展示动态“当前模型”状态
- **THEN** 固定 override SHALL 展示可识别的 model profile label

#### Scenario: Left 和 Right 循环切换策略
- **WHEN** `/skills` surface 处于活跃状态且用户按 Left 或 Right
- **THEN** 系统 SHALL 按对应方向循环更新当前选中 skill 的模型策略草稿
- **THEN** 候选集合 SHALL 包含动态当前模型和全部有效 model profiles
- **THEN** 系统 SHALL NOT 立即写入 `skills.json` 或触发 agent 请求

#### Scenario: 当前 profile 可被固定选择
- **WHEN** 全局当前 profile 也出现在可选 model profiles 中
- **THEN** surface SHALL 同时提供动态“当前模型”和固定到该 profile 的两个不同策略
- **THEN** 用户后续修改全局模型时，只有动态策略 SHALL 跟随变化

#### Scenario: 保存 enabled 和模型草稿
- **WHEN** 用户在 `/skills` 中修改 enabled 状态或模型策略后按 Enter
- **THEN** 系统 SHALL 将两类草稿统一保存到各 skill 当前生效 source root 的 `skills.json`
- **THEN** 没有固定 override 的 skill SHALL 不写入模型映射项
- **THEN** 系统 SHALL 关闭 surface 且不触发 agent 请求

#### Scenario: 取消全部草稿
- **WHEN** 用户修改 enabled 状态或模型策略后按 Esc
- **THEN** 系统 SHALL 放弃两类草稿并关闭 surface
- **THEN** 系统 SHALL NOT 修改任何 skill state 文件

#### Scenario: 模型配置不可用时仍可管理 skill
- **WHEN** `/skills` 无法读取有效 model profile 列表
- **THEN** 系统 SHALL 继续展示并允许保存 enabled/disabled 状态
- **THEN** 模型策略 SHALL 只提供动态当前模型选项

### Requirement: 显式 slash skill invocation 使用单 turn 模型覆盖
系统 SHALL 仅在用户通过 `/<skill-name> [arguments...]` 显式调用 enabled skill 时应用该 skill 的有效 model profile override。覆盖 SHALL 在当前 agent 调用初始化时选择完整 provider 配置，并 SHALL NOT 修改全局模型选择或影响后续普通 turn。

#### Scenario: 固定模型执行显式 slash skill
- **WHEN** 用户显式调用配置了有效固定 model profile 的 enabled skill
- **THEN** 当前 agent turn SHALL 使用该 profile 对应的 provider、model、reasoning 配置和 context window
- **THEN** 当前 turn 的 tool continuation SHALL 继续使用同一模型配置

#### Scenario: 动态策略执行显式 slash skill
- **WHEN** 用户显式调用模型策略为“当前模型”的 enabled skill
- **THEN** 当前 agent turn SHALL 按普通配置规则使用调用开始时的全局当前 model profile

#### Scenario: 覆盖不改变全局选择
- **WHEN** 固定模型的显式 slash skill turn 完成、失败或被中断
- **THEN** `llm.selectedModel` SHALL 保持不变
- **THEN** 后续普通 user turn SHALL 使用届时的全局当前模型

#### Scenario: status line 标记当前固定覆盖
- **WHEN** 配置了有效固定 model profile 的显式 slash skill turn 正在执行
- **THEN** 系统 SHALL 在 user record 后追加一条仅本地可见的模型切换 notice，并说明覆盖仅限本轮
- **THEN** status line SHALL 将模型显示为 `<model> (SKILL override)`，而不是把 override 标记渲染成独立状态项
- **THEN** turn 完成、失败或被中断后 status line SHALL 恢复全局当前模型显示

#### Scenario: 已删除 profile 回退当前模型
- **WHEN** skill state 引用的 model profile ID 在调用开始时已不存在
- **THEN** 系统 SHALL 使用全局当前 model profile 执行该 slash skill
- **THEN** 系统 SHALL NOT 因陈旧 override 阻止 skill 加载或自动改写 skill state
- **THEN** status line SHALL NOT 显示 `SKILL override` 标记
- **THEN** 系统 SHALL NOT 追加模型切换 notice

### Requirement: 自主 use_skill 不触发模型切换
模型自主发起的 `use_skill` tool call SHALL 只加载 skill instructions 和 resources，且 SHALL NOT 读取或应用该 skill 的 model profile override。

#### Scenario: 普通 turn 自主加载配置了固定模型的 skill
- **WHEN** 普通 agent turn 中模型调用 `use_skill` 加载一个配置了固定 override 的 skill
- **THEN** agent turn SHALL 继续使用初始化时的当前模型
- **THEN** 系统 SHALL NOT 重建 provider 或切换到该 skill 的固定模型

#### Scenario: slash skill turn 中自主加载另一个 skill
- **WHEN** 显式 slash skill turn 已使用单 turn 模型覆盖
- **AND** 模型随后通过 `use_skill` 加载另一个具有不同 override 的 skill
- **THEN** 当前 turn SHALL 继续使用显式 slash invocation 初始化时选择的模型
- **THEN** 另一个 skill 的 override SHALL NOT 在 tool continuation 中生效
