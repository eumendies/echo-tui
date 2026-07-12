# command-host-runtime Specification

## Purpose
TBD - created by archiving change refactor-command-host. Update Purpose after archive.
## Requirements
### Requirement: CommandHost 受控命令能力
系统 SHALL 提供 `CommandHost` 作为 slash command handler 访问 app 能力的受控 facade。handler SHALL 通过 `CommandHost` 执行 command session、composer、transcript、model、compaction 和 UI 相关行为；handler SHALL NOT 直接接收完整 `AppContext`、renderer、terminal 或 agent 实例。

#### Scenario: handler 通过 host 打开命令会话
- **WHEN** 某个本地 slash 命令被启动
- **THEN** 对应 handler SHALL 通过 `CommandHost.session.open` 打开 command session
- **THEN** handler SHALL NOT 返回打开 command session 的业务 effect

#### Scenario: handler 通过 host 执行业务动作
- **WHEN** 某个 slash 命令确认后需要清空 transcript、恢复 session、保存模型选择或触发手动压缩
- **THEN** 对应 handler SHALL 调用 `CommandHost` 暴露的领域能力
- **THEN** command runtime SHALL NOT 为该业务动作新增 effect type 或 switch 分支

#### Scenario: host 不暴露裸 AppContext
- **WHEN** handler 需要读取或修改 app 状态
- **THEN** handler SHALL 只能使用 `CommandHost` 的受控方法
- **THEN** handler SHALL NOT 直接访问 `AppContext`、`TranscriptStore`、renderer 或 terminal controller

### Requirement: CommandRuntime 只管理命令运行态
系统 SHALL 让 `CommandRuntime` 负责 slash command 路由、active command session、surface 快照和输入事件分发。`CommandRuntime` SHALL NOT 解释 transcript、model、compaction 等业务 effect，也 SHALL NOT 依赖为每个业务动作新增的 app callback。

#### Scenario: 启动命令时传入 host
- **WHEN** 用户提交文本命中某个 slash handler
- **THEN** `CommandRuntime` SHALL 调用 `handler.start(text, host)`
- **THEN** `CommandRuntime` SHALL 根据当前 active command session 提供 surface 快照

#### Scenario: 活跃会话事件转发给 handler
- **WHEN** active command session 存在且用户输入非退出事件
- **THEN** `CommandRuntime` SHALL 调用该 session 的 `handler.handleEvent(session, event, host)`
- **THEN** `CommandRuntime` SHALL 保持 active command session 的所有权

#### Scenario: runtime 不解释业务 effect
- **WHEN** handler 需要执行清空 transcript、恢复 session、保存模型选择或触发手动压缩
- **THEN** handler SHALL 直接调用 `CommandHost`
- **THEN** `CommandRuntime` SHALL NOT 包含这些业务动作的 effect interpreter 分支

### Requirement: CommandHost 承载手动压缩触达路径
系统 SHALL 将 `/compact` 确认后的手动压缩触达路径从 `main.ts` 和 command effect interpreter 中移出，并通过 `CommandHost` 提供给 command handler。手动压缩 SHALL 保持现有强制压缩、responding 锁、working spinner、结果反馈和错误处理语义。

#### Scenario: /compact 确认后通过 host 触发压缩
- **WHEN** `/compact` command session 处于活跃状态且用户按下 Enter
- **THEN** handler SHALL 关闭 command session 并清空 composer
- **THEN** handler SHALL 通过 `CommandHost` 触发手动压缩
- **THEN** 系统 SHALL NOT 通过 `REQUEST_MANUAL_COMPACTION` effect 触发该流程

#### Scenario: 手动压缩流程不留在 main
- **WHEN** command host 处理手动压缩请求
- **THEN** 系统 SHALL 在 command host 相关实现中完成 agent 准备、强制压缩、应用结果和错误反馈
- **THEN** `src/app/main.ts` SHALL NOT 为 `/compact` 保留独立的 `runManualCompactionTurn` 业务函数

### Requirement: 新增命令的最小改动面
系统 SHALL 使新增本地 slash command 的主要改动集中在 command handler 和命令注册列表。只有当新增命令需要新的通用 app 能力时，才 SHALL 扩展 `CommandHost` 的受控领域接口。对于 mode 切换这类 app 状态，`CommandHost` SHALL 暴露受控的 interaction mode getter/setter，而不是要求 handler 直接操作完整 AppContext。对于 context usage 详情这类只读状态，`CommandHost` SHALL 暴露受控的 context usage getter，而不是要求 handler 直接读取完整 AppContext。

#### Scenario: 新增只使用已有 host 能力的命令
- **WHEN** 开发者新增一个只需要已有 host 能力的本地 slash command
- **THEN** 开发者 SHALL 只需要新增 handler 并在 slash command 注册列表中注册
- **THEN** 开发者 SHALL NOT 修改 `CommandRuntime` 的业务 switch 或 `main.ts` 的业务 callback

