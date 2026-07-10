## ADDED Requirements

### Requirement: resume 消息预览
系统 SHALL 在 `/resume` 历史恢复面板中为当前选中的 session 展示最近最多 5 条 transcript record 的截断预览。预览 SHALL 来自持久化 session 的 `records[]` 派生数据，展示 role 和文本摘要；系统 SHALL NOT 为了预览修改 session 文件格式或追加 transcript record。

#### Scenario: 选中 session 显示最近消息预览
- **WHEN** 当前工作目录存在可恢复 session，且用户提交纯 `/resume`
- **THEN** 系统 SHALL 在右侧 preview 区域展示当前选中 session 最近最多 5 条 transcript record 的 role 和截断文本
- **THEN** preview SHALL 优先展示靠近 session 末尾的记录

#### Scenario: 移动选择时更新消息预览
- **WHEN** `/resume` command session 处于活跃状态，且用户按下 Up 或 Down 使选中 session 改变
- **THEN** 系统 SHALL 更新左侧选中项
- **THEN** 系统 SHALL 更新右侧 preview 区域，使其展示新选中 session 的最近消息预览

#### Scenario: 无可预览消息时显示空预览
- **WHEN** 选中 session 不包含可展示的 transcript text
- **THEN** 系统 SHALL 在 preview 区域显示空预览提示
- **THEN** 系统 SHALL 保持 Enter 恢复和 Esc 取消行为可用

#### Scenario: preview 不支持独立滚动
- **WHEN** `/resume` command session 处于活跃状态
- **THEN** 系统 SHALL NOT 为 preview 区域提供独立滚动状态
- **THEN** Up 和 Down SHALL 只移动 session 选择，不滚动 preview 内容

## MODIFIED Requirements

### Requirement: slash resume 恢复命令
系统 SHALL 支持一个本地 slash 恢复命令：当用户提交纯 `/resume` 时，应用 SHALL 读取当前工作目录可恢复的 session metadata 和 bounded message preview，并在 composer/footer 区域显示专用历史恢复 command surface。该命令 SHALL 复用统一 slash 命令运行时、command session 和 effect interpreter。

#### Scenario: 纯 /resume 打开恢复列表
- **WHEN** assistant 不处于 thinking 或 streaming，且用户提交内容精确等于 `/resume`
- **THEN** 系统 SHALL 进入 `/resume` command session
- **THEN** 系统 SHALL 在 composer/footer 区域显示专用历史恢复 command surface
- **THEN** 系统 SHALL 按 `updatedAt` 倒序展示当前工作目录可恢复的 session
- **THEN** 系统 SHALL NOT 把 `/resume` 写入 transcript、input history 或 agent 生命周期

#### Scenario: 没有可恢复 session 时显示空状态
- **WHEN** 用户提交纯 `/resume` 且当前工作目录没有可恢复 session
- **THEN** 系统 SHALL 显示一个可关闭的本地 command surface，说明当前目录没有可恢复会话
- **THEN** 系统 SHALL NOT 启动 agent 或追加 transcript record

#### Scenario: 非纯 /resume 输入回退为普通消息
- **WHEN** 用户提交内容以 `/resume` 开头但还带有其他字符
- **THEN** 系统 SHALL 将该内容视为普通 user message 提交，而不是进入恢复列表

#### Scenario: response 进行中阻止 /resume
- **WHEN** assistant 正在 thinking 或 streaming，且用户提交纯 `/resume`
- **THEN** 系统 SHALL NOT 进入 `/resume` command session
- **THEN** 系统 SHALL NOT 恢复或替换 transcript records

### Requirement: resume select 窗口滚动
系统 SHALL 在 `/resume` 的专用历史恢复 command surface 中一次最多显示 5 条 session。选择移动 SHALL 由 `/resume` handler 更新当前可见窗口和相对选中项完成，而不是要求 footer renderer 支持通用虚拟列表。

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
