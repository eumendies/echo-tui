## ADDED Requirements

### Requirement: apply_patch display metadata
`apply_patch` handler SHALL produce display-only metadata for successfully parsed patch input so the TUI can render the actual edit content without reparsing patch text or reading target files. This metadata SHALL preserve provider-facing result text and patch execution semantics unchanged.

#### Scenario: 记录 update hunk 的上下文和增删行
- **WHEN** `apply_patch` parses a valid update hunk from unified diff or `*** Begin Patch` format
- **THEN** handler SHALL record each context line as display line kind `context`
- **THEN** handler SHALL record each removed line as display line kind `removed`
- **THEN** handler SHALL record each added line as display line kind `added`
- **THEN** handler SHALL preserve the input hunk order of these display lines

#### Scenario: 记录新增文件内容为新增行
- **WHEN** `apply_patch` parses a valid added file patch
- **THEN** handler SHALL record each file content line as display line kind `added`
- **THEN** handler SHALL NOT record patch syntax lines such as `*** Add File`, `---`, `+++` or hunk headers as display lines

#### Scenario: display metadata 不改变执行语义
- **WHEN** `apply_patch` applies a patch successfully
- **THEN** result SHALL keep the existing provider-facing success text with changed files summary
- **THEN** result SHALL include display-only metadata for TUI rendering
- **THEN** handler SHALL continue using `oldLines` and `newLines` for exact hunk matching and file writes

#### Scenario: 应用失败但解析成功时保留尝试编辑内容
- **WHEN** `apply_patch` parses patch input successfully but later rejects it during validation, matching, or writing
- **THEN** result SHALL keep `ok: false` and the existing concise failure reason in provider-facing text
- **THEN** result SHOULD include display-only metadata for the parsed edit content when available
- **THEN** handler SHALL NOT write partial file changes

#### Scenario: 解析失败时安全降级
- **WHEN** `apply_patch` cannot parse patch input into supported operations
- **THEN** result SHALL keep `ok: false` and the existing concise parse failure reason
- **THEN** result SHALL NOT require display metadata
