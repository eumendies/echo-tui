## MODIFIED Requirements

### Requirement: apply_patch text editing tool
系统 SHALL 提供本地工具 `apply_patch`，仅接收 `*** Begin Patch` / `*** End Patch` 包裹的 Add/Update/Delete File patch 文本来新增、更新或删除 UTF-8 文本文件。该工具 SHALL 接收 JSON object 参数 `{ "patch": string }`，并 SHALL 返回可回传模型的结构化 tool execution result。单个 patch 中解析到同一绝对路径的多个文件操作 SHALL 按其声明顺序在同一虚拟文件状态上执行。

#### Scenario: 默认注册 apply_patch 工具定义
- **WHEN** 系统创建默认 tool registry
- **THEN** registry SHALL 包含名为 `apply_patch` 的 tool definition
- **THEN** 该 definition SHALL 要求 `patch` 字段为 string
- **THEN** 该 definition SHALL 声明只支持 `*** Begin Patch` 格式的 Add/Update/Delete File，不得宣传 unified diff 输入

#### Scenario: 拒绝独立 unified diff 输入
- **WHEN** `apply_patch` 收到去除允许的前导空行及公共缩进后仍未以 `*** Begin Patch` 起始的 patch，包括 `diff --git`、`---` / `+++` 文件头、带 `@@` 的 unified diff 或其他普通文本
- **THEN** handler SHALL 返回 `ok: false`，并提示只支持 `*** Begin Patch` 格式
- **THEN** handler SHALL NOT 将 unified diff 的文件头或 hunk 解释为文件操作
- **THEN** handler SHALL NOT 写入、创建或删除任何文件

#### Scenario: Begin Patch 不接受混入的 unified diff 文件段
- **WHEN** `*** Begin Patch` 与 `*** End Patch` 之间在文件指令位置混入 `diff --git`、`---` / `+++` 文件头或 `deleted file mode` 元数据，而不是将这些字符作为更新块中的文件内容
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** handler SHALL NOT 写入、创建或删除任何文件

#### Scenario: 应用 Begin Patch 新增文件
- **WHEN** `apply_patch` 收到 `*** Begin Patch` / `*** Add File: <path>` / `*** End Patch` 格式的有效新增文件 patch
- **THEN** handler SHALL 在目标路径的当前虚拟状态不存在时创建该文本文件
- **THEN** handler SHALL 将 `+` 前缀行作为新增文件内容
- **THEN** handler SHALL 复用相同路径校验和目标已存在检查

#### Scenario: 应用 Begin Patch 删除文件
- **WHEN** `apply_patch` 收到 `*** Begin Patch` / `*** Delete File: <path>` / `*** End Patch` 格式的有效删除文件 patch
- **THEN** handler SHALL 将该 patch 解析为删除目标文件的操作
- **THEN** handler SHALL 删除该普通 UTF-8 文本文件的虚拟状态
- **THEN** 如果目标文件的当前虚拟状态不存在，handler SHALL 返回 `ok: false` 且不得写入任何其他文件
- **THEN** handler SHALL 复用相同路径校验和安全上限检查

#### Scenario: 应用 Begin Patch 更新文件
- **WHEN** `apply_patch` 收到 `*** Begin Patch` / `*** Update File: <path>` / `*** End Patch` 格式的有效更新文件 patch
- **THEN** handler SHALL 将该 patch 转换为 update chunk 序列
- **THEN** handler SHALL 按 Begin Patch 顺序定位规则应用 chunk
- **THEN** handler SHALL 为该文件维护搜索游标，并从当前游标之后选择第一个精确匹配来定位 anchor、context-only chunk 或修改 chunk
- **THEN** handler SHALL 在每个匹配或替换后推进搜索游标，使后续 chunk 从已处理区域之后继续定位
- **THEN** handler SHALL 将 Begin Patch hunk body 每行第一列解析为操作符，并将第二列开始的内容作为文件文本保留，包括以 `+`、`-`、`@@` 或 `***` 开头的内容
- **THEN** handler SHALL 复用相同 all-or-nothing 写入语义