#### Scenario: 新增需要通用能力的命令
- **WHEN** 新命令需要当前 `CommandHost` 尚未暴露的通用 app 能力
- **THEN** 开发者 MAY 扩展 `CommandHost` 对应领域接口
- **THEN** 该扩展 SHALL 保持受控 facade 语义，而不是把完整 app 内部对象透传给 handler

#### Scenario: mode command uses interaction mode facade
- **WHEN** `/mode` command handler 需要读取或设置当前 interaction mode
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 mode 领域能力访问 interaction mode
- **THEN** handler SHALL NOT 直接访问完整 `AppContext`
- **AND** handler SHALL NOT 自行维护额外 mode 映射状态

#### Scenario: context command uses context usage facade
- **WHEN** `/context` command handler 需要读取最近一次 provider context usage
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 context usage 领域能力访问该状态
- **THEN** handler SHALL NOT 直接访问完整 `AppContext`
- **AND** handler SHALL NOT 自行重建 provider request 或重新估算当前 transcript

### Requirement: 默认 slash command 集合使用 mode command
系统 SHALL 在默认 slash command handlers 中注册 `/mode` command，用于切换 interaction mode。系统 SHALL NOT 在默认 slash command handlers 中注册 `/plan` command。

#### Scenario: default handlers expose mode command
- **WHEN** 系统创建默认 slash command handlers
- **THEN** handlers SHALL 包含 `/mode` command
- **AND** slash command descriptors SHALL 包含 `/mode` 的说明

#### Scenario: default handlers do not expose plan command
- **WHEN** 系统创建默认 slash command handlers
- **THEN** handlers SHALL NOT 包含 `/plan` command
- **AND** slash command descriptors SHALL NOT 包含 `/plan`

### Requirement: slash command 可转换为 user message 继续提交
系统 SHALL 支持 slash command handler 在启动时返回“将当前输入转换为 user message 并继续普通提交”的结果。该结果 SHALL 由 command runtime 传回 app 提交流程，后续 agent turn SHALL 复用普通用户消息提交路径。

#### Scenario: handler 返回 user message 提交结果
- **WHEN** slash command handler 启动后返回转换后的 user message 文本
- **THEN** command runtime SHALL 将该结果返回给 app 提交流程
- **THEN** app SHALL 追加该 user message transcript record 并触发普通 agent 请求
- **THEN** command runtime SHALL NOT 自行执行 agent streaming 或 tool continuation

#### Scenario: 既有命令保持消费语义
- **WHEN** 既有 slash command handler 启动后不返回 user message 提交结果
- **THEN** command runtime SHALL 继续把该输入视为已由命令消费
- **THEN** app SHALL NOT 因该命令启动而触发普通 agent 请求

### Requirement: CommandHost 暴露 skill 管理能力
系统 SHALL 通过 `CommandHost` 向 skill 相关 slash command handler 暴露受控 skill 能力。handler SHALL 通过该能力列出 skill、加载 enabled skill、保存 enabled/disabled 状态并创建 slash skill user message；handler SHALL NOT 直接访问完整 AppContext、renderer 或 agent 实例。

#### Scenario: handler 通过 host 读取 skill 列表
- **WHEN** `/skills` command handler 需要展示 skill
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 skill 领域能力获取列表
- **THEN** handler SHALL NOT 直接扫描文件系统中的 skill root

#### Scenario: handler 通过 host 保存 skill 状态
- **WHEN** `/skills` command handler 确认保存 enabled/disabled 草稿状态
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 skill 领域能力保存状态
- **THEN** handler SHALL NOT 直接写入 renderer、terminal 或完整 app 内部状态

#### Scenario: direct skill handler 通过 host 创建注入消息
- **WHEN** direct skill invocation handler 命中 enabled skill
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 skill 领域能力加载 skill 并创建 user message 文本与 metadata
- **THEN** handler SHALL 返回 user message 提交结果给 command runtime

### Requirement: CommandHost 暴露 MCP 管理能力
系统 SHALL 通过 `CommandHost` 向 `/mcp` command handler 暴露受控 MCP 管理能力。handler SHALL 通过该能力列出 MCP 全局/server 草稿状态、保存 enabled 状态并触发 MCP reload；handler SHALL NOT 直接访问完整 `AppContext`、renderer、terminal 或裸 `McpManager` 内部状态。

#### Scenario: handler 通过 host 读取 MCP 状态
- **WHEN** `/mcp` command handler 需要展示 MCP 管理面板
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 MCP 领域能力获取全局和 server 状态
- **THEN** handler SHALL NOT 直接读取 `~/.echo/config.json`

#### Scenario: handler 通过 host 保存 MCP 状态
- **WHEN** `/mcp` command handler 确认保存 enabled 草稿状态
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 MCP 领域能力保存状态
- **THEN** host SHALL 负责执行配置写回、MCP manager reload 和 context usage 清理
- **THEN** handler SHALL NOT 直接操作 renderer、terminal 或完整 app 内部状态

