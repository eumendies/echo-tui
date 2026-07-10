## MODIFIED Requirements

### Requirement: apply_patch display metadata
`apply_patch` handler SHALL 为成功解析的 patch input 生成 display-only metadata，使 TUI 可以基于完整事实行序列展示实际编辑结构和可信位置，而无需重新解析 patch 文本或在渲染时读取目标文件。该 metadata SHALL 保持 provider-facing result text 和 patch 执行语义不变。

#### Scenario: 生成完整文件事实行
- **WHEN** `apply_patch` 成功解析 patch input
- **THEN** handler SHALL 为每个成功应用的 update file 记录覆盖完整 post-image 文件的有序 context/added 行
- **THEN** handler SHALL 在对应修改位置插入 removed 行
- **THEN** handler SHALL NOT 在 metadata 中预先折叠 context 或生成 omitted rows
- **THEN** display metadata SHALL NOT 包含只用于版本兼容的 schema version 字段

#### Scenario: 记录成功定位的 update hunk
- **WHEN** `apply_patch` 在目标文件中为 update hunk 找到精确唯一匹配
- **THEN** handler SHALL 按实际匹配位置记录该 hunk 的 context、removed 和 added 展示行
- **THEN** handler SHALL 记录 renderer 推导修改后文件真实行号所需的位置信息
- **THEN** handler SHALL NOT 使用 patch header 中声明的行号替代实际匹配位置
- **THEN** handler SHALL 保持展示行的编辑顺序

#### Scenario: 记录修改区块周边上下文
- **WHEN** update hunk 成功定位
- **THEN** handler SHALL 记录目标文件中的全部未修改 context 行
- **THEN** handler SHALL 保持每个 post-image 文件行只出现一次
- **THEN** renderer SHALL 能够只使用 metadata 计算任意修改区块前后的 context 和省略数量

#### Scenario: 使用修改后文件的行号推进语义
- **WHEN** handler 为成功定位的 hunk 生成 display metadata
- **THEN** context 行 SHALL 对应一个修改后文件真实行号并推进一个行号
- **THEN** added 行 SHALL 对应并占用一个修改后文件真实行号
- **THEN** removed 行 SHALL NOT 占用修改后文件行号
- **THEN** 后续 context 的真实行号 SHALL 包含此前 added 行造成的推进并排除 removed 行

#### Scenario: 记录新增文件内容
- **WHEN** `apply_patch` 成功解析 added file patch
- **THEN** handler SHALL 将每个文件内容行记录为 added 展示行
- **THEN** added 行的修改后文件位置 SHALL 从第 1 行开始依次推进
- **THEN** handler SHALL NOT 将 `*** Add File`、`---`、`+++` 或 hunk header 等 patch 语法记录为展示行

#### Scenario: display metadata 不改变执行语义
- **WHEN** `apply_patch` 成功应用 patch
- **THEN** result SHALL 保留现有包含 changed files summary 的 provider-facing success text
- **THEN** result SHALL 包含供 TUI 使用的 display-only metadata
- **THEN** handler SHALL 继续使用 `oldLines` 和 `newLines` 执行精确 hunk 匹配和文件写入
- **THEN** display metadata SHALL NOT 作为 provider continuation 的 tool result text

#### Scenario: 匹配失败时不伪造位置
- **WHEN** patch 已成功解析但 update hunk 匹配 0 个或多个位置
- **THEN** result SHALL 保持 `ok: false` 和现有简洁失败原因
- **THEN** result MAY 包含解析得到的尝试编辑内容
- **THEN** display metadata 中无法定位的行 SHALL 使用 `postLine: null`
- **THEN** display metadata SHALL NOT 把 patch header 行号记录为真实匹配位置
- **THEN** display metadata SHALL NOT 包含无法确认的目标文件周边上下文
- **THEN** handler SHALL NOT 写入部分文件变更

#### Scenario: 写入失败时保留已模拟的展示结构
- **WHEN** 所有 hunk 已在内存中成功定位和模拟但文件写入失败
- **THEN** result SHALL 保持 `ok: false` 和写入失败原因
- **THEN** result MAY 保留基于内存模拟产生的实际位置和上下文 metadata
- **THEN** handler SHALL NOT 将 display metadata 作为文件已成功写入的证明

#### Scenario: 解析失败时安全降级
- **WHEN** `apply_patch` 无法将 patch input 解析为支持的操作
- **THEN** result SHALL 保持 `ok: false` 和现有简洁解析失败原因
- **THEN** result SHALL NOT require display metadata
