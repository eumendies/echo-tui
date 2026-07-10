## ADDED Requirements

### Requirement: choice option 顺序保持调用方语义
choice surface SHALL 按调用方提供的 option 顺序渲染选项。renderer SHALL NOT 基于 label、description、inline input 或选项类型重新排序 option，以便 tool approval 等调用方表达安全相关的选项分组。

#### Scenario: 保留 tool approval allow 分组顺序
- **WHEN** tool approval 以 choice surface 提供 `Allow once`、会话级 allow、`Allow all tools for this session`、`Deny` 和 `Tell model what to do` 选项
- **THEN** TUI SHALL 按调用方提供的顺序渲染这些选项
- **THEN** 所有 allow 选项 SHALL 在视觉上连续显示

#### Scenario: inline input 不改变选项顺序
- **WHEN** choice surface 的最后一个 option 包含 inline input
- **THEN** renderer SHALL 保持该 option 的原始位置
- **THEN** renderer SHALL NOT 为了显示输入框而把该 option 移到其他选项之前
