## MODIFIED Requirements

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
