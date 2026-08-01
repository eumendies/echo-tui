## ADDED Requirements

### Requirement: Active assistant turn 期间可排队一条用户输入
系统 SHALL 在 active assistant turn 占用 response lock 时，允许用户通过 Enter 将当前非空 composer 草稿排为一条待发送输入。待发送输入 SHALL 保存在独立 transient 单槽状态中；排队时 SHALL 消费当时的 composer 草稿，但 SHALL NOT 追加 transcript record、启动新的 provider request 或把该输入注入当前 assistant turn。

#### Scenario: 响应期间排队非空草稿
- **WHEN** active assistant turn 正在 thinking、streaming、执行工具或等待 continuation
- **AND** composer 包含非空输入且当前没有待发送消息
- **AND** 用户按 Enter
- **THEN** 系统 SHALL 保存一条待发送原始文本
- **THEN** 系统 SHALL 清空当时的 composer 草稿并允许用户继续编辑
- **THEN** 当前 transcript 和正在运行的 provider request SHALL 不包含该待发送输入

#### Scenario: 空 composer 不创建待发送消息
- **WHEN** active assistant turn 仍在运行且 composer 为空
- **AND** 用户按 Enter
- **THEN** 系统 SHALL NOT 创建待发送消息
- **THEN** 系统 SHALL NOT 追加 user transcript record 或启动新的 provider request

#### Scenario: 单槽已有消息时不覆盖
- **WHEN** active assistant turn 仍在运行且已经存在一条待发送消息
- **AND** 用户在 composer 输入另一条草稿后按 Enter
- **THEN** 系统 SHALL 保留原待发送消息不变
- **THEN** 系统 SHALL 保留当前 composer 草稿不变
- **THEN** 系统 SHALL NOT 创建第二条待发送消息

#### Scenario: 非 assistant response lock 不借用待发送队列
- **WHEN** 系统处于 shell command、手动 compact、MCP bootstrap 或 conversation reference preparation 状态且没有 active assistant turn
- **AND** 用户按 Enter
- **THEN** 系统 SHALL 遵循该状态已有的提交或阻止语义
- **THEN** 系统 SHALL NOT 因该 Enter 创建 pending message

### Requirement: 待发送输入在当前 turn 结束后按正常路由处理
系统 SHALL 在当前 active assistant turn 释放 response lock 后原子取得待发送输入，并通过普通 composer submit 使用的同一输入路由处理。待发送输入在真正开始 user turn 时 SHALL 追加为 user transcript record；该 record SHALL 位于前一 turn 已提交的 assistant、error 或 interruption 事实之后。slash command、skill invocation 和 file mention SHALL 保持普通提交时的既有解释规则；排队的 `/reference` SHALL 在 turn 结束后打开引用选择器，而不是提前携带引用附件。

#### Scenario: 当前回答完成后自动发送
- **WHEN** active assistant turn 正常完成并已提交最终 assistant record
- **AND** 存在一条待发送普通用户消息
- **THEN** 系统 SHALL 原子消费该待发送消息并开始下一次 user turn
- **THEN** queued user record SHALL 出现在前一 assistant record 之后
- **THEN** 下一次 provider request SHALL 包含前一 turn 的已完成上下文

#### Scenario: 当前回答失败后处理待发送消息
- **WHEN** active assistant turn 因 provider 或 agent 错误结束并已提交 error record
- **AND** 存在一条待发送消息
- **THEN** 系统 SHALL 在 error record 之后通过正常输入路由处理待发送消息
- **THEN** 系统 SHALL NOT 把待发送消息合并进失败的旧 turn

#### Scenario: 排队的 slash 输入保持命令语义
- **WHEN** 待发送输入在正常 idle submit 时会匹配本地 slash command 或 skill invocation
- **AND** 当前 active assistant turn 已结束
- **THEN** 系统 SHALL 使用正常 command runtime 解释该输入
- **THEN** 系统 SHALL NOT 为了自动处理而强制把 slash 文本作为普通模型消息发送

### Requirement: 自动发送不得破坏后来输入的 composer 草稿
系统 SHALL 将待发送文本与当前 live composer 分离。用户排队后输入的新草稿 SHALL 在待发送消息的自动处理、user turn 启动和响应期间保持其文本与光标状态，除非用户明确编辑或提交该新草稿。排队时的输入历史 SHALL 只记录一次。

