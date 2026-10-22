## MODIFIED Requirements

### Requirement: 恢复与回退后安装活跃记录
系统 SHALL 在恢复 session 或完成 Undo 后，依据目标 compaction 安装其活跃记录及完整历史起点；无 compaction 时 SHALL 保留目标完整记录且起点为零。恢复及跨边界 Undo MAY 临时全量读取现有 journal，但操作完成后主会话 SHALL NOT 长期保留被目标摘要覆盖的前缀。安装活跃后缀时系统 SHALL NOT 重复深拷贝读取路径已经独占持有的记录数组。

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

#### Scenario: 安装后缀不复制读取结果
- **WHEN** 恢复会话并安装活跃后缀
- **THEN** 系统 SHALL 直接安装该次读取产生的记录，SHALL NOT 为同一批记录再做一次等量深拷贝
- **THEN** 安装后的常驻 records SHALL 只包含目标边界之后的有效记录

### Requirement: 完整历史操作不退化为活跃区操作
系统 SHALL 保持完整历史消费者的既有语义，SHALL NOT 因内存裁剪使 `/fork`、`/copy`、历史引用或子 Agent 回看静默遗漏有效记录。需要旧原文时系统 MAY 按需全量读取 journal；新引入的临时记录持有者 SHALL 在对应操作或视图结束后释放，不得重新装入主会话常驻 records。该按需回读 SHALL 逐行读取 journal，SHALL NOT 额外保留完整文件副本，SHALL NOT 为回读结果再做一次等量深拷贝。

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

#### Scenario: 大 journal 的完整历史回读内存特征
- **WHEN** `/fork`、`/copy`、历史引用、子 Agent 回看或跨边界 Undo 触发一次完整历史回读
- **THEN** 回读 SHALL NOT 以整文件为单位读取 journal 内容
- **THEN** 回读的临时保留量 SHALL 由解析出的有效记录与重放期间的有效状态决定，SHALL NOT 额外携带完整文件副本
- **THEN** 系统 SHALL NOT 为同一批回读结果再复制一份等量对象
