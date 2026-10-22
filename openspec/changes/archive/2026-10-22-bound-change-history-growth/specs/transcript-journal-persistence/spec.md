## MODIFIED Requirements

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
