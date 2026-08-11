# transcript-journal-persistence Specification

## Purpose
TBD - created by archiving change migrate-transcript-persistence-to-jsonl. Update Purpose after archive.
## Requirements
### Requirement: 单文件 JSONL transcript journal
系统 SHALL 为每个 transcript session 在当前 cwd 的项目分区中使用唯一的 `{session-id}.jsonl` 文件保存 session 内容。journal 首行 SHALL 是 `session_start` 操作，并包含 schemaVersion `1`、sessionId、cwd 和 createdAt；后续每个操作 SHALL 独占一行合法 JSON，并包含递增的 `seq` 和 updatedAt。

#### Scenario: 首次提交创建 journal
- **WHEN** 当前 cwd 中尚未存在持久化 session 且 app 提交首个 transcript record
- **THEN** 系统 SHALL 原子创建对应的 `.jsonl` 文件
- **THEN** 文件 SHALL 包含 `session_start` 首行和保存首个 record 的后续操作
- **THEN** 系统 SHALL NOT 创建完整 session `.json` 快照文件

#### Scenario: 旧 JSON session 不参与恢复
- **WHEN** 项目分区中存在旧的 `{session-id}.json` 文件
- **AND** 不存在同 sessionId 的有效 `.jsonl` journal
- **THEN** `/resume` SHALL NOT 将该旧 JSON 文件列为可恢复 session
- **THEN** 系统 SHALL NOT 尝试迁移、读取或改写该旧 JSON 文件

### Requirement: records 与会话状态的增量操作
系统 SHALL 使用 `append_records`、`truncate_records`、`set_change_history`、`set_compaction` 和 `set_todo_state` 操作分别记录 transcript records 及三类会话状态。某项状态未发生变化时，系统 SHALL NOT 因其他 record 或状态提交而重复写入该项状态。

#### Scenario: 普通 record 追加不复制无关状态
- **WHEN** app 追加普通 transcript record
- **AND** changeHistory、compaction 和 todoState 自上次持久化后均未变化
- **THEN** journal SHALL 追加只包含 `append_records` 的操作
- **THEN** 系统 SHALL NOT 重写此前 journal 内容或写入完整 session 对象

#### Scenario: todo 更新不复制其他状态
- **WHEN** 当前 session 的 todoState 发生变化
- **AND** changeHistory 和 compaction 未发生变化
- **THEN** journal SHALL 追加 `set_todo_state` 操作
- **THEN** 该操作 SHALL NOT 包含 changeHistory 或 compaction 的副本

#### Scenario: compaction 更新不复制其他状态
- **WHEN** 当前 session 的 compaction 发生变化
- **AND** todoState 和 changeHistory 未发生变化
- **THEN** journal SHALL 追加 `set_compaction` 操作
- **THEN** 该操作 SHALL NOT 包含 todoState 或 changeHistory 的副本

### Requirement: 复合会话变化的单行原子操作
系统 SHALL 使用 `batch` 操作在单个 journal 行内按顺序应用多个子操作。需要同时改变 transcript 与状态的逻辑事实 SHALL 使用同一 batch，恢复时不得观察到仅完成其中一部分的状态。

#### Scenario: compaction 与 notice 同步恢复
- **WHEN** app 应用新的 compaction 并追加对应 compaction notice record
- **THEN** 系统 SHALL 在同一个 `batch` 操作中记录 `set_compaction` 和 `append_records`
- **THEN** replay 后的 compaction 状态与 notice record SHALL 同时存在

#### Scenario: undo 同步截断 records 与状态
- **WHEN** `/undo` 成功回退一个 ready change checkpoint
- **THEN** 系统 SHALL 在同一个 `batch` 操作中记录 `truncate_records`、回退后的 compaction 和回退后的 change history
- **THEN** replay 后的 records、compaction 与 change history SHALL 等价于该 checkpoint 开始前的状态

### Requirement: journal replay 与恢复容错
系统 SHALL 按 journal 文件顺序 replay 有效操作以恢复当前 records、todoState、compaction、changeHistory 和 updatedAt。`truncate_records` SHALL 作用于 replay 时当前 records 数组；每个 `set_*` SHALL 覆盖对应的当前状态。

