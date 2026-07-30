## MODIFIED Requirements

### Requirement: 调节选择支持原子应用和无副作用取消
系统 SHALL 暂存调节模式中的选择，直到用户确认。Enter SHALL 在一次当前 session settings 更新中应用 model 与显式 effort override；Esc 或再次按 `Ctrl+T` SHALL 取消全部暂存选择。

#### Scenario: Enter 原子应用选择
- **WHEN** 用户在调节模式中选定 model 与 effort并按下 Enter
- **THEN** 系统 SHALL 在一次当前 session 内存更新中应用 modelProfileId 和 reasoningEffortOverride，并尽力同步 sidecar
- **THEN** 系统 SHALL NOT 改写用户级 `llm.selectedModel` 或目标 profile 的 `reasoning.effort`
- **THEN** 系统 SHALL 刷新当前 session 模型状态缓存并退出调节模式
- **THEN** 后续 provider turn 和普通 status line SHALL 使用已应用的 session 选择

#### Scenario: 模型或 effort 变化清理旧 context usage
- **WHEN** Enter 成功应用了不同于进入调节模式时的 model 或 effort
- **THEN** 系统 SHALL 清空旧 model/effort 对应的 transient context usage
- **THEN** 新的真实 provider usage 到达前 status line SHALL NOT 显示旧 usage

#### Scenario: Esc 取消暂存选择
- **WHEN** 用户调整一个或多个候选后按下 Esc
- **THEN** 系统 SHALL 退出调节模式并丢弃暂存选择
- **THEN** 当前 session settings、模型状态缓存、composer 草稿和 transcript SHALL 保持不变

#### Scenario: Ctrl+T 再次取消调节
- **WHEN** 调节模式已启动且用户再次按下 `Ctrl+T`
- **THEN** 系统 SHALL 按照 Esc 相同的语义退出并丢弃暂存选择

#### Scenario: sidecar 写入失败
- **WHEN** 用户按 Enter 应用有效选择但 settings sidecar 持久化写入失败
- **THEN** 系统 SHALL 仍更新当前 session 模型状态缓存并退出调节模式
- **THEN** status line SHALL 显示用户确认后的 model/effort，且 SHALL NOT 显示 sidecar 存储错误

### Requirement: 调节模式不改变非交互运行边界
Composer model/effort 调节状态 SHALL 只存在于交互式 TUI。确认后的选择 SHALL 更新当前 session 内存状态并尽力同步 sidecar；活动字段、暂存值和调节错误 SHALL NOT 进入 headless、provider、transcript 或 session journal 协议。

#### Scenario: headless 运行不创建调节状态
- **WHEN** 用户通过 `--once` 执行 headless 请求
- **THEN** 系统 SHALL NOT 初始化或等待 composer model/effort 调节状态
- **THEN** headless 请求 SHALL 继续使用既有模型配置和 per-run override 规则

#### Scenario: 暂存调节状态不进入持久化记录
- **WHEN** transcript session 或 input history 被保存
- **THEN** 活动字段、未确认的暂存 model、暂存 effort 和调节错误 SHALL NOT 写入 transcript record、session journal 或 session settings sidecar
- **THEN** 只有 Enter 确认的当前 model/effort MAY 写入 session settings sidecar
