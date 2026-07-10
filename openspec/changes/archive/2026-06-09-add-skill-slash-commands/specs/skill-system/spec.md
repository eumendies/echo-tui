## ADDED Requirements

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
- **THEN** `/skills manage` 保存该 skill 状态时 SHALL 写入项目级 skill root 的状态文件，而不是用户级状态文件

#### Scenario: 状态文件损坏时安全降级
- **WHEN** skill root 下的 `skills.json` 不可读、不是合法 JSON 或 disabled 字段无效
- **THEN** 系统 SHALL NOT 阻止 TUI 启动或普通 agent 请求
- **THEN** 系统 SHALL 对该 root 下 discovered skills 使用默认 enabled 状态

### Requirement: skills list 和 manage 命令
系统 SHALL 提供 `/skills list` 与 `/skills manage` slash commands。`/skills list` SHALL 只读展示所有 discovered skills 及其 enabled/disabled 状态；`/skills manage` SHALL 允许用户在 checkbox surface 中批量切换 skill 启用状态并保存。

#### Scenario: /skills 等价 list
- **WHEN** 用户提交 `/skills`
- **THEN** 系统 SHALL 按 `/skills list` 语义展示 skill 列表
- **THEN** 系统 SHALL NOT 触发 agent 请求

#### Scenario: /skills list 展示所有 skill
- **WHEN** 用户提交 `/skills list`
- **THEN** 系统 SHALL 展示所有有效 discovered skills
- **THEN** 每个 skill SHALL 显示名称、描述、来源和 enabled/disabled 状态
- **THEN** disabled skill SHALL 仍出现在列表中

#### Scenario: /skills manage 打开 checkbox surface
- **WHEN** 用户提交 `/skills manage`
- **THEN** 系统 SHALL 打开包含所有有效 discovered skills 的 checkbox command surface
- **THEN** 每个 checkbox 初始状态 SHALL 反映当前持久化 enabled 状态
- **THEN** disabled skill SHALL 仍出现在 manage surface 中以便重新启用

#### Scenario: manage 中确认保存状态
- **WHEN** `/skills manage` surface 处于活跃状态且用户切换若干 skill 后按 Enter
- **THEN** 系统 SHALL 将草稿状态保存到对应 skill root 的 `skills.json`
- **THEN** 系统 SHALL 关闭 command session 并清空 composer
- **THEN** 系统 SHALL NOT 触发 agent 请求

#### Scenario: manage 中取消不保存
- **WHEN** `/skills manage` surface 处于活跃状态且用户切换若干 skill 后按 Esc
- **THEN** 系统 SHALL 放弃草稿状态
- **THEN** 系统 SHALL NOT 修改任何 skill 状态文件
- **THEN** 系统 SHALL 关闭 command session 并清空 composer

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
- **THEN** 系统 SHALL 展示该 skill 已禁用并可通过 `/skills manage` 启用的提示
- **THEN** 系统 SHALL NOT 将该 slash 文本作为普通 user message 发送给 agent

#### Scenario: 输入历史保留原始 slash 文本
- **WHEN** 用户通过 slash 直接调用 skill 并触发 agent
- **THEN** transcript 中的 user record SHALL 包含加载后的 skill 内容
- **THEN** composer 历史 SHALL 记录用户输入的原始 slash 文本，而不是完整 skill 正文

### Requirement: slash skill suggestion 只显示 enabled skills
系统 SHALL 在 slash suggestion 中显示内置 slash commands 和当前 enabled skills 对应的 direct invocation entries。disabled skills SHALL NOT 出现在 slash suggestion 中，但仍 SHALL 出现在 `/skills list` 和 `/skills manage` 中。

#### Scenario: disabled skill 不提示
- **WHEN** 某个 discovered skill 被状态文件标记为 disabled
- **THEN** slash suggestion SHALL NOT 包含 `/<skill-name>` entry
- **THEN** `/skills list` SHALL 仍展示该 skill 及 disabled 状态
- **THEN** `/skills manage` SHALL 仍展示该 skill 及 unchecked 状态

#### Scenario: manage 保存后 suggestion 立即刷新
- **WHEN** 用户在 `/skills manage` 中禁用某个 skill 并按 Enter 保存
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