#### Scenario: 截断后追加 records
- **WHEN** journal 依次包含 records A、B、C 的追加操作、`truncate_records(1)` 和 records D 的追加操作
- **THEN** 加载 session 后的 records SHALL 为 A 和 D
- **THEN** 被截断的 B 和 C SHALL NOT 出现在当前 provider 或 TUI transcript 中

#### Scenario: 最后一行写入中断
- **WHEN** journal 的最后一个非空行不是合法 JSON 或不符合操作结构
- **THEN** 系统 SHALL 忽略该最后一行并从此前有效操作恢复 session
- **THEN** 系统 SHALL 在恢复该 session 时原子移除无效尾部，使后续操作从最后有效 seq 继续追加
- **THEN** 系统 SHALL NOT 因该尾行失败而丢弃此前有效 records 或状态

#### Scenario: 有效最后一行缺少换行
- **WHEN** journal 的最后一个操作完整有效但缺少行尾换行
- **THEN** 系统 SHALL 在恢复该 session 时补全可安全续写的 journal 结尾
- **THEN** 后续追加 SHALL NOT 与既有操作拼接为同一物理行

#### Scenario: 中间 journal 损坏
- **WHEN** `session_start` 无效、某个非最后操作无效、出现未知操作或 seq 不连续
- **THEN** 系统 SHALL 将该 session 视为不可恢复
- **THEN** `/resume` SHALL NOT 列出该 session

### Requirement: 从 journal 派生 resume metadata
系统 SHALL 在当前 cwd 的项目分区中维护 schemaVersion 1、可验证、可重建的轻量 session index，记录每个有效 journal 的 sessionId、createdAt、updatedAt、cwd、当前 record 数量、稳定标题及 journal 文件指纹，用于 `/resume` 与 `/reference` 左侧列表。index 条目 SHALL 从 journal 操作成功后 app 持有的最终 session 状态派生，标题 SHALL 从 replay 最终 records 的第一条用户消息派生，被 `truncate_records` 移除的 records SHALL 不计入消息数量或标题派生。最近预览 records SHALL NOT 保存到该项目 index，而 SHALL 仅在用户选中一个 session 时从其 journal 的只读最终 replay 状态派生。

#### Scenario: journal 更新后同步列表索引
- **WHEN** app 成功创建 session journal 或向现有 journal 追加有效操作
- **THEN** 系统 SHALL 在 journal 写入成功后更新该 session 的 index 条目
- **THEN** index SHALL 通过临时文件和原子替换提交
- **THEN** index 写入失败 SHALL NOT 回滚或损坏已成功写入的 journal

#### Scenario: 截断后索引和按需预览保持最终状态
- **WHEN** session journal 成功追加一次 `truncate_records` 操作
- **THEN** index 中的消息数量 SHALL 基于截断后的当前 records
- **THEN** 用户随后选中该 session 时，按需预览 SHALL NOT 包含被截断 records 的文本

#### Scenario: 有效 index 避免全量 replay
- **WHEN** `/resume` 或 `/reference` 列表查询发现 index 条目存在且 journal size、mtime 与条目指纹匹配
- **THEN** 系统 SHALL 直接使用该条目构造列表摘要
- **THEN** 系统 SHALL NOT 为该列表摘要读取或 replay journal 正文

#### Scenario: index 缺失或损坏
- **WHEN** 当前项目存在 session journal 但 index 文件缺失、无法解析或 schema 无效
- **THEN** 系统 SHALL 从每个可有效 replay 的 `.jsonl` journal 重建 index
- **THEN** 无效 journal SHALL NOT 出现在重建后的 index、`/resume` 或 `/reference` 列表
- **THEN** 系统 SHALL NOT 读取、迁移或改写旧 `.json` session 文件

#### Scenario: 单个 index 条目过期
- **WHEN** journal 存在但其 index 条目缺失或文件指纹不匹配
- **THEN** 系统 SHALL 只 replay 该 journal 以刷新对应条目
- **THEN** 其他指纹有效的 journal SHALL NOT 因此被读取或 replay

#### Scenario: index 孤立条目
- **WHEN** index 包含一个当前 sessions 目录中已不存在对应 `.jsonl` journal 的条目
- **THEN** 系统 SHALL 从可用列表和下一份持久化 index 中移除该条目
- **THEN** 系统 SHALL NOT 因孤立 index 条目创建或恢复 journal

