## MODIFIED Requirements

### Requirement: apply_patch tool result diff-style rendering
系统 SHALL 为相邻的 `apply_patch` tool call/result transcript records 提供按文件和 hunk 组织的专属 TUI 渲染。该渲染 SHALL 使用 tool result 中持久化的 display-only metadata 展示实际编辑内容、位置和上下文，SHALL NOT 改变 transcript 事实内容或 provider continuation input。

#### Scenario: 简化 apply_patch 调用行
- **WHEN** TUI renders an `apply_patch` tool call paired with its matching tool result
- **THEN** call line SHALL NOT display the raw JSON patch arguments
- **THEN** call line SHALL display a concise `ApplyPatch` label
- **THEN** call line MAY include a single file path or changed file count derived from display metadata
- **THEN** call prefix symbol SHALL continue to use success or failure styling based on adjacent result `ok`

#### Scenario: 按文件和 hunk 展示编辑内容
- **WHEN** TUI renders an `apply_patch` result with valid display metadata
- **THEN** result area SHALL preserve file and hunk boundaries instead of flattening all edit lines
- **THEN** each file SHALL display its path and added/removed logical line counts
- **THEN** result area SHALL display context, removed, added and omitted-context rows from display metadata
- **THEN** result area SHALL NOT display patch syntax headers such as `diff --git`, `---`, `+++`, `@@`, `*** Begin Patch`, `*** Update File`, `*** Add File` or `*** End Patch`
- **THEN** result area SHALL NOT display the raw `Applied patch` changed files summary when valid display metadata is available and result succeeded

#### Scenario: 使用单列定位 gutter
- **WHEN** TUI renders display lines with actual post-image location metadata
- **THEN** context rows SHALL display their real 1-based post-image file line number in one right-aligned gutter
- **THEN** added rows SHALL display `+` in that same gutter instead of displaying their numeric line number
- **THEN** removed rows SHALL display `-` in that same gutter
- **THEN** an added row SHALL still consume one post-image line number so the next context row reflects that addition
- **THEN** a removed row SHALL NOT consume a post-image line number
- **THEN** wrapped continuation rows SHALL leave the gutter blank and SHALL NOT consume another logical line number

#### Scenario: unresolved 行不显示伪造行号
- **WHEN** TUI renders apply-patch display lines whose `postLine` is null
- **THEN** context rows SHALL leave the numeric gutter blank
- **THEN** added and removed rows SHALL still display `+` and `-`
- **THEN** renderer SHALL NOT derive visible line numbers from the original patch header or current target file

#### Scenario: 增删背景覆盖完整内容行
- **WHEN** TUI renders an added or removed logical row
- **THEN** added rows SHALL use a green background
- **THEN** removed rows SHALL use a red background
- **THEN** the background SHALL start at the location gutter and include its separator, content and right-side padding through the terminal safe render width
- **THEN** the outer tool prefix indentation SHALL remain outside the red or green background
- **THEN** every wrapped physical continuation row SHALL preserve the source logical row background through the terminal safe render width
- **THEN** context and omitted rows SHALL remain neutral without red or green background

#### Scenario: 折叠较长的未修改上下文
- **WHEN** display metadata contains complete file lines with an unchanged interval beyond the configured context window
- **THEN** renderer SHALL preserve up to 3 unchanged lines before and after the edit window
- **THEN** renderer SHALL replace the hidden middle interval with a neutral omitted marker
- **THEN** the omitted marker SHALL report the number of hidden logical lines
- **THEN** the next visible context row SHALL retain its actual post-image line number
- **THEN** renderer SHALL merge adjacent omitted intervals
- **THEN** renderer SHALL NOT output consecutive unchanged-lines markers

#### Scenario: 多文件和多修改区块使用结构化软预算
- **WHEN** the folded apply-patch projection still exceeds the apply-patch display budget
- **THEN** truncation SHALL affect only the visible projection
- **THEN** renderer SHALL preserve every file heading
- **THEN** renderer SHALL preserve at least one actual added or removed row from every modification group
- **THEN** renderer SHALL prefer omitting unchanged context before omitting changed rows
- **THEN** any omitted changed rows SHALL use a marker that reports the hidden logical line count
- **THEN** renderer SHALL NOT discard later files or modification groups solely because earlier content consumed the budget
- **THEN** when failure rows, file headings and one changed row per modification group exceed the budget, renderer SHALL allow the visible projection to exceed the budget
- **THEN** the apply-patch display budget SHALL remain larger than the generic tool result display budget

#### Scenario: 失败结果保留失败原因和尝试编辑内容
- **WHEN** TUI renders an `apply_patch` result whose `ok` is false and display metadata is available
- **THEN** result area SHALL include the concise failure reason from the provider-facing result text
- **THEN** result area SHALL also display the available parsed or simulated edit structure
- **THEN** result area SHALL still use red and green background styling for removed and added rows

#### Scenario: 本次结果缺少 metadata 时安全处理
- **WHEN** TUI renders an `apply_patch` tool result that has no display metadata because patch parsing failed
- **THEN** renderer SHALL use the generic tool result rendering
- **THEN** renderer SHALL NOT throw or interrupt transcript rendering

#### Scenario: 历史恢复使用持久化 metadata
- **WHEN** a transcript session containing `apply_patch` display metadata is loaded through resume
- **THEN** TUI SHALL render the stored file grouping, locations, context and omission information
- **THEN** TUI SHALL NOT read current target files or recompute hunk matches
