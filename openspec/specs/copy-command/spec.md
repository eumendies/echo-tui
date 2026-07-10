# copy-command Specification

## Purpose
TBD - created by archiving change add-copy-command. Update Purpose after archive.
## Requirements
### Requirement: /copy 打开消息复制面板
系统 SHALL 提供 `/copy` slash command，用于打开当前 transcript 的消息复制面板。复制面板 SHALL 只展示 user 和 assistant 消息，且 SHALL 使用消息原始文本作为复制源，而不是使用终端渲染后的可见文本。

#### Scenario: 打开复制面板
- **WHEN** 用户提交 `/copy`
- **THEN** 系统 SHALL 打开 copy command surface
- **THEN** surface SHALL 展示当前 transcript 中的 user 和 assistant 消息
- **THEN** surface SHALL NOT 展示 tool、reasoning、system、shell、error、local notice 或其他非 user/assistant 记录

#### Scenario: 没有可复制消息
- **WHEN** 用户提交 `/copy` 且当前 transcript 中没有 user 或 assistant 消息
- **THEN** 系统 SHALL 展示无可复制消息的提示
- **THEN** 系统 SHALL NOT 尝试写入剪贴板

### Requirement: copy surface 支持两栏预览和多选
copy command surface SHALL 使用两栏 footer UI：左侧展示可复制消息的单行列表预览，右侧展示当前聚焦消息的全文预览。用户 SHALL 能够移动当前项、使用 Space 切换选择状态，并使用 Enter 确认复制。

#### Scenario: 默认选中最近 assistant 消息
- **WHEN** copy surface 打开且存在至少一条 assistant 消息
- **THEN** 系统 SHALL 默认聚焦并选中最近一条 assistant 消息

#### Scenario: 默认选中最近可复制消息
- **WHEN** copy surface 打开且不存在 assistant 消息但存在 user 消息
- **THEN** 系统 SHALL 默认聚焦并选中最近一条 user 消息

#### Scenario: 用户切换消息选择
- **WHEN** copy surface 处于活跃状态且用户按下 Space
- **THEN** 系统 SHALL 切换当前聚焦消息的选中状态
- **THEN** surface SHALL 使用 `●/○` 表达消息已选中或未选中状态

#### Scenario: 用户移动当前项
- **WHEN** copy surface 处于活跃状态且用户按下 ↑ 或 ↓
- **THEN** 系统 SHALL 在可复制消息列表中移动当前聚焦项
- **THEN** 右侧全文预览 SHALL 更新为当前聚焦消息的原始文本

#### Scenario: 用户取消复制
- **WHEN** copy surface 处于活跃状态且用户按下 Esc
- **THEN** 系统 SHALL 关闭 copy command session
- **THEN** 系统 SHALL NOT 写入剪贴板

### Requirement: copy command 复制选中消息原文
用户确认 copy command 时，系统 SHALL 将所有选中消息的原始文本写入系统剪贴板。复制内容 SHALL NOT 包含消息渲染前缀、ANSI 样式、自动换行产生的视觉缩进或 footer surface 装饰。

#### Scenario: 复制单条消息
- **WHEN** copy surface 处于活跃状态且用户只选中一条消息后按下 Enter
- **THEN** 系统 SHALL 将该消息原始文本写入剪贴板
- **THEN** 写入内容 SHALL NOT 额外添加角色标题

#### Scenario: 复制多条消息
- **WHEN** copy surface 处于活跃状态且用户选中多条消息后按下 Enter
- **THEN** 系统 SHALL 按 transcript 原始顺序拼接选中消息
- **THEN** 每条消息 SHALL 使用对应角色标题标识 `User:` 或 `Assistant:`
- **THEN** 消息之间 SHALL 使用空行分隔

#### Scenario: 没有选中消息时确认
- **WHEN** copy surface 处于活跃状态且没有消息被选中时用户按下 Enter
- **THEN** 系统 SHALL 保持 copy surface 打开
- **THEN** 系统 SHALL 展示需要先选择消息的提示
- **THEN** 系统 SHALL NOT 写入剪贴板

### Requirement: copy command 反馈复制结果
系统 SHALL 在 copy command 完成或失败时给出用户可见反馈。复制成功 SHALL 关闭 copy surface；复制失败 SHALL 展示失败原因且不丢失用户选择。

#### Scenario: 复制成功
- **WHEN** 用户确认复制且剪贴板写入成功
- **THEN** 系统 SHALL 关闭 copy command surface
- **THEN** 系统 SHALL 展示已复制消息数量的本地反馈
- **THEN** 系统 SHALL NOT 触发 assistant 响应

#### Scenario: 剪贴板不可用
- **WHEN** 用户确认复制但系统剪贴板写入不可用或失败
- **THEN** 系统 SHALL 保持 copy surface 打开
- **THEN** 系统 SHALL 展示剪贴板写入失败的可读原因
- **THEN** 系统 SHALL 保留当前选中状态

