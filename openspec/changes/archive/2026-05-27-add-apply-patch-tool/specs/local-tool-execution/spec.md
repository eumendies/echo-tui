## ADDED Requirements

### Requirement: apply_patch text editing tool
系统 SHALL 提供本地工具 `apply_patch`，用于应用受支持的 patch 文本来新增或更新 UTF-8 文本文件。该工具 SHALL 接收 JSON object 参数 `{ "patch": string }`，并 SHALL 返回可回传模型的结构化 tool execution result。

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

#### Scenario: 应用 Begin Patch 新增文件
- **WHEN** `apply_patch` 收到 `*** Begin Patch` / `*** Add File: <path>` / `*** End Patch` 格式的有效新增文件 patch
- **THEN** handler SHALL 创建该文本文件
- **THEN** handler SHALL 将 `+` 前缀行作为新增文件内容
- **THEN** handler SHALL 复用相同路径校验和目标已存在检查

#### Scenario: 应用 Begin Patch 更新文件
- **WHEN** `apply_patch` 收到 `*** Begin Patch` / `*** Update File: <path>` / `*** End Patch` 格式的有效更新文件 patch
- **THEN** handler SHALL 将该 patch 转换为 update hunk
- **THEN** handler SHALL 按普通 update hunk 的精确唯一匹配规则应用 patch
- **THEN** handler SHALL 复用相同 all-or-nothing 写入语义

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
- **THEN** handler SHALL 不写入任何文件

#### Scenario: hunk 匹配失败或歧义时拒绝应用
- **WHEN** update hunk 在目标文件中匹配 0 次或匹配多次
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 提示重新读取文件或增加上下文
- **THEN** handler SHALL 不写入任何文件

#### Scenario: 拒绝第一版不支持的 patch 类型
- **WHEN** patch 表达删除文件、重命名/移动文件、mode/chmod change、binary patch 或 symlink patch
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 明确说明该 patch 类型不受支持
- **THEN** handler SHALL 不写入任何文件

#### Scenario: patch 输入无效时返回工具失败结果
- **WHEN** `apply_patch` 收到空 patch、非 unified diff 文本、缺少目标路径或格式无法解析的 hunk
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含简洁失败原因

#### Scenario: 限制 patch 和文件规模
- **WHEN** patch 文本、单个目标文件、文件数量或 hunk 数量超过内置安全上限
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** handler SHALL 不写入任何文件
