## ADDED Requirements

### Requirement: edit_file 精确字符串编辑工具
系统 SHALL 提供 provider-neutral 本地工具 `edit_file`，用于通过 search-and-replace 更新已有 UTF-8 文本文件。工具 definition SHALL 接收 JSON object `{ "path": string, "old_string": string, "new_string": string, "replace_all"?: boolean }`，其中 `path`、`old_string` 和 `new_string` 为必填字段，`replace_all` 缺失时 SHALL 视为 false。相对路径 SHALL 基于当前工作目录解析，绝对路径和包含 `..` 的路径 SHALL 与 `apply_patch` 使用相同的路径策略。

#### Scenario: 唯一匹配替换成功
- **WHEN** `edit_file` 收到已有 UTF-8 文本文件路径，且非空 `old_string` 在当前文件内容中精确匹配一次
- **AND** `new_string` 与 `old_string` 不同
- **THEN** handler SHALL 只替换该匹配并写回文件
- **THEN** result SHALL 标记 `ok: true`，保留原始 call id 和工具名，并说明实际替换数量与目标路径

#### Scenario: 零匹配拒绝写入
- **WHEN** `old_string` 在目标文件当前内容中精确匹配零次
- **THEN** handler SHALL 返回 `ok: false` 和可操作的重新读取文件提示
- **THEN** handler SHALL NOT 修改目标文件或产生成功 change-history entry

#### Scenario: 默认模式拒绝多匹配
- **WHEN** `replace_all` 为 false 或缺失，且 `old_string` 在目标文件中精确匹配多次
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** 失败文本 SHALL 提示增加 `old_string` 上下文或显式使用 `replace_all`
- **THEN** handler SHALL NOT 修改目标文件

#### Scenario: 显式替换全部匹配
- **WHEN** `replace_all` 为 true，且非空 `old_string` 在目标文件中精确匹配一次或多次
- **THEN** handler SHALL 基于调用前文件内容替换全部非重叠匹配
- **THEN** handler SHALL NOT 递归匹配已插入的 `new_string`
- **THEN** result SHALL 报告实际替换数量

#### Scenario: 拒绝无定位或无实际变化的参数
- **WHEN** `old_string` 为空、`old_string` 与 `new_string` 相同，或参数类型不符合 schema
- **THEN** handler SHALL 返回 `ok: false` 和简洁原因
- **THEN** handler SHALL NOT 写入文件

#### Scenario: 多行及行内替换
- **WHEN** `old_string` 精确匹配目标文件中的多行区间或单行子串
- **THEN** handler SHALL 按字符串边界替换该区间而不是要求整行匹配
- **THEN** 未命中区域的文件内容 SHALL 保持不变

### Requirement: edit_file 文件安全边界与受控写入
`edit_file` SHALL 在写盘前完成参数、路径、目标类型、文件大小、文本内容、匹配数量和 post-image 校验。工具 SHALL 只编辑已有普通 UTF-8 文本文件，SHALL 拒绝 `.git` 内路径、缺失目标、目录、非普通文件、包含 NUL 的内容、无法按 UTF-8 安全处理的内容和超过安全上限的文件。工具 SHALL 在成功写入前调用 change recorder 保存 before snapshot，并在成功写入后标记 after 状态。

#### Scenario: 无效目标不写盘
- **WHEN** 目标路径缺失、位于 `.git`、指向目录或非普通文件、内容不受支持或超过上限
- **THEN** handler SHALL 返回 `ok: false` 和目标相关原因
- **THEN** handler SHALL NOT 创建、删除或覆盖其他路径

#### Scenario: search-and-replace 先模拟后写盘
- **WHEN** `edit_file` 收到有效参数
- **THEN** handler SHALL 先读取 before content、计算全部匹配并构造 post-image
- **THEN** 只有所有校验成功后 handler 才 SHALL 写回目标文件

#### Scenario: 成功写入进入 change history
- **WHEN** `edit_file` 成功写回已有文件
- **THEN** handler SHALL 在写入前通过 change recorder 捕获该文件 before snapshot
- **THEN** handler SHALL 在写入成功后把该文件标记为 updated

#### Scenario: 写盘失败保留失败事实
- **WHEN** `edit_file` 完成模拟但文件写入失败
- **THEN** result SHALL 标记 `ok: false` 并包含简洁写入失败原因
- **THEN** handler SHALL NOT 把未成功写入标记为 updated

### Requirement: 可配置的 provider-visible 文件编辑工具
系统 SHALL 从 `tools.fileEdit.mode` 读取文件编辑模式，并在每次准备 assistant run 的默认 tool registry 时只注册所选的 provider-visible 文件编辑工具。有效模式 SHALL 为 `apply_patch` 和 `edit_file`；缺失或非法值 SHALL 回退 `apply_patch`。其他内置工具和 MCP registry 合并语义 SHALL 保持不变。

#### Scenario: 默认继续使用 apply_patch
- **WHEN** `tools.fileEdit.mode` 缺失或非法
- **THEN** 默认 registry SHALL 包含 `apply_patch`
- **THEN** 默认 registry SHALL NOT 包含 `edit_file`

#### Scenario: 选择 edit_file
- **WHEN** `tools.fileEdit.mode` 为 `edit_file`
- **THEN** 默认 registry SHALL 包含 `edit_file`
- **THEN** 默认 registry SHALL NOT 包含 `apply_patch`

#### Scenario: 选择 apply_patch
- **WHEN** `tools.fileEdit.mode` 为 `apply_patch`
- **THEN** 默认 registry SHALL 包含 `apply_patch`
- **THEN** 默认 registry SHALL NOT 包含 `edit_file`

#### Scenario: 当前 run 固定工具集合
- **WHEN** assistant run 已经准备完成后用户配置发生变化
- **THEN** 当前 run SHALL 继续使用启动时的 tool definitions 和 executor registry
- **THEN** 下一次 assistant run SHALL 使用最新归一化模式

### Requirement: edit_file display metadata
`edit_file` 成功结果 SHALL 携带 display-only 文件编辑 metadata，使 TUI 无需读取当前文件或重新执行 search-and-replace 即可展示实际 before/after 行变化。metadata SHALL 使用与 `apply_patch` renderer 可共享的 file、line kind 和 post-image location 语义，同时保留可识别的 `edit_file` 来源。

#### Scenario: 行内替换生成完整旧行和新行
- **WHEN** `edit_file` 在一行内部替换部分字符串并成功写盘
- **THEN** metadata SHALL 将修改前完整逻辑行表示为 removed row
- **THEN** metadata SHALL 将修改后完整逻辑行表示为 added row
- **THEN** 周围未变化行 SHALL 表示为带可信 post-image 行号的 context row

#### Scenario: replace_all 生成多个修改区块
- **WHEN** `edit_file` 使用 `replace_all` 修改同一文件中多个相离区间
- **THEN** metadata SHALL 保留各实际修改区块及其最终 post-image 位置
- **THEN** 同一逻辑行中的多个替换 SHALL 合并为一组旧行和新行事实

#### Scenario: metadata 不改变 provider 结果
- **WHEN** handler 返回带 display metadata 的成功结果
- **THEN** provider-facing result text SHALL 继续只表达执行结果
- **THEN** display metadata SHALL 只用于 transcript 持久化和 TUI 投影

