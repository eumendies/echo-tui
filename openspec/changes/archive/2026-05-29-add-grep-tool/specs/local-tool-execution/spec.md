## ADDED Requirements

### Requirement: grep local text search tool
系统 SHALL 提供本地工具 `grep`，用于在本地文件中搜索文本并返回结构化、受限的匹配结果。该工具 SHALL 接收 JSON object 参数 `{ "pattern": string, "paths"?: string[] | null, "glob"?: string | null, "literal"?: boolean | null, "case_sensitive"?: boolean | null }`。该工具 SHALL 使用本地 ripgrep 执行搜索，但 SHALL NOT 通过 shell 拼接命令。

#### Scenario: 默认注册 grep 工具定义
- **WHEN** 系统创建默认 tool registry
- **THEN** registry SHALL 包含名为 `grep` 的 tool definition
- **THEN** 该 definition SHALL 要求 `pattern` 字段为 string
- **THEN** 该 definition SHALL 允许 `paths`、`glob`、`literal` 和 `case_sensitive` 字段为对应类型或 null

#### Scenario: 固定字符串搜索
- **WHEN** `grep` 收到有效 `pattern` 且 `literal` 为 true 或 null
- **THEN** handler SHALL 使用 ripgrep fixed-string 搜索语义
- **THEN** result SHALL 标记 `ok: true`
- **THEN** result 文本 SHALL 包含匹配文件路径、行号、列号和命中行文本

#### Scenario: 正则搜索
- **WHEN** `grep` 收到有效 `pattern` 且 `literal` 为 false
- **THEN** handler SHALL 使用 ripgrep regex 搜索语义
- **THEN** 如果 ripgrep 报告正则错误，handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含简洁错误原因

#### Scenario: 限定搜索路径和 glob
- **WHEN** `grep` 收到 `paths` 或 `glob`
- **THEN** handler SHALL 将搜索范围限制在这些路径或 glob 匹配的文件内
- **THEN** handler SHALL 按当前工作目录解析相对路径
- **THEN** handler SHALL 允许绝对路径和包含 `..` 的路径

#### Scenario: 无匹配不是工具失败
- **WHEN** ripgrep 完成搜索且没有找到匹配
- **THEN** handler SHALL 返回 `ok: true`
- **THEN** result 文本 SHALL 显示 `returned_matches: 0`
- **THEN** 系统 SHALL NOT 仅因无匹配追加本地 error transcript record

#### Scenario: 限制返回匹配数量
- **WHEN** 匹配数量超过内置 `DEFAULT_MAX_MATCHES`
- **THEN** handler SHALL 只返回前 `DEFAULT_MAX_MATCHES` 条匹配
- **THEN** result SHALL 标记 `truncated: true`
- **THEN** result 文本 SHALL 标记 `has_more: true` 并提示收窄搜索范围或 pattern

#### Scenario: 路径拒绝和输入错误
- **WHEN** `pattern` 为空、`paths` 不是 string array、`glob` 类型无效、路径包含 NUL 或路径指向 `.git` 内部
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含对应的简洁失败原因

#### Scenario: ripgrep 不可用或运行失败
- **WHEN** 本机找不到 `rg` 可执行文件或 ripgrep 以搜索错误退出
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含可回传模型的简洁错误说明
