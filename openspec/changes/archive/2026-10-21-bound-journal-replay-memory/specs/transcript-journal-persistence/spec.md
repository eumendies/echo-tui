## MODIFIED Requirements

### Requirement: journal replay 与恢复容错
系统 SHALL 按 journal 文件顺序 replay 有效操作以恢复当前 records、todoState、compaction、changeHistory 和 updatedAt。`truncate_records` SHALL 作用于 replay 时当前 records 数组；每个 `set_*` SHALL 覆盖对应的当前状态。系统 SHALL 按行读取与重放 journal，SHALL NOT 额外保留完整文件副本（整文件字符串、行数组或等量的修复文本副本）：读取过程的常驻内存 SHALL 由读取缓冲、最大单行解析开销与重放期间的有效状态构成，该有效状态 MAY 大于最终结果（例如先追加大量 records 再 `truncate_records`）。修复文本 SHALL 仅在本次恢复确实需要修复尾部时由恢复方构造，且 SHALL 复用既有的规范化规则（去除行首尾空白、丢弃空行、以 `\n` 连接），其计数单位 SHALL 是非空逻辑行；正常恢复路径 SHALL NOT 构造该文本。replay SHALL NOT 重复深拷贝本次读取已经独占持有的解析产物。重放 SHALL NOT 因单次操作的记录数量或单行长度而失败或终止进程；在结果已经确定（判定不可恢复，或修复所需前缀已收齐）时，系统 SHALL 停止读取剩余内容。

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
- **WHEN** 最后一行结构有效但语义失败（seq 不连续、`truncate_records` 越界）
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
