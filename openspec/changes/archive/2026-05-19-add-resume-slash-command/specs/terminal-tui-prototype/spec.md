## ADDED Requirements

### Requirement: transcript 会话持久化
系统 SHALL 按当前工作目录把 transcript records 持久化到用户级 `~/.echo/echo_tui/` 存储目录中。持久化 SHALL 只覆盖已提交的 transcript records，不覆盖 composer 内容、pending preview、command session 或用于 Up/Down 回溯的 input history。

#### Scenario: 普通 user record 提交后保存 session
- **WHEN** 用户提交一条普通消息且该消息被追加为 user transcript record
- **THEN** 系统 SHALL 在当前工作目录对应的存储分区中创建或更新当前 session
- **THEN** 保存内容 SHALL 包含该 user transcript record

#### Scenario: assistant 完成后保存 session
- **WHEN** fake assistant streaming 完成并追加 assistant transcript record
- **THEN** 系统 SHALL 更新当前 session 的 records 和 `updatedAt`
- **THEN** 保存内容 SHALL 包含完成后的 assistant transcript record

#### Scenario: 按当前工作目录分区保存
- **WHEN** 应用在某个 cwd 中保存 transcript session
- **THEN** 系统 SHALL 将 session 保存到 `~/.echo/echo_tui/` 下对应该 cwd 的项目分区
- **THEN** 系统 SHALL NOT 把会话历史文件写入当前项目目录

#### Scenario: 持久化不保存 input history
- **WHEN** 系统保存 transcript session
- **THEN** 保存内容 SHALL NOT 包含当前进程的 input history

### Requirement: slash resume 恢复命令
系统 SHALL 支持一个本地 slash 恢复命令：当用户提交纯 `/resume` 时，应用 SHALL 读取当前工作目录可恢复的 session metadata，并在 composer/footer 区域显示 `select` command surface。该命令 SHALL 复用统一 slash 命令运行时、command session、effect interpreter 和现有 `select` command surface。

#### Scenario: 纯 /resume 打开恢复列表
- **WHEN** assistant 不处于 thinking 或 streaming，且用户提交内容精确等于 `/resume`
- **THEN** 系统 SHALL 进入 `/resume` command session
- **THEN** 系统 SHALL 在 composer/footer 区域显示 `select` command surface
- **THEN** 系统 SHALL 按 `updatedAt` 倒序展示当前工作目录可恢复的 session
- **THEN** 系统 SHALL NOT 把 `/resume` 写入 transcript、input history 或 fake agent 生命周期

#### Scenario: 没有可恢复 session 时显示空状态
- **WHEN** 用户提交纯 `/resume` 且当前工作目录没有可恢复 session
- **THEN** 系统 SHALL 显示一个可关闭的本地 command surface，说明当前目录没有可恢复会话
- **THEN** 系统 SHALL NOT 启动 fake agent 或追加 transcript record

#### Scenario: 非纯 /resume 输入回退为普通消息
- **WHEN** 用户提交内容以 `/resume` 开头但还带有其他字符
- **THEN** 系统 SHALL 将该内容视为普通 user message 提交，而不是进入恢复列表

#### Scenario: response 进行中阻止 /resume
- **WHEN** assistant 正在 thinking 或 streaming，且用户提交纯 `/resume`
- **THEN** 系统 SHALL NOT 进入 `/resume` command session
- **THEN** 系统 SHALL NOT 恢复或替换 transcript records

### Requirement: resume select 窗口滚动
系统 SHALL 在 `/resume` 的 `select` command surface 中一次最多显示 5 条 session。选择移动 SHALL 由 `/resume` handler 更新当前可见窗口和相对选中项完成，而不是要求 footer renderer 支持通用虚拟列表。

#### Scenario: session 数量超过 5 时只显示窗口内 5 条
- **WHEN** 当前工作目录存在超过 5 个可恢复 session，且用户提交纯 `/resume`
- **THEN** 系统 SHALL 只在 `select` command surface 中显示按 `updatedAt` 倒序排列的前 5 条 session
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

### Requirement: resume 确认恢复 session
系统 SHALL 在 `/resume` command session 中支持 Enter 恢复当前选中的 session。恢复 SHALL 替换当前 transcript records 并完整重绘当前 app snapshot，使屏幕只显示恢复出来的 session transcript。

#### Scenario: Enter 恢复选中 session
- **WHEN** `/resume` command session 处于活跃状态，且用户按下 Enter
- **THEN** 系统 SHALL 关闭 `/resume` command session
- **THEN** 系统 SHALL 清空 composer 并恢复普通输入界面
- **THEN** 系统 SHALL 从持久化存储加载选中 session 的 transcript records
- **THEN** 系统 SHALL 用加载出的 records 替换当前 transcript records
- **THEN** 系统 SHALL 重绘当前 app snapshot，使屏幕显示恢复出来的 session transcript

#### Scenario: 恢复后不追加提示 transcript
- **WHEN** `/resume` 成功恢复某个 session
- **THEN** 系统 SHALL NOT 追加新的 user transcript record 或 assistant transcript record 作为恢复结果提示
- **THEN** 用户可见反馈 SHALL 是恢复出来的 transcript 显示在屏幕上

#### Scenario: Esc 取消 resume
- **WHEN** `/resume` command session 处于活跃状态，且用户按下 Esc
- **THEN** 系统 SHALL 关闭 `/resume` command session
- **THEN** 系统 SHALL 清空 composer 并恢复普通输入界面
- **THEN** 系统 SHALL NOT 替换当前 transcript records
- **THEN** 系统 SHALL NOT 追加 transcript record

### Requirement: clear 与持久化 session 分离
系统 SHALL 在 `/clear` 清空当前可见 transcript 时保留已经持久化的 session 文件。清空后后续普通消息 SHALL 创建或写入新的 session，而不是覆盖被清空前的旧 session。

#### Scenario: /clear 不删除已保存 session
- **WHEN** 当前 transcript 已经保存到某个持久化 session，且用户通过 `/clear` 确认清空 transcript
- **THEN** 系统 SHALL 清空当前可见 transcript records
- **THEN** 系统 SHALL 保留该持久化 session 文件，使它仍可通过 `/resume` 恢复

#### Scenario: /clear 后新消息进入新 session
- **WHEN** 用户通过 `/clear` 确认清空 transcript 后提交新的普通消息
- **THEN** 系统 SHALL 为该新 transcript 创建或使用新的持久化 session
- **THEN** 系统 SHALL NOT 把旧 session 覆盖为空或把新消息追加到被清空前的旧 session
