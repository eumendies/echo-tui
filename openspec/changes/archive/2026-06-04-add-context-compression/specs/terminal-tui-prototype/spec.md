## MODIFIED Requirements

### Requirement: transcript 会话持久化
系统 SHALL 按当前工作目录把 transcript records 持久化到用户级 `~/.echo/echo_tui/` 存储目录中。持久化 SHALL 只覆盖已提交的 transcript records，不覆盖 composer 内容、pending preview、command session 或用于 Up/Down 回溯的 input history。session 持久化结构 SHALL 支持可选的压缩状态元数据，包含摘要文本、活跃区间起点索引和创建时间；完整 `records[]` SHALL 保持全量 append-only，不因压缩而删除任何记录。

#### Scenario: 普通 user record 提交后保存 session
- **WHEN** 用户提交一条普通消息且该消息被追加为 user transcript record
- **THEN** 系统 SHALL 在当前工作目录对应的存储分区中创建或更新当前 session
- **THEN** 保存内容 SHALL 包含该 user transcript record

#### Scenario: assistant 完成后保存 session
- **WHEN** assistant response 完成并追加 assistant transcript record
- **THEN** 系统 SHALL 更新当前 session 的 records 和 `updatedAt`
- **THEN** 保存内容 SHALL 包含完成后的 assistant transcript record

#### Scenario: assistant 失败反馈保存 session
- **WHEN** 真实 assistant response 失败并追加本地 `error` transcript record
- **THEN** 系统 SHALL 更新当前 session 的 records 和 `updatedAt`
- **THEN** 保存内容 SHALL 包含该错误反馈 record

#### Scenario: 按当前工作目录分区保存
- **WHEN** 应用在某个 cwd 中保存 transcript session
- **THEN** 系统 SHALL 将 session 保存到 `~/.echo/echo_tui/` 下对应该 cwd 的项目分区
- **THEN** 系统 SHALL NOT 把会话历史文件写入当前项目目录

#### Scenario: 持久化不保存 input history
- **WHEN** 系统保存 transcript session
- **THEN** 保存内容 SHALL NOT 包含当前进程的 input history

#### Scenario: 压缩后持久化压缩状态
- **WHEN** 一次上下文压缩完成
- **THEN** 系统 SHALL 在当前 session 中保存摘要文本和活跃区间起点索引
- **THEN** 系统 SHALL 保留完整 `records[]`，不删除被压缩区间的任何记录

#### Scenario: resume 加载携带压缩状态的 session
- **WHEN** 用户恢复一个已发生压缩的 session
- **THEN** 系统 SHALL 加载完整 `records[]` 和压缩状态元数据
- **THEN** 后续请求 SHALL 能基于恢复出的压缩状态进行投影

## ADDED Requirements

### Requirement: 上下文压缩提示块
系统 SHALL 在一次上下文压缩发生后，于 transcript 中插入一个克制的可见提示块，告知用户较早历史已被压缩为摘要。提示块 SHALL 区别于 user、assistant 和 error 消息样式。resume 渲染 SHALL 只渲染完整 `records[]`，SHALL NOT 把压缩摘要文本作为 transcript 内容显示。

#### Scenario: 压缩后显示提示块
- **WHEN** 一次上下文压缩完成
- **THEN** 系统 SHALL 在 transcript 中显示一个提示块，说明较早历史已被压缩为摘要
- **THEN** 该提示块 SHALL 使用区别于 user、assistant 和 error 的克制样式

#### Scenario: resume 不显示压缩摘要内容
- **WHEN** 用户恢复一个已发生压缩的 session
- **THEN** 系统 SHALL 按现有方式渲染完整 `records[]`
- **THEN** 系统 SHALL NOT 把压缩摘要文本作为 transcript 消息显示出来