#### Scenario: command runtime 不解释 MCP 业务 effect
- **WHEN** `/mcp` command 保存或取消
- **THEN** command handler SHALL 直接调用 `CommandHost` 或关闭 command session
- **THEN** `CommandRuntime` SHALL NOT 为 MCP 保存新增业务 effect interpreter 分支

### Requirement: CommandHost 暴露 memory 管理能力
系统 SHALL 通过 `CommandHost` 向 `/memory` command handler 暴露受控的 memory 列表读取、新增、更新和删除能力。handler SHALL 仅通过该 facade 访问 memory 存储，且 SHALL NOT 直接访问完整 `AppContext`、文件系统、renderer、terminal 或 agent 实例。

#### Scenario: memory handler 通过 host 读取和保存
- **WHEN** `/memory` command handler 需要展示、创建、编辑或删除用户 memory
- **THEN** handler SHALL 调用 `CommandHost` 的 memory 领域能力
- **THEN** host SHALL 负责调用 memory 存储并返回结构化成功或失败结果

#### Scenario: 默认命令集合注册 memory command
- **WHEN** 系统创建默认 slash command handlers
- **THEN** handlers SHALL 包含 `/memory` command
- **THEN** slash command descriptors SHALL 包含 `/memory` 的说明

#### Scenario: command runtime 不解释 memory 业务 effect
- **WHEN** `/memory` command 浏览、编辑、保存、删除或取消
- **THEN** command handler SHALL 直接调用 `CommandHost` 或更新 command session
- **THEN** `CommandRuntime` SHALL NOT 为 memory 流程新增业务 effect interpreter 分支

### Requirement: 默认 slash command 集合注册内置 agent workflows
系统 SHALL 在默认 slash command handlers 中注册内置 agent workflow handlers，并 SHALL 将它们排列在通用 direct skill invocation fallback 之前。workflow handler SHALL 复用现有 `submit_user_message` 结果和 `CommandHost` 受控能力。

#### Scenario: 默认 handlers 包含内置 workflows
- **WHEN** 系统创建默认 slash command handlers
- **THEN** handlers SHALL 包含 `/init` 和 `/review` 内置 workflows
- **THEN** slash command descriptors SHALL 包含 `/init` 和 `/review` 的说明

#### Scenario: workflow handler 位于 skill fallback 之前
- **WHEN** 系统装配默认 slash command handlers
- **THEN** 所有内置 agent workflow handlers SHALL 位于 `SkillInvocationCommandHandler` 之前
- **THEN** command runtime SHALL 继续按既有顺序匹配第一个命中的 handler

#### Scenario: workflow 使用现有 host 和提交结果
- **WHEN** 内置 workflow 需要读取或设置 interaction mode 并启动 agent turn
- **THEN** handler SHALL 通过 `CommandHost.mode` 访问 mode
- **THEN** handler SHALL 返回现有 `submit_user_message` 结果
- **THEN** `CommandHost` SHALL NOT 暴露裸 agent 或 tool executor

### Requirement: CommandHost 暴露复制命令所需能力
系统 SHALL 通过 `CommandHost` 向 `/copy` command handler 暴露受控的可复制 transcript 读取能力和剪贴板写入能力。handler SHALL NOT 直接访问完整 `AppContext`、renderer、terminal controller 或系统剪贴板命令实现。

#### Scenario: handler 通过 host 读取可复制消息
- **WHEN** `/copy` command handler 需要构建复制面板
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 transcript 复制读取能力获取 user/assistant 消息快照
- **THEN** handler SHALL NOT 直接遍历完整 `AppContext` 或 transcript store 内部对象

#### Scenario: handler 通过 host 写入剪贴板
- **WHEN** `/copy` command handler 确认复制选中消息
- **THEN** handler SHALL 通过 `CommandHost` 暴露的 clipboard 能力写入文本
- **THEN** handler SHALL NOT 直接执行 `pbcopy`、`clip`、`wl-copy`、`xclip`、`xsel` 或其他系统命令

#### Scenario: command runtime 不解释复制业务 effect
- **WHEN** `/copy` command 读取消息、更新选择、确认复制或处理失败
- **THEN** command handler SHALL 直接调用 `CommandHost` 或更新 command session
- **THEN** `CommandRuntime` SHALL NOT 为复制流程新增业务 effect interpreter 分支

### Requirement: 剪贴板写入结果结构化
系统 SHALL 将剪贴板写入结果表达为结构化成功或失败结果，使 command handler 可以展示稳定的用户反馈。失败结果 SHALL 包含可读错误信息或失败原因。

#### Scenario: 剪贴板写入成功
- **WHEN** host clipboard 能力成功写入文本
- **THEN** 该能力 SHALL 返回成功结果
- **THEN** `/copy` command handler SHALL 能据此关闭 command session 并展示成功反馈

#### Scenario: 剪贴板写入失败
- **WHEN** host clipboard 能力无法找到可用剪贴板工具或写入过程失败
- **THEN** 该能力 SHALL 返回失败结果
- **THEN** 失败结果 SHALL 包含可展示给用户的原因
- **THEN** `/copy` command handler SHALL 能据此保持 surface 打开并展示失败提示