#### Scenario: Begin Patch 数字 hunk 头仍作为更新块
- **WHEN** 合法的 `*** Begin Patch` 输入中，`*** Update File` 的更新块头采用 `@@ -<old> +<new> @@` 形式
- **THEN** handler SHALL 按 Begin Patch 顺序定位规则应用该更新块
- **THEN** handler SHALL NOT 将该块头识别为独立 unified diff 输入

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

#### Scenario: 同一路径操作按顺序共享虚拟状态
- **WHEN** 一个 patch 中两个或更多操作经路径解析后指向同一绝对路径
- **THEN** handler SHALL 按 patch 声明顺序执行这些操作
- **THEN** 每个后续操作 SHALL 基于该路径前序操作后的虚拟存在性和内容校验
- **THEN** 相对路径和绝对路径指向同一文件时 SHALL 视为同一虚拟文件

#### Scenario: 删除后重建同名已有文件
- **WHEN** 一个 patch 先删除已有文本文件，再新增解析为同一绝对路径的文件
- **THEN** 新增操作 SHALL 基于该路径已删除的虚拟状态成功
- **THEN** 成功后该路径在磁盘中 SHALL 包含新增操作提供的新内容
- **THEN** handler SHALL 仅为该路径的最终状态执行一次写盘

#### Scenario: 前序操作产生的内容可供后续更新匹配
- **WHEN** 一个 patch 对同一解析后路径先成功新增或更新内容，再执行 update 操作
- **THEN** 后续 update hunk SHALL 在前序操作产生的虚拟内容中按既有精确匹配规则定位
- **THEN** 成功后磁盘内容 SHALL 等于全部顺序操作后的最终内容

#### Scenario: 无效虚拟状态迁移拒绝整个 patch
- **WHEN** 同一路径序列对当前虚拟状态执行不合法操作，例如对已存在状态新增、对已删除状态更新或删除
- **THEN** handler SHALL 返回 `ok: false` 和简洁失败原因
- **THEN** handler SHALL 不写入该 patch 涉及的任何文件

#### Scenario: 多文件 patch 以 all-or-nothing 方式应用
- **WHEN** `apply_patch` 收到包含一个或多个文件操作的 patch
- **THEN** handler SHALL 先在内存中解析、校验并按声明顺序应用全部操作
- **THEN** 只有全部操作成功时，handler SHALL 为每个最终状态发生变化的解析后路径写入、创建或删除一次
- **THEN** 任一操作失败时，handler SHALL 不写入任何目标文件

#### Scenario: 路径解析和基础路径拒绝
- **WHEN** patch 文件路径是相对路径
- **THEN** handler SHALL 按当前工作目录解析该路径
- **WHEN** patch 文件路径是绝对路径或包含 `..` 的相对路径
- **THEN** handler SHALL 允许该路径并解析到对应绝对路径
- **WHEN** patch 文件路径包含 NUL 或指向 `.git` 内部路径
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** handler SHALL 不写入、创建或删除任何文件

#### Scenario: Begin Patch 更新块匹配失败时拒绝应用
- **WHEN** Begin Patch update chunk 在当前搜索游标之后匹配 0 次
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 提示重新读取文件或增加上下文
- **THEN** handler SHALL 不写入任何文件

#### Scenario: 删除目标必须是可追踪文本文件
- **WHEN** `apply_patch` 首次从磁盘读取删除操作的目标文件，且该文件不存在、是目录、是 symlink、不是普通文件、包含 NUL 字节或超过单文件安全上限
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含简洁失败原因
- **THEN** handler SHALL 不写入、创建或删除任何文件

#### Scenario: 拒绝不支持的 Begin Patch 指令
- **WHEN** Begin Patch 包含重命名、移动或其他未支持的文件操作指令
- **THEN** handler SHALL 返回 `ok: false` 并说明该指令不受支持
- **THEN** handler SHALL 不写入、创建或删除任何文件

#### Scenario: patch 输入无效时返回工具失败结果
- **WHEN** `apply_patch` 收到空 patch、缺少目标路径、缺少 `*** End Patch` 或格式无法解析的 Begin Patch 更新块
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含简洁失败原因

#### Scenario: 限制 patch 和文件规模
- **WHEN** patch 文本、单个目标文件、文件操作数量或 hunk 数量超过内置安全上限
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** handler SHALL 不写入、创建或删除任何文件
