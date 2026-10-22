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
系统 SHALL 使用 `append_records`、`truncate_records`、`set_change_history`、`push_change_checkpoint`、`pop_change_checkpoint`、`set_compaction` 和 `set_todo_state` 操作分别记录 transcript records 及三类会话状态。某项状态未发生变化时，系统 SHALL NOT 因其他 record 或状态提交而重复写入该项状态。

change history SHALL 以增量操作持久化：一轮 assistant loop 结束时 SHALL 只写入本轮新增的 checkpoint（`push_change_checkpoint`），`/undo` 成功回退 SHALL 只写入一次栈顶弹出（`pop_change_checkpoint`）。单次 change history 写入的字节量 SHALL 由本次新增或移除的 checkpoint 决定，SHALL NOT 随栈中已有 checkpoint 的数量增长。系统 SHALL NOT 为未产生新 checkpoint 的轮次追加 change history 操作。

`set_change_history` SHALL 保留"整份替换"语义，并 SHALL 仅用于需要自包含完整栈的场合：失效边界重置与 `/fork` 的会话初始快照。

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

#### Scenario: 单轮 change history 写入量不随栈深增长
- **WHEN** 当前 session 的 change history 栈中存在 N 个 checkpoint
- **AND** 一轮 assistant loop 结束并产生一个新的 ready checkpoint
- **THEN** journal SHALL 追加一个只包含该新 checkpoint 的 `push_change_checkpoint` 操作
- **THEN** 该操作的体积 SHALL NOT 随 N 增长
- **THEN** 系统 SHALL NOT 重新写入此前已持久化的 checkpoint

#### Scenario: 未产生 checkpoint 的轮次不写 change history
- **WHEN** 一轮 assistant loop 结束但本轮没有产生新的 change checkpoint
- **THEN** journal SHALL NOT 追加 `push_change_checkpoint`、`pop_change_checkpoint` 或 `set_change_history` 操作

#### Scenario: undo 只写入一次栈顶弹出
- **WHEN** `/undo` 成功回退一个 ready change checkpoint
- **THEN** journal SHALL 追加 `pop_change_checkpoint` 操作
- **THEN** 该操作 SHALL NOT 包含完整 change history 数组

#### Scenario: 失效边界与分叉快照写入完整栈
- **WHEN** 一轮 assistant loop 的 change checkpoint 被标记为 invalid 并成为 change history 边界
- **THEN** journal SHALL 追加 `set_change_history` 操作，其内容 SHALL 是该 invalid checkpoint 构成的完整栈
- **WHEN** `/fork` 创建新的 session journal
- **THEN** 新 journal SHALL 使用 `set_change_history` 写入分叉时的完整 change history

### Requirement: 复合会话变化的单行原子操作
系统 SHALL 使用 `batch` 操作在单个 journal 行内按顺序应用多个子操作。需要同时改变 transcript 与状态的逻辑事实 SHALL 使用同一 batch，恢复时不得观察到仅完成其中一部分的状态。

#### Scenario: compaction 与 notice 同步恢复
- **WHEN** app 应用新的 compaction 并追加对应 compaction notice record
- **THEN** 系统 SHALL 在同一个 `batch` 操作中记录 `set_compaction` 和 `append_records`
- **THEN** replay 后的 compaction 状态与 notice record SHALL 同时存在

#### Scenario: undo 同步截断 records 与状态
- **WHEN** `/undo` 成功回退一个 ready change checkpoint
- **THEN** 系统 SHALL 在同一个 `batch` 操作中记录 `truncate_records`、回退后的 compaction 和 `pop_change_checkpoint`
- **THEN** replay 后的 records、compaction 与 change history SHALL 等价于该 checkpoint 开始前的状态
- **THEN** 该 batch SHALL NOT 包含完整的 change history 数组

### Requirement: journal replay 与恢复容错
系统 SHALL 按 journal 文件顺序 replay 有效操作以恢复当前 records、todoState、compaction、changeHistory 和 updatedAt。`truncate_records` SHALL 作用于 replay 时当前 records 数组；每个 `set_*` SHALL 覆盖对应的当前状态。`push_change_checkpoint` SHALL 把其 checkpoint 追加到 replay 时当前 change history 栈顶；`pop_change_checkpoint` SHALL 弹出 replay 时当前栈顶，且当栈为空时 SHALL 判定该 session 不可恢复。系统 SHALL 按行读取与重放 journal，SHALL NOT 额外保留完整文件副本（整文件字符串、行数组或等量的修复文本副本）：读取过程的常驻内存 SHALL 由读取缓冲、最大单行解析开销与重放期间的有效状态构成，该有效状态 MAY 大于最终结果（例如先追加大量 records 再 `truncate_records`）。修复文本 SHALL 仅在本次恢复确实需要修复尾部时由恢复方构造，且 SHALL 复用既有的规范化规则（去除行首尾空白、丢弃空行、以 `\n` 连接），其计数单位 SHALL 是非空逻辑行；正常恢复路径 SHALL NOT 构造该文本。replay SHALL NOT 重复深拷贝本次读取已经独占持有的解析产物。重放 SHALL NOT 因单次操作的记录数量或单行长度而失败或终止进程；在结果已经确定（判定不可恢复，或修复所需前缀已收齐）时，系统 SHALL 停止读取剩余内容。

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
- **WHEN** `session_start` 无效、某个非最后操作无效、未知操作出现在非最后一行，或出现 seq 不连续与越界截断
- **THEN** 系统 SHALL 将该 session 视为不可恢复
- **THEN** `/resume` SHALL NOT 列出该 session
- **THEN** 系统 SHALL NOT 继续读取该行之后的内容

