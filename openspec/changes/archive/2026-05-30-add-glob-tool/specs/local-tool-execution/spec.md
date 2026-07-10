## ADDED Requirements

### Requirement: glob local file discovery tool
系统 SHALL 提供本地工具 `glob`，用于按 glob pattern 在本地文件系统中发现文件路径并返回结构化、受限的结果。该工具 SHALL 接收 JSON object 参数 `{ "pattern": string, "paths"?: string[] | null }`。该工具 SHALL 使用本地 ripgrep 的 file listing 能力执行发现，但 SHALL NOT 通过 shell 拼接命令。

#### Scenario: 默认注册 glob 工具定义
- **WHEN** 系统创建默认 tool registry
- **THEN** registry SHALL 包含名为 `glob` 的 tool definition
- **THEN** 该 definition SHALL 要求 `pattern` 字段为 string
- **THEN** 该 definition SHALL 允许 `paths` 字段为 string array 或 null

#### Scenario: 按 pattern 发现文件路径
- **WHEN** `glob` 收到有效 `pattern` 且 `paths` 为 null
- **THEN** handler SHALL 在当前工作目录下发现匹配该 pattern 的文件路径
- **THEN** result SHALL 标记 `ok: true`
- **THEN** result 文本 SHALL 包含 pattern、paths、returned_paths、has_more 和匹配文件路径列表

#### Scenario: 限定搜索根路径
- **WHEN** `glob` 收到有效 `paths`
- **THEN** handler SHALL 将文件发现范围限制在这些路径内
- **THEN** handler SHALL 按当前工作目录解析相对路径
- **THEN** handler SHALL 允许绝对路径和包含 `..` 的路径

#### Scenario: 发现 hidden 文件但不返回 git 内部路径
- **WHEN** glob pattern 匹配 hidden 文件路径
- **THEN** handler SHALL 能返回非 `.git` 内部的 hidden 文件路径
- **WHEN** glob pattern 或搜索根会触达 `.git` 内部路径
- **THEN** handler SHALL 拒绝该输入或过滤 `.git` 内部返回路径

#### Scenario: 无匹配不是工具失败
- **WHEN** 文件发现完成且没有找到匹配路径
- **THEN** handler SHALL 返回 `ok: true`
- **THEN** result 文本 SHALL 显示 `returned_paths: 0`
- **THEN** 系统 SHALL NOT 仅因无匹配追加本地 error transcript record

#### Scenario: 限制返回路径数量
- **WHEN** 匹配路径数量超过内置 `DEFAULT_MAX_PATHS`
- **THEN** handler SHALL 只返回前 `DEFAULT_MAX_PATHS` 条路径
- **THEN** result SHALL 标记 `truncated: true`
- **THEN** result 文本 SHALL 标记 `has_more: true` 并提示收窄 pattern 或 paths

#### Scenario: 路径拒绝和输入错误
- **WHEN** `pattern` 为空、`paths` 不是 string array、pattern 或路径包含 NUL，或路径指向 `.git` 内部
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含对应的简洁失败原因

#### Scenario: ripgrep 不可用或运行失败
- **WHEN** 本机找不到 `rg` 可执行文件或 ripgrep 以文件发现错误退出
- **THEN** handler SHALL 返回 `ok: false`
- **THEN** result 文本 SHALL 包含可回传模型的简洁错误说明
