## ADDED Requirements

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

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: skills list 和 manage 命令
**Reason**: `/skills manage` 已经覆盖 `/skills list` 的信息展示能力，保留 list/manage 子命令会增加入口复杂度；当前未封版，不需要兼容旧子命令。

**Migration**: 使用纯 `/skills` 打开新的 skills manager surface，完成查看、启用、禁用和保存。
