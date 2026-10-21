# compacted-transcript-residency Specification

## Purpose
定义已压缩 transcript 的内存驻留与历史访问语义：活跃后缀与完整历史位置的分离、压缩采纳后对已压缩前缀引用的释放、恢复与回退时只安装活跃记录，以及 fork/copy/审批等完整历史操作不因裁剪而退化。
## Requirements
### Requirement: 压缩后的 transcript 驻留范围
系统 SHALL 在一次 compaction 成功采纳后，只在对应应用及 Agent 运行记录区中驻留当前 compaction 状态和活跃边界之后的 transcript。系统 SHALL 解除这些记录区及本轮输入快照对已压缩记录原始对象、正文和附件的引用，SHALL NOT 将被释放前缀转移到另一个后台历史缓存。完整原文 SHALL 继续保存在既有 journal 中；本要求不约束已写入终端的 scrollback 或独立 Undo 文件快照。

#### Scenario: 自动压缩释放旧前缀
- **WHEN** 自动压缩成功采纳边界 B 和非空摘要
- **THEN** 应用、对应 runtime 和仍被本轮持有的输入记录快照 SHALL 不再持有逻辑位置小于 B 的 transcript 原始记录
- **THEN** 边界之后的记录 SHALL 保持原顺序及全部结构字段，摘要和新 notice SHALL 保持有效
- **THEN** journal SHALL 保留边界之前的原始记录

#### Scenario: 手动压缩沿用同一释放规则
- **WHEN** 用户执行 `/compact` 且压缩成功
- **THEN** 系统 SHALL 按同一活跃边界规则释放应用驻留区旧前缀
- **THEN** 下一轮 Agent 输入快照 SHALL 只复制活跃记录和当前 compaction 状态

#### Scenario: 未采纳压缩不释放原始记录
- **WHEN** 压缩没有有效边界、返回空摘要、失败或在采纳前被取消
- **THEN** 系统 SHALL 保持原摘要、记录起点和驻留记录不变

#### Scenario: 持久化失败不提前裁剪
- **WHEN** 摘要已生成但交互式主会话的 compaction/notice journal batch 写入失败
- **THEN** 系统 SHALL NOT 提前裁剪应用驻留记录或推进其压缩边界
- **THEN** 系统 SHALL 按现有失败流程反馈错误

### Requirement: 完整历史位置与驻留下标分离
系统 SHALL 为驻留记录维护其完整历史起点，SHALL 使用起点加驻留长度计算完整有效记录数。compaction 边界、Undo checkpoint、审批关联和稳定消息标识 SHALL 使用完整历史位置，SHALL NOT 把驻留数组长度或下标当作完整位置。该起点 SHALL 为运行时派生状态，SHALL NOT 要求变更现有 journal schema。

#### Scenario: 裁剪后追加保持总数
- **WHEN** 起点为 800、驻留记录为 200 条，系统追加一条 notice
- **THEN** 完整有效记录数 SHALL 为 1001，驻留记录数 SHALL 为 201
- **THEN** 新记录的完整历史位置 SHALL 为 1000

#### Scenario: 新轮 checkpoint 使用完整位置
- **WHEN** 当前会话已释放旧前缀并开始新的 assistant loop
- **THEN** checkpoint 的 transcript 起点 SHALL 取完整有效记录数，而非驻留记录数

#### Scenario: 日常摘要更新不重载已压缩历史
- **WHEN** 已压缩会话追加普通 record 或更新独立会话状态
- **THEN** session 列表中的记录数 SHALL 包含已压缩前缀，标题 SHALL 仍按完整有效历史派生
- **THEN** 系统 SHALL NOT 为该次正常摘要更新全量重载 journal 或复制完整历史

### Requirement: 恢复与回退后安装活跃记录
系统 SHALL 在恢复 session 或完成 Undo 后，依据目标 compaction 安装其活跃记录及完整历史起点；无 compaction 时 SHALL 保留目标完整记录且起点为零。恢复及跨边界 Undo MAY 临时全量读取现有 journal，但操作完成后主会话 SHALL NOT 长期保留被目标摘要覆盖的前缀。

#### Scenario: 恢复已压缩的旧 session
- **WHEN** `/resume` 加载 schemaVersion 1 的完整 journal 且其中包含 compaction
- **THEN** 主会话常驻 records SHALL 仅包含该边界之后的有效记录
- **THEN** 摘要、todo、change history 和完整记录计数 SHALL 正确恢复
- **THEN** 下一轮 provider 投影 SHALL 与从完整历史按同一边界切片的结果等价