#### Scenario: 自动发送时保留下一条草稿
- **WHEN** 用户已排队消息 A，并在当前 turn 结束前于 composer 输入草稿 B
- **AND** 系统自动开始处理消息 A
- **THEN** composer SHALL 继续显示草稿 B
- **THEN** 消息 A 的 user turn 启动 SHALL NOT 重置草稿 B 或移动其逻辑光标

#### Scenario: 排队输入历史不重复
- **WHEN** 消息 A 在排队时已记录为一次用户输入历史
- **AND** 系统随后自动处理消息 A
- **THEN** 输入历史 SHALL NOT 再追加一份重复的消息 A

### Requirement: 待发送消息使用有界 composer 卡片展示
系统 SHALL 在普通 composer 上方显示待发送消息的 transient 卡片。卡片 SHALL 表达该消息会在当前回答结束后处理，并展示经过单行化和安全宽度截断的有界预览；卡片 SHALL NOT 展开完整多行正文。卡片 SHALL 作为 composer input surface 的组成参与 footer 高度预算，而不是写入 transcript 或在 footer layout 外追加。

#### Scenario: 显示待发送消息预览
- **WHEN** 当前存在一条待发送消息且普通 composer surface 可见
- **THEN** footer SHALL 在 composer 上方显示待发送状态和有界消息预览
- **THEN** 卡片 SHALL 提供移除该待发送消息的操作提示
- **THEN** 卡片 SHALL NOT 显示完整多行消息

#### Scenario: 长消息不会撑高卡片
- **WHEN** 待发送消息包含多行文本或超过当前 terminal safe render width
- **THEN** renderer SHALL 将预览压为单行并按显示宽度截断
- **THEN** 卡片 SHALL 使用固定有界行数而不随正文长度增长

#### Scenario: 与 streaming preview 共享高度预算
- **WHEN** 长 assistant streaming preview、待发送卡片和 composer 同时可见
- **THEN** renderer SHALL 先预算 composer input surface 并缩减 assistant preview
- **THEN** footer layout 总行数 SHALL 不超过 `rows - 2`
- **THEN** footer SHALL NOT 把待发送卡片作为额外输出推入 scrollback

### Requirement: 待发送消息生命周期和并发收尾可控
系统 SHALL 在显式移除、成功 claim、`/clear`、成功 `/resume` 或应用退出时清理 transient pending message。待发送状态 SHALL NOT 持久化到 transcript journal。旧 assistant turn 的迟到 token、tool result、complete 或 finally 收尾 SHALL NOT 重复处理已 claim 的消息，也 SHALL NOT 清除后续 turn 或 live composer 状态。

#### Scenario: 显式移除不污染 transcript
- **WHEN** 用户移除当前待发送消息
- **THEN** 系统 SHALL 清空 pending message state 并重绘 footer
- **THEN** 系统 SHALL NOT 为该消息追加 user、assistant、error 或 local notice record

#### Scenario: 会话切换和清空清理待发送消息
- **WHEN** 用户成功执行 `/clear` 或通过 `/resume` 加载其他 session
- **THEN** 系统 SHALL 清理任何待发送消息
- **THEN** 清理 SHALL NOT 修改已经持久化的 transcript records

#### Scenario: 进程重启不恢复待发送消息
- **WHEN** 应用退出时存在未处理的待发送消息
- **THEN** 系统 SHALL NOT 将该消息写入 transcript journal
- **THEN** 后续进程启动或 session 恢复 SHALL NOT 自动恢复或发送该消息

#### Scenario: 旧 turn 迟到完成不重复发送
- **WHEN** 待发送消息已被新 turn 原子 claim
- **AND** 旧 turn 随后触发迟到 complete、token 或 finally
- **THEN** 系统 SHALL 忽略旧 turn 对 pending-message dispatch 的影响
- **THEN** 同一待发送消息 SHALL 只被处理一次

#### Scenario: 自动处理预处理期间不并发提交 composer
- **WHEN** 已 claim 的待发送消息正在执行异步提交预处理且尚未进入 response lock
- **AND** 用户再次按 Enter 提交 live composer
- **THEN** 系统 SHALL 拒绝该次并发提交并保留 live composer 内容
