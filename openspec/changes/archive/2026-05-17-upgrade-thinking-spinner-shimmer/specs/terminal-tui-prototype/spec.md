## MODIFIED Requirements

### Requirement: assistant thinking spinner
系统 SHALL 在 assistant thinking 阶段显示 spinner 动画，并在 thinking 结束后停止该动画。thinking pending preview 的显示模型 SHALL 支持结构化状态，使 render 层可以在最终投影阶段生成 shimmer label，而不是依赖把带 ANSI 的富文本直接拼成普通文本字符串。

#### Scenario: thinking 阶段显示 spinner 与 shimmer label
- **WHEN** 用户提交消息且 assistant 处于 thinking delay
- **THEN** footer pending preview SHALL 显示会周期变化的 spinner frame
- **THEN** footer pending preview SHALL 同时显示一个带 shimmer 扫光效果的 thinking label 和轻量 dots 动效

#### Scenario: spinner 与 shimmer 不改变消息布局
- **WHEN** spinner frame、shimmer 高亮位置或 thinking dots 更新
- **THEN** pending preview SHALL 只更新状态符号或状态片段，不改变消息文本起始列
- **THEN** pending preview 的换行和缩进 SHALL 继续基于未上色文本宽度计算，而不是因为 ANSI 控制序列导致布局漂移

#### Scenario: streaming 开始后停止 thinking 动效
- **WHEN** assistant 开始逐字 streaming 用户原始输入
- **THEN** spinner timer SHALL 停止
- **THEN** pending preview SHALL 从 thinking 的结构化状态切换为 streaming draft 文本布局
- **THEN** streaming draft SHALL NOT 继续沿用 shimmer label 动效

#### Scenario: 窄宽度下安全降级 thinking 动效
- **WHEN** terminal 宽度不足以稳定显示完整的 thinking shimmer 文案
- **THEN** 系统 MAY 对 thinking label 或 dots 做安全降级
- **THEN** 系统 SHALL NOT 输出会破坏 pending preview 换行、缩进或 ANSI 控制序列完整性的效果

#### Scenario: 退出时清理 spinner
- **WHEN** 用户在 thinking 或 streaming 期间退出应用
- **THEN** 应用 SHALL 清理 spinner timer 并恢复终端状态
