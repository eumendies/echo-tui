## ADDED Requirements

### Requirement: streaming token footer render 合并
系统 SHALL 在 assistant streaming 期间合并高频 `onToken` 引发的 footer render，以降低终端反复清理和重写 footer 的频率。系统 SHALL 保留每次 token 对完整 streaming draft 状态的更新，并 SHALL 在实际 render 时展示最新 draft。该合并 SHALL NOT 改变最终 assistant transcript、tool records、response lock、resize recovery 或 command surface 的语义。

#### Scenario: 首个 streaming token 及时显示
- **WHEN** assistant 从 thinking 进入 streaming 并收到本轮第一个 token
- **THEN** 系统 SHALL 更新完整 streaming draft 状态
- **THEN** footer SHALL 及时渲染该 streaming pending preview

#### Scenario: 高频 streaming token 合并 footer render
- **WHEN** assistant 在短时间窗口内连续收到多个 streaming token
- **THEN** 系统 SHALL 为每个 token 更新最新完整 streaming draft 状态
- **THEN** 系统 SHALL NOT 为窗口内每个 token 都立即执行一次 footer render
- **THEN** 窗口结束时 footer SHALL 渲染最新完整 streaming draft，而不是较旧的中间 draft

#### Scenario: 结构性事件取消待执行 token render
- **WHEN** 已存在尚未执行的 streaming token footer render
- **AND** assistant 随后进入 tool call、complete、error、interrupt、resize recovery 或 exit 等结构性状态变化
- **THEN** 系统 SHALL 取消尚未执行的 streaming token render
- **THEN** 结构性状态变化 SHALL 按原本即时渲染或 transcript append 路径更新可见 UI
- **THEN** 旧的延迟 token render SHALL NOT 在结构性状态变化之后覆盖新的 footer 状态

#### Scenario: 节流不改变最终 transcript
- **WHEN** assistant streaming 期间 token footer render 被合并
- **AND** assistant response 完成
- **THEN** 系统 SHALL 追加包含完整最终文本的 assistant transcript record
- **THEN** 追加内容 SHALL NOT 受中间 footer render 次数影响
