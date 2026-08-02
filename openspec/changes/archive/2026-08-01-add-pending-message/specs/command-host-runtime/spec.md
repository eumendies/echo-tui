## MODIFIED Requirements

### Requirement: CommandHost 受控命令能力
系统 SHALL 提供 `CommandHost` 作为 slash command handler 访问 app 能力的受控 facade。handler SHALL 通过 `CommandHost` 执行 command session、transcript、model、compaction 和 UI 相关行为；handler SHALL NOT 直接接收完整 `AppContext`、renderer、terminal 或 agent 实例。普通 composer 输入 SHALL 在进入 command runtime 前由提交层统一消费，`CommandHost` SHALL NOT 暴露 composer reset 能力。

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

#### Scenario: command handler 不重复消费 composer
- **WHEN** `submitComposer()` 已记录并清空被接受的 slash 输入
- **THEN** command handler SHALL NOT 再次重置当前 live composer
- **THEN** queued command 执行期间 SHALL 保留用户后来输入的草稿

### Requirement: CommandHost 承载手动压缩触达路径
系统 SHALL 将 `/compact` 确认后的手动压缩触达路径从 `main.ts` 和 command effect interpreter 中移出，并通过 `CommandHost` 提供给 command handler。手动压缩 SHALL 保持现有强制压缩、responding 锁、working spinner、结果反馈和错误处理语义。

#### Scenario: /compact 确认后通过 host 触发压缩
- **WHEN** `/compact` command session 处于活跃状态且用户按下 Enter
- **THEN** handler SHALL 关闭 command session
- **THEN** handler SHALL 通过 `CommandHost` 触发手动压缩
- **THEN** 系统 SHALL NOT 通过 `REQUEST_MANUAL_COMPACTION` effect 触发该流程

#### Scenario: 手动压缩流程不留在 main
- **WHEN** command host 处理手动压缩请求
- **THEN** 系统 SHALL 在 command host 相关实现中完成 agent 准备、强制压缩、应用结果和错误反馈
- **THEN** `src/app/main.ts` SHALL NOT 为 `/compact` 保留独立的 `runManualCompactionTurn` 业务函数
