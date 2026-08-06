## MODIFIED Requirements

### Requirement: reasoning streaming pending preview
系统 SHALL 在 assistant response 期间将尚未完成的可读 reasoning draft 作为独立 `reasoning_streaming` footer pending preview 展示。reasoning complete 到达后，系统 SHALL 立即将权威 summary 追加为 transcript，并仅在当前仍显示 reasoning pending 时清空该 preview；若 assistant 正文已开始 streaming，系统 SHALL 保留正文 pending。未完成的 reasoning preview SHALL NOT 写入 transcript、session journal、provider-facing input 或最终 assistant 正文。

#### Scenario: reasoning 先于正文到达
- **WHEN** assistant response 已启动且 provider 返回可读 reasoning draft，但尚未返回 assistant 正文文本增量
- **THEN** footer pending preview SHALL 显示 reasoning preview
- **THEN** transcript SHALL NOT 因该 reasoning preview 追加 `reasoning_summary` record
- **THEN** composer 和 status line SHALL 继续保持响应中的可见状态

#### Scenario: reasoning 在正文开始前完成
- **WHEN** provider 在 assistant 正文开始前确认非空 reasoning summary 已完成
- **THEN** reasoning pending preview SHALL 被清空
- **THEN** transcript SHALL 立即追加 `reasoning_summary` record
- **THEN** 后续 assistant 正文 token SHALL 进入 `streaming` pending
- **THEN** 最终 `assistant` record SHALL 在该 reasoning summary 之后追加

#### Scenario: reasoning complete 到达时正文已开始 streaming
- **WHEN** assistant 正文已经产生 streaming draft
- **AND** provider 随后触发非空 reasoning complete
- **THEN** transcript SHALL 追加一条权威 `reasoning_summary` record
- **THEN** 已存在的 assistant streaming draft SHALL 保留
- **THEN** 最终 `assistant` record SHALL 在该 reasoning summary 之后追加

#### Scenario: 不支持可读 reasoning 时保持现有 streaming
- **WHEN** provider turn 未返回可读 reasoning draft
- **THEN** footer SHALL 继续按既有 assistant 正文 streaming preview 展示文本增量
- **THEN** 系统 SHALL NOT 显示空 reasoning preview 或占用额外 pending 行

### Requirement: reasoning preview 生命周期清理
reasoning streaming preview SHALL 跟随当前 assistant turn 生命周期清理。reasoning complete、成功完成、tool call handoff、失败、取消或旧 turn 回调失效时，系统 SHALL 清理 transient reasoning preview，避免旧 reasoning draft 污染后续 footer 或 transcript。失败或取消前仅在 footer 中出现过且尚未 complete 的 partial reasoning SHALL NOT 被持久化为 `reasoning_summary` record；已经 complete 并提交的 reasoning SHALL 作为已发生事实保留。对于以整个 response 为 reasoning 完成边界的 provider，response 完成前的 reasoning SHALL 始终按 partial reasoning 处理。

#### Scenario: 失败时清理 partial reasoning preview
- **WHEN** provider 在显示 reasoning preview 后、发出 reasoning complete 前失败
- **THEN** footer pending preview SHALL 被清空
- **THEN** 系统 SHALL NOT 将 partial reasoning preview 追加为 `reasoning_summary` record
- **THEN** 系统 SHALL 继续按既有失败路径追加本地 `error` transcript record

#### Scenario: provider response 完成前正文失败
- **WHEN** provider 以整个 response 作为 reasoning 完成边界
- **AND** reasoning draft 与 assistant 正文 draft 已经到达，但 response 在完成前失败
- **THEN** 系统 SHALL NOT 将 reasoning draft 追加为 `reasoning_summary` record
- **THEN** 系统 SHALL 按既有 partial assistant 与 error 语义收尾

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
