## ADDED Requirements

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
系统 SHALL 使新增本地 slash command 的主要改动集中在 command handler 和命令注册列表。只有当新增命令需要新的通用 app 能力时，才 SHALL 扩展 `CommandHost` 的受控领域接口。

#### Scenario: 新增只使用已有 host 能力的命令
- **WHEN** 开发者新增一个只需要已有 host 能力的本地 slash command
- **THEN** 开发者 SHALL 只需要新增 handler 并在 slash command 注册列表中注册
- **THEN** 开发者 SHALL NOT 修改 `CommandRuntime` 的业务 switch 或 `main.ts` 的业务 callback

#### Scenario: 新增需要通用能力的命令
- **WHEN** 新命令需要当前 `CommandHost` 尚未暴露的通用 app 能力
- **THEN** 开发者 MAY 扩展 `CommandHost` 对应领域接口
- **THEN** 该扩展 SHALL 保持受控 facade 语义，而不是把完整 app 内部对象透传给 handler