#### Scenario: Undo 跨越已释放前缀
- **WHEN** 用户确认可回退 checkpoint，且目标 compaction 或 transcript 边界需要已经释放的原始记录
- **THEN** 系统 SHALL 从 journal 读取目标状态所需历史，而非将目标边界钳到驻留数组长度
- **THEN** 成功回退后 SHALL 恢复目标摘要和对应活跃区，连续 Undo 能力 SHALL 保持不变

#### Scenario: 跨边界回读失败
- **WHEN** 执行 Undo 所需的历史无法读取
- **THEN** 系统 SHALL 报告失败并保留 checkpoint
- **THEN** 系统 SHALL NOT 因本次回读失败修改受控文件、截断 transcript 或改变 compaction

#### Scenario: Undo 后追加与再次压缩
- **WHEN** 已压缩会话成功 Undo 后继续追加记录并再次压缩
- **THEN** 新记录、压缩边界及 journal 截断/追加 SHALL 使用目标会话的正确完整历史位置
- **THEN** 被 Undo 删除的记录 SHALL NOT 重新进入请求或主会话投影

#### Scenario: 清空会话重置起点
- **WHEN** 用户执行 `/clear`
- **THEN** 当前驻留记录、compaction 和历史起点 SHALL 一起重置
- **THEN** 原 journal SHALL 仍可按现有机制恢复

### Requirement: 完整历史操作不退化为活跃区操作
系统 SHALL 保持完整历史消费者的既有语义，SHALL NOT 因内存裁剪使 `/fork`、`/copy`、历史引用或子 Agent 回看静默遗漏有效记录。需要旧原文时系统 MAY 按需全量读取 journal；新引入的临时记录持有者 SHALL 在对应操作或视图结束后释放，不得重新装入主会话常驻 records。

#### Scenario: 分叉已压缩会话
- **WHEN** 用户对已压缩会话执行 `/fork`
- **THEN** 新 journal SHALL 包含分叉时的完整有效历史及当前 compaction、todo 和 change history
- **THEN** 新分支 SHALL 不依赖源 journal 恢复，当前驻留区 SHALL 仍只包含活跃后缀
- **THEN** 失败 SHALL 保持源会话可用

#### Scenario: 复制已压缩消息
- **WHEN** 用户打开 `/copy` 并选择位于已释放前缀的 user 或 assistant 消息
- **THEN** 系统 SHALL 能显示并复制该消息原文，顺序和多选语义 SHALL 保持不变
- **THEN** 面板关闭后，其临时加载的完整消息集合 SHALL 不再被该面板或主会话持有

#### Scenario: 回看旧子 Agent 运行
- **WHEN** 用户打开位于已压缩历史中的子 Agent run
- **THEN** 系统 SHALL 能发现并回看该 run 的完整有效过程
- **THEN** 退出该视图后 SHALL 释放其临时加载的原始过程记录，并恢复主会话活跃投影

#### Scenario: 审批引用已逐出的当前轮事实
- **WHEN** 同一 assistant loop 压缩后，审批流程需要查找已逐出的用户请求或已提交问答记录
- **THEN** 系统 SHALL 按完整历史位置查找必要事实，SHALL NOT 将其误判为从未存在
- **THEN** 回读 SHALL NOT 建立永久完整 transcript 副本

### Requirement: 运行入口共享偏移语义
系统 SHALL 让自动、手动、子 Agent 及 headless 压缩共享驻留起点与完整边界转换规则。BTW 捕获主会话输入时 SHALL 仅冻结当前摘要和活跃记录，保持打开时快照隔离；主会话逻辑起点 SHALL NOT 被误用于旁路自身显示记录计数。无持久化 journal 的入口 SHALL NOT 因本变更新建可恢复 transcript session。

#### Scenario: BTW 从已压缩主会话打开
- **WHEN** 用户从已压缩主会话打开 BTW，并随后继续更新或压缩主会话
- **THEN** BTW SHALL 使用打开时的摘要和活跃记录快照，SHALL NOT 复制主会话已压缩前缀
- **THEN** 主会话后续裁剪 SHALL NOT 改变 BTW 已冻结的输入

#### Scenario: 无 journal 的连续工具运行
- **WHEN** headless 或子 Agent runtime 在同一运行中连续压缩
- **THEN** 后续摘要和普通请求 SHALL 只处理各自尚未压缩的活跃记录
- **THEN** 完整边界转换 SHALL 正确，系统 SHALL NOT 为此创建新的可恢复 session

