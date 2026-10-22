## MODIFIED Requirements

### Requirement: 压缩状态存储
系统 SHALL 把压缩状态作为 session 级元数据持久化，包含摘要文本、活跃区间起点索引和创建时间。完整持久化历史 SHALL 不因压缩而删除任何记录；内存驻留数组 SHALL 在成功采纳压缩后释放被压缩前缀。`activeStartIndex` SHALL 表示完整有效历史中的记录位置，而非驻留数组下标；驻留起点 SHALL 与该位置一致。自动压缩追加可见提示记录时，runtime 与应用 SHALL 维护相同的完整历史坐标及提示事实，使同一 agent run 的后续压缩仍能返回正确的持久化位置。

#### Scenario: 压缩后保存压缩元数据
- **WHEN** 一次压缩完成并成功采纳
- **THEN** 系统 SHALL 在当前 session 中保存摘要文本和完整历史中的活跃区间起点
- **THEN** 系统 SHALL 释放应用及对应 runtime 中的已压缩前缀，但 SHALL NOT 删除 journal 中的原始记录

#### Scenario: 完整历史不因压缩丢失
- **WHEN** session 已发生压缩
- **THEN** 从持久化 journal 重放的完整有效历史 SHALL 仍包含被压缩区间的全部原始记录

#### Scenario: 同一 agent run 连续压缩保持索引一致
- **WHEN** 自动压缩追加了可见提示记录，且同一 agent run 随后再次触发压缩
- **THEN** runtime 与应用 SHALL 在提示记录位置保持一致的完整历史坐标
- **THEN** 第二次压缩返回的 `activeStartIndex` SHALL 指向两侧同一条业务记录，并正确包含此前驻留起点偏移
- **THEN** 已纳入摘要的记录 SHALL NOT 因索引偏移再次出现在活跃区间或新增摘要素材中

### Requirement: 压缩后的请求投影
系统 SHALL 在存在压缩状态时按「system prompt + 摘要消息 + 活跃区间」投影 provider 请求。摘要 SHALL 作为一条 `user` 消息置于内置 system prompt 之后、活跃区间之前。活跃区间 SHALL 为完整有效历史中 `activeStartIndex` 之后的记录；当输入为裁剪后的驻留数组时，系统 SHALL 根据驻留起点转换为局部下标，SHALL NOT 再直接以完整 `activeStartIndex` 切片而遗漏记录。无压缩状态时 SHALL 退化为现有「system prompt + 全部记录」投影。当当前 session 的 journal 源路径可用时，摘要消息 SHALL 附加该 `source_file` 绝对路径，并提示模型仅在需要精确细节时使用现有 `read_files` 工具分页读取该文件；路径不可用（如 headless 单轮运行）时 SHALL 只注入摘要本身。

#### Scenario: 存在压缩状态时注入摘要与活跃记录
- **WHEN** session 存在压缩状态且发起 provider 请求
- **THEN** provider input SHALL 在 system prompt 之后包含一条携带摘要文本的 `user` 消息
- **THEN** provider input SHALL 只包含完整历史中 `activeStartIndex` 之后的活跃记录投影
- **THEN** 已裁剪驻留数组 SHALL NOT 被同一完整历史起点再次切片而变为空或遗漏近期记录

#### Scenario: 无压缩状态时退化为全量投影
- **WHEN** session 不存在压缩状态且发起 provider 请求
- **THEN** provider input SHALL 包含全部可发送记录
- **THEN** provider input SHALL NOT 包含摘要消息

#### Scenario: 存在源路径时注入回读提示
- **WHEN** session 存在压缩状态、发起 provider 请求且当前 session 的 journal 源路径可用
- **THEN** 摘要消息 SHALL 附带 `source_file: <绝对路径>` 行
- **THEN** 摘要消息 SHALL 提示模型仅在需要精确细节时使用现有 `read_files` 工具分页读取该文件
- **THEN** 系统 SHALL NOT 注册或暴露新的专用会话读取工具

#### Scenario: 源路径不可用时只注入摘要
- **WHEN** session 存在压缩状态、发起 provider 请求且当前 session 无 journal 源路径（如 headless 单轮运行）
- **THEN** 摘要消息 SHALL NOT 包含 `source_file` 行或回读提示
- **THEN** 摘要消息 SHALL 继续包含摘要文本本身
