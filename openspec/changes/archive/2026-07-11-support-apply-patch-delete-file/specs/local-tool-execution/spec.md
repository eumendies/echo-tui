## MODIFIED Requirements

### Requirement: apply_patch text editing tool
系统 SHALL 提供本地工具 `apply_patch`，用于应用受支持的 patch 文本来新增、更新或删除 UTF-8 文本文件。该工具 SHALL 接收 JSON object 参数 `{ "patch": string }`，并 SHALL 返回可回传模型的结构化 tool execution result。

#### Scenario: 默认注册 apply_patch 工具定义
- **WHEN** 系统创建默认 tool registry
- **THEN** registry SHALL 包含名为 `apply_patch` 的 tool definition
- **THEN** 该 definition SHALL 要求 `patch` 字段为 string
- **THEN** 该 definition SHALL 声明工具应用 patch 到文本文件

#### Scenario: 应用更新已有文件的 unified diff
- **WHEN** `apply_patch` 收到针对已有文本文件的有效 unified diff
- **THEN** handler SHALL 根据 hunk 的 context lines 和 removed lines 在当前文件中寻找精确唯一匹配
- **THEN** handler SHALL 应用匹配 hunk 并写回更新后的文件内容
- **THEN** result SHALL 标记 `ok: true` 并包含 changed files summary

#### Scenario: 应用省略文件头的更新 patch
- **WHEN** `apply_patch` 收到 `diff --git a/<path> b/<path>` 后直接跟随 `@@` hunk 的 update patch
- **THEN** handler SHALL 从同路径 `diff --git` header 推断目标文件
- **THEN** handler SHALL 按普通 update hunk 的精确唯一匹配规则应用 patch
- **THEN** 如果 `diff --git` 的 old path 和 new path 不同，handler SHALL 拒绝该 patch 作为不支持的 rename/move

#### Scenario: 应用新增文件的 unified diff
- **WHEN** `apply_patch` 收到 `--- /dev/null` 到 `+++ b/<path>` 的有效新增文件 patch
- **THEN** handler SHALL 创建该文本文件
- **THEN** handler SHALL 在必要时创建父目录
- **THEN** 如果目标文件已存在，handler SHALL 返回 `ok: false` 且不得覆盖该文件

#### Scenario: 应用删除文件的 unified diff
- **WHEN** `apply_patch` 收到 `--- a/<path>` 到 `+++ /dev/null` 的有效删除文件 patch
- **THEN** handler SHALL 将该 patch 解析为删除目标文件的操作
- **THEN** handler SHALL 接受常见 `deleted file mode` metadata 作为删除文件语义的一部分
- **THEN** handler SHALL 使用删除 hunk 校验当前目标文件内容与 patch 表达的删除内容匹配
- **THEN** handler SHALL 删除该文本文件
- **THEN** result SHALL 标记 `ok: true` 并包含 changed files summary

#### Scenario: 应用 Begin Patch 新增文件
- **WHEN** `apply_patch` 收到 `*** Begin Patch` / `*** Add File: <path>` / `*** End Patch` 格式的有效新增文件 patch
- **THEN** handler SHALL 创建该文本文件
- **THEN** handler SHALL 将 `+` 前缀行作为新增文件内容
- **THEN** handler SHALL 复用相同路径校验和目标已存在检查

#### Scenario: 应用 Begin Patch 删除文件
- **WHEN** `apply_patch` 收到 `*** Begin Patch` / `*** Delete File: <path>` / `*** End Patch` 格式的有效删除文件 patch
- **THEN** handler SHALL 将该 patch 解析为删除目标文件的操作
- **THEN** handler SHALL 删除该普通 UTF-8 文本文件
- **THEN** 如果目标文件不存在，handler SHALL 返回 `ok: false` 且不得写入任何其他文件
- **THEN** handler SHALL 复用相同路径校验和安全上限检查

