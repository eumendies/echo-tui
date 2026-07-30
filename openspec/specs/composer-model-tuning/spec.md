## Purpose
定义通过 `Ctrl+T` 在 composer 内暂存、浏览、确认或取消全局 model/effort 选择的交互、渲染和持久化行为。
## Requirements
### Requirement: Ctrl+T 启动 composer 模型调节模式
系统 SHALL 在可用的普通或 plan composer 中将 `Ctrl+T` 识别为 model/effort 调节模式快捷键，并 SHALL 在进入时保留 composer 草稿、逻辑光标和 input history。

#### Scenario: 从空闲 composer 进入调节模式
- **WHEN** 普通或 plan composer 可用且没有 active response、MCP 初始化或高优先级交互 surface
- **AND** 用户按下 `Ctrl+T`
- **THEN** 系统 SHALL 进入 model/effort 调节模式
- **THEN** composer 草稿、逻辑光标和 input history SHALL 保持不变
- **THEN** 系统 SHALL NOT 追加 transcript record

#### Scenario: 不在受限运行状态启动调节
- **WHEN** assistant response、shell command、MCP 初始化、shell/shell-local interaction mode、tool approval、user question、file picker 或 command session 处于活跃状态
- **AND** 用户输入 `Ctrl+T`
- **THEN** 系统 SHALL NOT 创建 model/effort 调节状态
- **THEN** 该输入 SHALL 继续遵循当前活跃流程的事件边界

#### Scenario: slash suggestion 上进入调节模式
- **WHEN** 普通或 plan composer 草稿正在派生 slash suggestion
- **AND** 用户按下 `Ctrl+T`
- **THEN** 系统 SHALL 进入调节模式并暂时隐藏 slash suggestion
- **THEN** 退出调节模式后系统 SHALL 根据未改变的草稿重新派生 slash suggestion

### Requirement: 调节模式提供 model 与 effort 键盘浏览
系统 SHALL 在调节模式中提供 `model` 和 `effort` 两个活动字段。`Tab` 与 `Shift+Tab` SHALL 切换活动字段，左右方向键 SHALL 首尾循环当前字段的可用候选，并且这些按键 SHALL NOT 修改 composer 文本或触发原有全局快捷行为。

#### Scenario: 切换活动字段
- **WHEN** 调节模式已启动
- **AND** 用户按下 `Tab` 或 `Shift+Tab`
- **THEN** 活动字段 SHALL 在 model 与 effort 之间切换
- **THEN** 系统 SHALL NOT 切换 interaction mode 或 session 工具授权状态

#### Scenario: 循环 model 候选
- **WHEN** 调节模式的活动字段为 model
- **AND** 用户按下左或右方向键
- **THEN** 系统 SHALL 按对应方向首尾循环配置中的 model profile 候选
- **THEN** composer 草稿和逻辑光标 SHALL 保持不变

#### Scenario: 循环 effort 候选
- **WHEN** 调节模式的活动字段为 effort
- **AND** 用户按下左或右方向键
- **THEN** 系统 SHALL 按对应方向首尾循环既有 reasoning effort 候选
- **THEN** composer 草稿和逻辑光标 SHALL 保持不变

#### Scenario: model 候选决定暂存 effort
- **WHEN** 用户在调节模式中切换到另一个 model profile
- **THEN** 暂存 effort SHALL 使用目标 profile 当前显式配置的 effort
- **THEN** 目标 profile 未配置 effort 时 SHALL 使用 `medium` 作为暂存起点
- **THEN** 前一个 model 的暂存 effort SHALL NOT 自动迁移到目标 profile

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

### Requirement: 调节模式内联投影到 composer footer
系统 SHALL 使用现有 composer box 与 status line 投影调节模式，SHALL NOT 打开独立 command surface，也 SHALL NOT 在 composer box 下方新增操作 hint 行。

#### Scenario: 默认 placeholder 提示调节快捷键
- **WHEN** 普通或 plan composer 为空且调节模式未启动
- **THEN** composer placeholder SHALL 显示 `Ctrl+T` 模型调节快捷提示
- **THEN** 常见 80 列终端 SHALL 能完整显示普通 placeholder

#### Scenario: 空 composer 替换 placeholder
- **WHEN** 调节模式已启动且 composer 没有用户文本
- **THEN** composer box 内 SHALL 使用 `Tab 切换字段 · ←/→ 调整 · Enter 应用 · Esc 取消` 替换当前 interaction mode 的原始 placeholder
- **THEN** composer box 下方 SHALL NOT 因该提示增加新行

#### Scenario: 有文本时不显示调节提示
- **WHEN** 调节模式已启动且 composer 包含用户文本
- **THEN** composer box SHALL 继续显示原始用户文本
- **THEN** 系统 SHALL NOT 在文本前后、composer box 下方或 status line 中重复显示完整操作 hint

#### Scenario: status line 标识活动字段
- **WHEN** 调节模式已启动
- **THEN** status line SHALL 显示暂存的 model 与 effort
- **THEN** 当前活动字段 SHALL 使用 `‹...›`、强调色或等价聚焦样式与非活动字段区分
- **THEN** effort segment SHALL NOT 显示圆点前缀
- **THEN** effort SHALL 始终显示一个明确的 reasoning effort 候选

#### Scenario: 调节期间隐藏 composer 光标
- **WHEN** 调节模式已启动
- **THEN** footer SHALL 隐藏 composer 文本光标
- **WHEN** 调节模式退出
- **THEN** footer SHALL 在保存的 composer 逻辑位置恢复光标

#### Scenario: 退出后恢复原 placeholder
- **WHEN** 用户确认或取消调节模式且 composer 仍为空
- **THEN** composer SHALL 恢复当前 normal 或 plan interaction mode 的原始 placeholder

#### Scenario: 窄终端安全渲染
- **WHEN** 调节 placeholder 或 status line 候选超过当前 safe render width
- **THEN** footer SHALL 沿用既有裁剪或 placeholder 降级策略
- **THEN** 任何调节模式行 SHALL NOT 写满终端最后一列或产生额外自动换行

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
