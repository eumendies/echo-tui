## ADDED Requirements

### Requirement: response 活跃期间 Esc 中断交互
系统 SHALL 在普通 TUI 输入事件分发中识别 assistant response 活跃期间的 Esc。没有更高优先级交互 surface 时，Esc SHALL 中断当前 assistant response，而不是作为 no-op；中断过程 SHALL 使用现有 footer/transcript 渲染边界，避免重放 banner 或已提交历史区域。

#### Scenario: response 活跃时 Esc 不编辑 composer
- **WHEN** assistant response 正在 thinking 或 streaming
- **AND** 用户按下 Esc
- **THEN** 系统 SHALL 不修改 composer 文本或光标位置
- **THEN** 系统 SHALL 请求中断当前 assistant response

#### Scenario: 中断后 footer 回到普通输入态
- **WHEN** 用户按 Esc 中断当前 assistant response
- **THEN** footer SHALL 清空 pending preview
- **THEN** footer SHALL 恢复普通 composer 与 status line 输入界面
- **THEN** 用户 SHALL 能继续输入下一条消息

#### Scenario: 中断追加 transcript 前清理 footer
- **WHEN** 中断收尾需要追加 partial assistant 或本地中断提示 record
- **THEN** 系统 SHALL 先移除临时 footer
- **THEN** 系统 SHALL 追加对应 transcript block
- **THEN** 系统 SHALL 在追加完成后重绘 footer

### Requirement: 本地中断提示渲染
系统 SHALL 为本地中断提示 record 提供可见投影。该提示 SHALL 使用区别于 user、assistant 和 error 的克制样式，可复用压缩提示的弱化视觉层级，但 role 语义 SHALL 表示本地中断提示。

#### Scenario: 渲染中断提示
- **WHEN** transcript records 包含本地中断提示 record
- **THEN** transcript renderer SHALL 为该 record 生成可见消息块
- **THEN** 该消息块 SHALL 不显示为 assistant 回复或 error 反馈

#### Scenario: resize 后重新投影中断提示
- **WHEN** 当前 transcript records 包含本地中断提示 record，且 terminal columns 变化触发 app snapshot 重绘
- **THEN** 中断提示 SHALL 按新的 terminal width 重新计算可见投影
- **THEN** 重绘 SHALL NOT 删除或隐藏该提示

### Requirement: response 中断后持久化
系统 SHALL 将中断收尾产生的 partial assistant record 与本地中断提示 record 保存到当前 transcript session。中断提示 SHALL 参与 `/resume` 恢复显示，但不参与 provider input。

#### Scenario: 中断提示保存到 session
- **WHEN** 用户按 Esc 中断当前 assistant response 且系统追加本地中断提示 record
- **THEN** 系统 SHALL 更新当前 session 的 records 和 `updatedAt`
- **THEN** 保存内容 SHALL 包含该本地中断提示 record

#### Scenario: partial assistant 和中断提示顺序保存
- **WHEN** 用户按 Esc 中断当前 assistant response 且已存在 partial assistant draft
- **THEN** session 中 SHALL 先保存 partial assistant record
- **THEN** session 中 SHALL 在其后保存本地中断提示 record