#### Scenario: 应用 Begin Patch 更新文件
- **WHEN** `apply_patch` 收到 `*** Begin Patch` / `*** Update File: <path>` / `*** End Patch` 格式的有效更新文件 patch
- **THEN** handler SHALL 将该 patch 转换为 update chunk 序列
- **THEN** handler SHALL 按 Begin Patch 顺序定位规则应用 chunk
- **THEN** handler SHALL 为该文件维护搜索游标，并从当前游标之后选择第一个精确匹配来定位 anchor、context-only chunk 或修改 chunk
- **THEN** handler SHALL 在每个匹配或替换后推进搜索游标，使后续 chunk 从已处理区域之后继续定位
- **THEN** handler SHALL 将 Begin Patch hunk body 每行第一列解析为操作符，并将第二列开始的内容作为文件文本保留，包括以 `+`、`-`、`@@` 或 `***` 开头的内容
- **THEN** handler SHALL 复用相同 all-or-nothing 写入语义

#### Scenario: Begin Patch context-only chunk 作为后续定位锚点
- **WHEN** `apply_patch` 收到 Begin Patch update，且其中一个 `@@` chunk 只包含 context lines
- **THEN** handler SHALL 接受该 chunk 作为定位锚点
- **THEN** handler SHALL 在当前搜索游标之后为该 context-only chunk 寻找第一个精确匹配
- **THEN** handler SHALL 从该匹配位置之后继续定位后续 chunk
- **THEN** handler SHALL NOT 因同一 context 在后续文件内容中再次出现而返回 multi match 失败
- **THEN** handler SHALL NOT 因该 chunk 自身没有新增或删除行而返回语法失败

#### Scenario: Begin Patch inline context anchor
- **WHEN** `apply_patch` 收到 Begin Patch update，且 chunk header 为 `@@ <context>`
- **THEN** handler SHALL 将 `<context>` 作为单行定位锚点
- **THEN** handler SHALL 在当前搜索游标之后寻找第一个匹配的锚点行
- **THEN** 如果该 chunk 只包含新增行，handler SHALL 在锚点行之后插入新增内容
- **THEN** 如果该 chunk 包含 context lines 或 removed lines，handler SHALL 从锚点行之后继续匹配并应用该 chunk
- **THEN** handler SHALL 在锚点匹配失败时拒绝应用该 patch
- **THEN** handler SHALL NOT 因同一锚点在后续文件内容中再次出现而返回 multi match 失败

#### Scenario: 拒绝无锚点纯插入
- **WHEN** `apply_patch` 收到 Begin Patch update，且修改 chunk 只有新增行、没有 inline context anchor、没有 context lines、也没有 removed lines
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 提示重新读取文件并在插入位置周围加入上下文
- **THEN** handler SHALL 不写入任何文件

#### Scenario: 拒绝无实际修改的 Begin Patch update
- **WHEN** `apply_patch` 收到 Begin Patch update，且该文件操作只包含 context-only chunk
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** handler SHALL 不写入任何文件

#### Scenario: 多文件 patch 以 all-or-nothing 方式应用
- **WHEN** `apply_patch` 收到包含多个文件操作的 patch
- **THEN** handler SHALL 先在内存中解析、校验并应用全部操作
- **THEN** 只有全部操作成功时，handler SHALL 写入所有目标文件
- **THEN** 任一操作失败时，handler SHALL 不写入任何目标文件

#### Scenario: 路径解析和基础路径拒绝
- **WHEN** patch 文件路径是相对路径
- **THEN** handler SHALL 按当前工作目录解析该路径
- **WHEN** patch 文件路径是绝对路径或包含 `..` 的相对路径
- **THEN** handler SHALL 允许该路径并解析到对应绝对路径
- **WHEN** patch 文件路径包含 NUL 或指向 `.git` 内部路径
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** handler SHALL 不写入、创建或删除任何文件

