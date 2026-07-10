## ADDED Requirements

### Requirement: apply_patch tool result diff-style rendering
系统 SHALL 为相邻的 `apply_patch` tool call/result transcript records 提供专属 TUI 渲染。该渲染 SHALL 使用 tool result 中的 display-only metadata 展示实际编辑内容，SHALL NOT 改变 transcript 事实内容或 provider continuation input。

#### Scenario: 简化 apply_patch 调用行
- **WHEN** TUI renders an `apply_patch` tool call paired with its matching tool result
- **THEN** call line SHALL NOT display the raw JSON patch arguments
- **THEN** call line SHALL display a concise `ApplyPatch` label
- **THEN** call line MAY include a single file path or changed file count derived from display metadata
- **THEN** call prefix symbol SHALL continue to use success or failure styling based on adjacent result `ok`

#### Scenario: 结果区域只显示编辑内容
- **WHEN** TUI renders an `apply_patch` result with valid display metadata
- **THEN** result area SHALL display context, removed, and added lines from display metadata
- **THEN** result area SHALL NOT display patch syntax headers such as `diff --git`, `---`, `+++`, `@@`, `*** Begin Patch`, `*** Update File`, `*** Add File` or `*** End Patch`
- **THEN** result area SHALL NOT display the raw `Applied patch` changed files summary when valid display metadata is available and result succeeded

#### Scenario: 使用背景色标识新增和删除
- **WHEN** TUI renders `apply_patch` display lines
- **THEN** removed lines SHALL be styled with red background
- **THEN** added lines SHALL be styled with green background
- **THEN** context lines SHALL remain neutral or gray without red or green background
- **THEN** background styling SHOULD apply to the editable content portion rather than the tool prefix indentation

#### Scenario: 失败结果保留失败原因和尝试编辑内容
- **WHEN** TUI renders an `apply_patch` result whose `ok` is false and display metadata is available
- **THEN** result area SHALL include the concise failure reason from the provider-facing result text
- **THEN** result area SHALL also display the parsed context, removed, and added lines
- **THEN** result area SHALL still use red and green background styling for removed and added lines

#### Scenario: apply_patch 使用更大的显示截断预算
- **WHEN** `apply_patch` display metadata contains more lines than the apply_patch display budget
- **THEN** TUI SHALL truncate only the visible projection
- **THEN** TUI SHALL preserve the full transcript record and provider-facing tool result text
- **THEN** TUI SHALL use an apply_patch-specific truncation marker
- **THEN** the apply_patch display budget SHALL be larger than the generic tool result display budget

#### Scenario: 缺少或无效 metadata 时安全降级
- **WHEN** TUI renders an `apply_patch` tool result without valid display metadata
- **THEN** renderer SHALL fall back to the existing generic tool rendering
- **THEN** renderer SHALL NOT throw or interrupt transcript rendering

#### Scenario: 历史恢复使用持久化 metadata
- **WHEN** a transcript session containing `apply_patch` display metadata is loaded through resume
- **THEN** TUI SHALL render the stored display metadata without reading current target files
- **THEN** TUI SHALL NOT recompute hunk matches from the current file system state
