## ADDED Requirements

### Requirement: reasoning streaming pending preview
系统 SHALL 在 assistant response 期间将尚未完成的可读 reasoning draft 作为独立 `reasoning_streaming` footer pending preview 展示。reasoning complete 到达后，系统 SHALL 立即将权威 summary 追加为 transcript 并清空 reasoning pending；后续 assistant token SHALL 使用独立 `streaming` pending。未完成的 reasoning preview SHALL NOT 写入 transcript、session journal、provider-facing input 或最终 assistant 正文。

#### Scenario: reasoning 先于正文到达
- **WHEN** assistant response 已启动且 provider 返回可读 reasoning draft，但尚未返回 assistant 正文文本增量
- **THEN** footer pending preview SHALL 显示 reasoning preview
- **THEN** transcript SHALL NOT 因该 reasoning preview 追加 `reasoning_summary` record
- **THEN** composer 和 status line SHALL 继续保持响应中的可见状态

#### Scenario: reasoning 完成后立即落盘
- **WHEN** provider 在 assistant 正文完成前确认非空 reasoning summary 已完成
- **THEN** reasoning pending preview SHALL 被清空
- **THEN** transcript SHALL 立即追加 `reasoning_summary` record
- **THEN** 后续 assistant 正文 token SHALL 进入 `streaming` pending
- **THEN** 最终 `assistant` record SHALL 在该 reasoning summary 之后追加

#### Scenario: 不支持可读 reasoning 时保持现有 streaming
- **WHEN** provider turn 未返回可读 reasoning draft
- **THEN** footer SHALL 继续按既有 assistant 正文 streaming preview 展示文本增量
- **THEN** 系统 SHALL NOT 显示空 reasoning preview 或占用额外 pending 行

### Requirement: reasoning preview 高度受限
reasoning preview SHALL 独立接受 footer 剩余高度预算。renderer SHALL 保证 reasoning pending preview 的总行数不超过当前 footer 预算；长 reasoning SHALL 在 terminal projection 后折叠头部并显示尾部内容。

#### Scenario: 长 reasoning 预算受限
- **WHEN** assistant response 的 reasoning draft 投影后总行数超过 footer pending 预算
- **THEN** footer SHALL 只显示预算内的 reasoning pending preview 行
- **THEN** reasoning preview SHALL 被折叠为摘要加尾部内容
- **THEN** footer layout 的总行数 SHALL 仍不超过当前 terminal rows 允许的高度

#### Scenario: 只有 reasoning preview 时使用 pending 预算
- **WHEN** assistant response 只有 reasoning draft 且没有 assistant 正文 draft
- **THEN** footer SHALL 在 pending 预算内显示 reasoning preview
- **THEN** 长 reasoning preview SHALL 折叠头部并显示尾部内容
- **THEN** footer SHALL NOT 因 reasoning draft 变长而把 pending preview 无限追加到 terminal scrollback

#### Scenario: resize 后重新计算 reasoning preview
- **WHEN** reasoning preview 可见期间发生 terminal resize recovery
- **THEN** destructive 或 footer redraw SHALL 基于当前 terminal size 重新计算 reasoning pending preview 预算
- **THEN** 重绘后的 reasoning pending preview SHALL 不超过新的 footer 高度预算

### Requirement: reasoning preview 生命周期清理
reasoning streaming preview SHALL 跟随当前 assistant turn 生命周期清理。reasoning complete、成功完成、tool call handoff、失败、取消或旧 turn 回调失效时，系统 SHALL 清理 transient reasoning preview，避免旧 reasoning draft 污染后续 footer 或 transcript。失败或取消前仅在 footer 中出现过且尚未 complete 的 partial reasoning SHALL NOT 被持久化为 `reasoning_summary` record；已经 complete 并提交的 reasoning SHALL 作为已发生事实保留。

#### Scenario: 失败时清理 partial reasoning preview
- **WHEN** provider 在显示 reasoning preview 后、发出 reasoning complete 前失败
- **THEN** footer pending preview SHALL 被清空
- **THEN** 系统 SHALL NOT 将 partial reasoning preview 追加为 `reasoning_summary` record
- **THEN** 系统 SHALL 继续按既有失败路径追加本地 `error` transcript record

#### Scenario: reasoning 完成后正文失败
- **WHEN** reasoning complete 已追加 transcript
- **AND** 后续 assistant 正文 stream 失败
- **THEN** 已提交的 `reasoning_summary` SHALL 保留
- **THEN** 系统 SHALL 继续按既有 partial assistant 与 error 语义收尾

#### Scenario: 用户中断时清理 reasoning preview
- **WHEN** 用户在 reasoning preview 可见期间中断 assistant response
- **THEN** footer pending preview SHALL 被清空
- **THEN** 系统 SHALL NOT 将 partial reasoning preview 追加为 `reasoning_summary` record
- **THEN** 系统 SHALL 继续按既有中断路径释放 response lock 并追加本地中断提示

#### Scenario: 旧 turn reasoning 回调不污染当前 turn
- **WHEN** 一个已失效 assistant turn 的 late reasoning 更新回调到达
- **THEN** app SHALL 忽略该 reasoning 更新
- **THEN** 当前 turn 的 pending preview、composer、status line 和 transcript SHALL NOT 被旧回调覆盖