#### Scenario: hunk 匹配失败或歧义时拒绝应用
- **WHEN** unified diff update hunk 在目标文件中匹配 0 次或匹配多次
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 提示重新读取文件或增加上下文
- **THEN** handler SHALL 不写入任何文件
- **WHEN** Begin Patch update chunk 在当前搜索游标之后匹配 0 次
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 提示重新读取文件或增加上下文
- **THEN** handler SHALL 不写入任何文件
- **WHEN** unified diff delete hunk 不能确认当前文件内容正被删除为空内容
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 提示重新读取文件或增加上下文
- **THEN** handler SHALL 不写入、创建或删除任何文件

#### Scenario: 删除目标必须是可追踪文本文件
- **WHEN** `apply_patch` 删除操作的目标文件不存在、是目录、是 symlink、不是普通文件、包含 NUL 字节或超过单文件安全上限
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含简洁失败原因
- **THEN** handler SHALL 不写入、创建或删除任何文件

#### Scenario: 拒绝第一版不支持的 patch 类型
- **WHEN** patch 表达重命名/移动文件、mode/chmod change、binary patch 或 symlink patch
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 明确说明该 patch 类型不受支持
- **THEN** handler SHALL 不写入、创建或删除任何文件

#### Scenario: patch 输入无效时返回工具失败结果
- **WHEN** `apply_patch` 收到空 patch、非 unified diff 文本、缺少目标路径或格式无法解析的 hunk
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含简洁失败原因

#### Scenario: 限制 patch 和文件规模
- **WHEN** patch 文本、单个目标文件、文件数量或 hunk 数量超过内置安全上限
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** handler SHALL 不写入、创建或删除任何文件

### Requirement: apply_patch display metadata
`apply_patch` handler SHALL 为成功解析的 patch input 生成 display-only metadata，使 TUI 可以基于完整事实行序列展示实际编辑结构和可信位置，而无需重新解析 patch 文本或在渲染时读取目标文件。该 metadata SHALL 支持 added、updated 和 deleted 文件种类，并 SHALL 保持 provider-facing result text 和 patch 执行语义不变。

#### Scenario: 生成完整文件事实行
- **WHEN** `apply_patch` 成功解析 patch input
- **THEN** handler SHALL 为每个成功应用的 update file 记录覆盖完整 post-image 文件的有序 context/added 行
- **THEN** handler SHALL 在对应修改位置插入 removed 行
- **THEN** handler SHALL 为每个 delete file 记录原文件的有序 removed 行
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

#### Scenario: 记录删除文件内容
- **WHEN** `apply_patch` 成功解析并模拟 deleted file patch
- **THEN** handler SHALL 将原文件每个内容行记录为 removed 展示行
- **THEN** deleted 文件 metadata 的 `kind` SHALL 为 `deleted`
- **THEN** deleted 文件的 removed 行 `postLine` SHALL 为 `null`
- **THEN** handler SHALL NOT 将 `*** Delete File`、`---`、`+++`、`deleted file mode` 或 hunk header 等 patch 语法记录为展示行

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

#### Scenario: 删除校验失败时不伪造位置
- **WHEN** patch 已成功解析但 delete hunk 无法确认当前文件内容正被删除为空内容
- **THEN** result SHALL 保持 `ok: false` 和简洁失败原因
- **THEN** result MAY 包含解析得到的尝试删除结构
- **THEN** display metadata 中无法确认的 removed 行 SHALL 使用 `postLine: null`
- **THEN** handler SHALL NOT 删除目标文件

#### Scenario: 写入失败时保留已模拟的展示结构
- **WHEN** 所有 hunk 已在内存中成功定位和模拟但文件写入失败
- **THEN** result SHALL 保持 `ok: false` 和写入失败原因
- **THEN** result MAY 保留基于内存模拟产生的实际位置和上下文 metadata
- **THEN** handler SHALL NOT 将 display metadata 作为文件已成功写入的证明

#### Scenario: 解析失败时安全降级
- **WHEN** `apply_patch` 无法将 patch input 解析为支持的操作
- **THEN** result SHALL 保持 `ok: false` 和现有简洁解析失败原因
- **THEN** result SHALL NOT require display metadata
