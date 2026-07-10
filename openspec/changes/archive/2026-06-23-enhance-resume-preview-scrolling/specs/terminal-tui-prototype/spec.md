## MODIFIED Requirements

### Requirement: resume 消息预览
系统 SHALL 在 `/resume` 历史恢复面板中为当前选中的 session 展示可滚动的 transcript record 预览。预览 SHALL 来自持久化 session 的 `records[]` 派生数据，每条消息 SHALL 以单行摘要展示 role 和截断后的文本；系统 SHALL NOT 为了预览修改 session 文件格式或追加 transcript record。preview SHALL 使用 bounded 派生数据展示多于 5 条记录和更长文本，并在 footer 高度预算内窗口化显示。

#### Scenario: 选中 session 显示最近消息预览
- **WHEN** 当前工作目录存在可恢复 session，且用户提交纯 `/resume`
- **THEN** 系统 SHALL 在右侧 preview 区域展示当前选中 session 的最近 transcript record 预览
- **THEN** preview SHALL 优先展示靠近 session 末尾的记录
- **THEN** preview SHALL 能包含多于 5 条记录的 bounded 预览数据

#### Scenario: 移动选择时更新消息预览
- **WHEN** `/resume` command session 处于 list focus
- **AND** 用户按下 Up 或 Down 使选中 session 改变
- **THEN** 系统 SHALL 更新左侧选中项
- **THEN** 系统 SHALL 更新右侧 preview 区域，使其展示新选中 session 的最近消息预览
- **THEN** 系统 SHALL 将 preview scroll 重置到顶部

#### Scenario: 无可预览消息时显示空预览
- **WHEN** 选中 session 不包含可展示的 transcript text
- **THEN** 系统 SHALL 在 preview 区域显示空预览提示
- **THEN** 系统 SHALL 保持 Enter 恢复和 Esc 取消行为可用

#### Scenario: 进入 preview focus
- **WHEN** `/resume` command session 处于 list focus
- **AND** 用户按下 Right 或 Tab
- **THEN** 系统 SHALL 将焦点切换到右侧 preview 区域
- **THEN** 系统 SHALL NOT 改变当前选中的 session

#### Scenario: preview focus 下滚动预览
- **WHEN** `/resume` command session 处于 preview focus
- **AND** 用户按下 Up 或 Down
- **THEN** 系统 SHALL 上下滚动右侧 preview 内容窗口
- **THEN** 系统 SHALL NOT 改变左侧选中的 session
- **THEN** 系统 SHALL NOT 恢复或替换 transcript records

#### Scenario: 返回 list focus
- **WHEN** `/resume` command session 处于 preview focus
- **AND** 用户按下 Left
- **THEN** 系统 SHALL 将焦点切换回左侧 session 列表
- **THEN** 系统 SHALL 保留当前选中的 session

#### Scenario: preview 滚动不改变恢复语义
- **WHEN** `/resume` command session 处于 preview focus
- **AND** 用户按下 Enter
- **THEN** 系统 SHALL 恢复当前选中的 session
- **WHEN** `/resume` command session 处于 preview focus
- **AND** 用户按下 Esc
- **THEN** 系统 SHALL 取消 `/resume` 并回到普通 composer 输入界面

#### Scenario: 长 preview 遵守 footer 约束
- **WHEN** 当前选中 session 的 preview 内容超过右侧 preview 可见高度
- **THEN** footer SHALL 只渲染当前 preview scroll 对应的可见窗口
- **THEN** footer SHALL NOT 因完整 preview 内容变长而无限增长
- **THEN** footer SHALL 遵守当前终端 safe render width，避免额外自动换行

### Requirement: resume select 窗口滚动
系统 SHALL 在 `/resume` 的专用历史恢复 command surface 中一次最多显示 5 条 session。选择移动 SHALL 由 `/resume` handler 更新当前可见窗口和相对选中项完成，而不是要求 footer renderer 支持通用虚拟列表。preview focus 下的 Up/Down SHALL 只滚动右侧预览，不改变 session 选择窗口。

#### Scenario: session 数量超过 5 时只显示窗口内 5 条
- **WHEN** 当前工作目录存在超过 5 个可恢复 session，且用户提交纯 `/resume`
- **THEN** 系统 SHALL 只在专用历史恢复 command surface 的左侧列表中显示按 `updatedAt` 倒序排列的前 5 条 session
- **THEN** 第一条 session SHALL 处于选中状态

#### Scenario: Down 移动到窗口底部后向下滚动
- **WHEN** `/resume` command session 中存在超过 5 个 session，且当前选中项已经位于可见窗口最后一条
- **WHEN** 用户按下 Down，且全量列表中还存在下一条 session
- **THEN** 系统 SHALL 将选中项移动到下一条 session
- **THEN** 系统 SHALL 更新可见窗口，使较早的顶部 session 从窗口中移出，并显示新的下一条 session

#### Scenario: Up 移动到窗口顶部后向上滚动
- **WHEN** `/resume` command session 中当前选中项已经位于可见窗口第一条，且全量列表中还存在上一条 session
- **WHEN** 用户按下 Up
- **THEN** 系统 SHALL 将选中项移动到上一条 session
- **THEN** 系统 SHALL 更新可见窗口，使较晚的上一条 session 显示出来

#### Scenario: resume 选择不循环
- **WHEN** `/resume` command session 中当前选中项是全量列表第一条且用户按下 Up
- **THEN** 系统 SHALL 保持第一条 session 处于选中状态
- **WHEN** 当前选中项是全量列表最后一条且用户按下 Down
- **THEN** 系统 SHALL 保持最后一条 session 处于选中状态

#### Scenario: preview focus 不移动 session 窗口
- **WHEN** `/resume` command session 处于 preview focus
- **AND** 用户按下 Up 或 Down
- **THEN** 系统 SHALL 保持当前 session selectedIndex 和 windowStart 不变
- **THEN** 系统 SHALL 只更新右侧 preview scroll