#### Scenario: 最后一行容错的边界
- **WHEN** journal 的最后一行是无效 JSON、结构无效或未知操作
- **THEN** 系统 SHALL 按可修复尾行忽略该行并从此前有效操作恢复
- **THEN** 该行之后只存在空行时 SHALL 保持同一判定
- **WHEN** 最后一行结构有效但语义失败（seq 不连续、`truncate_records` 越界、`pop_change_checkpoint` 遇到空栈）
- **THEN** 系统 SHALL 将该 session 视为不可恢复，SHALL NOT 按可修复尾行处理

#### Scenario: 大 journal 的读取内存特征
- **WHEN** 系统恢复一个尺寸远大于单次结果状态的 journal，且其尾部不需要修复
- **THEN** 读取过程 SHALL NOT 以整文件为单位读取内容
- **THEN** 恢复结果 SHALL NOT 携带修复文本
- **THEN** 系统 SHALL NOT 为得到该结果对每条记录或状态对象做一次额外深拷贝

#### Scenario: 单次操作承载整段历史
- **WHEN** journal 中一次 `append_records` 操作包含大量记录（例如分叉会话的初始快照）
- **THEN** 恢复 SHALL 得到该操作声明的全部记录，SHALL NOT 因记录数量而失败

#### Scenario: 结果确定后停止读取
- **WHEN** 恢复在读取早期即可判定不可恢复，或修复所需的有效前缀已经收齐
- **THEN** 系统 SHALL 停止读取剩余内容并释放读取资源
- **THEN** 该行为 SHALL NOT 改变恢复结果或修复文本内容

#### Scenario: 需要修复时按需重建修复文本
- **WHEN** 恢复过程判定尾部需要修复，且调用方允许修复
- **THEN** 系统 SHALL 仅在此时重建仅包含有效前缀的修复文本
- **THEN** 重建 SHALL 按非空逻辑行计数，并复用既有规范化规则
- **THEN** 该次恢复的写回结果 SHALL 与既有行为一致：不含无效尾行、不含空行、行首尾无多余空白

#### Scenario: 增量形态与整份形态恢复出等价状态
- **WHEN** 同一个轮次序列分别以"每轮 `set_change_history` 写入整份栈"和"每轮 `push_change_checkpoint` 写入增量"两种形态持久化
- **THEN** 两种 journal 的 replay 结果 SHALL 在 records、compaction、todoState 与 changeHistory 上逐字段等价
- **THEN** 该等价性 SHALL 同时覆盖 `pop_change_checkpoint` 与整份重写表达的同一次回退

#### Scenario: 混合形态 journal 恢复
- **WHEN** 一个 journal 的前缀使用 `set_change_history`，其后使用 `push_change_checkpoint` 与 `pop_change_checkpoint`
- **THEN** 系统 SHALL 按文件顺序应用这些操作并恢复出等价栈
- **THEN** 系统 SHALL NOT 要求该 journal 先经过迁移或改写

#### Scenario: 空栈弹出不可恢复
- **WHEN** replay 遇到 `pop_change_checkpoint` 且当前 change history 栈为空
- **THEN** 系统 SHALL 将该 session 视为不可恢复
- **THEN** 系统 SHALL NOT 静默忽略该操作

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

### Requirement: 按当前 cwd 受控删除持久化 session
系统 SHALL 提供仅供应用层调用的持久化 session 删除操作。该操作 SHALL 只接受当前 cwd 中、由 session 列表选出的 session id，且 SHALL 在删除前验证目标不是当前正在使用的 session、对应 `.jsonl` journal 存在并属于该 cwd；操作 SHALL NOT 根据用户输入的任意路径删除文件。成功删除的提交点 SHALL 是目标 JSONL journal 被移除，此后正式加载和 session 枚举 SHALL 不再将其视为可恢复 session。

#### Scenario: 成功删除一个历史 journal
- **WHEN** 应用层请求删除当前 cwd 中存在的非当前 session
- **THEN** 系统 SHALL 移除该 session 对应的 `.jsonl` journal
- **THEN** 后续 `loadSession` SHALL 不再加载该 session，`/resume` 和 `/reference` 枚举 SHALL 不再返回该 session

#### Scenario: 目标不存在或不属于当前 cwd
- **WHEN** 应用层请求删除不存在的 session、其他 cwd 的 session 或不满足受控 session id 约束的目标
- **THEN** 系统 SHALL 返回不成功的受控结果
- **THEN** 系统 SHALL NOT 删除任何 journal、index 条目或其他 session 文件

#### Scenario: 目标是当前 session
- **WHEN** 应用层请求删除当前 app 仍持有写入 reference 的 session
- **THEN** 系统 SHALL 返回当前 session 受保护的结果
- **THEN** 系统 SHALL 保持该 journal、当前 transcript 和后续写入能力不变

### Requirement: 删除后 session index 与 journal 集合保持可重建一致
系统 SHALL 在成功移除 session journal 后从当前项目的轻量 session index 移除对应摘要，并使用既有临时文件与原子替换方式提交 index。若 journal 已删除但 index 写入失败，系统 SHALL 将 journal 删除视为已提交的事实；后续枚举 SHALL 排除该孤立 index 条目，并在能够写入时重建或修复 index。

#### Scenario: 删除成功时更新 index
- **WHEN** 一个历史 session journal 被成功删除且 index 可写
- **THEN** 新 index SHALL 不包含该 session 的摘要
- **THEN** index 更新 SHALL NOT 重写或删除其他有效 journal

#### Scenario: 删除后 index 更新失败
- **WHEN** 一个历史 session journal 已被成功删除但 index 的原子更新失败
- **THEN** 系统 SHALL NOT 将已删除 journal 视为仍可恢复
- **THEN** 下一次 session 枚举 SHALL 从真实 `.jsonl` 集合排除该孤立条目，并在可写时修复 index

