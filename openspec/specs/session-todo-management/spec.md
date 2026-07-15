# session-todo-management Specification

## Purpose
TBD - created by archiving change support-todo-tools. Update Purpose after archive.
## Requirements
### Requirement: 会话级 todo 状态持久化
系统 SHALL 为每个 transcript session 维护结构化 `todoState`。`todoState` SHALL 通过 session JSONL journal 中独立的 `set_todo_state` 操作保存和加载，不得作为普通 transcript record 保存，也不得参与 context compaction 边界计算。

#### Scenario: 保存包含 todoState 的 session
- **WHEN** 当前 session 存在未完成 todo
- **AND** app 持久化当前 todoState
- **THEN** session JSONL journal SHALL 追加独立的 `set_todo_state` 操作
- **AND** 该操作 SHALL 包含当前 todo items 和更新时间
- **AND** 该操作 SHALL NOT 因 todoState 更新而包含 compaction 或 change history 的副本

#### Scenario: 恢复 session todoState
- **WHEN** 用户通过 `/resume` 加载包含 `set_todo_state` 操作的 session journal
- **THEN** app SHALL 恢复该 session 的最后一个有效 todo 状态
- **AND** 下一次 provider 请求 SHALL 能看到恢复后的未完成 todo

#### Scenario: journal 没有 todo 状态操作
- **WHEN** app 加载有效 session journal 且其中不存在 `set_todo_state` 操作
- **THEN** app SHALL 使用空 todo 状态
- **AND** 加载 SHALL NOT 失败

#### Scenario: 清空 transcript 同步清空 todoState
- **WHEN** 用户执行清空当前会话的操作
- **THEN** app SHALL 清空当前 transcript records
- **AND** app SHALL 清空当前 `todoState`

### Requirement: 创建 todo list 工具
系统 SHALL 提供 provider-visible `create_todos` 工具，用于创建当前会话的 todo list。调用该工具 SHALL 用新列表覆盖旧 `todoState.items`，旧的已完成或未完成 todo 不再作为当前运行时 todo 状态保留。tool result SHALL 只返回本次创建动作的紧凑确认信息；当前完整 todo 状态 SHALL 通过 transient todo suffix 提供给后续 provider 请求。

#### Scenario: 创建新的 todo list
- **WHEN** 模型调用 `create_todos` 并提供非空 todo 文本列表
- **THEN** runtime SHALL 为每个 todo 生成稳定 id
- **AND** runtime SHALL 将这些 todo 保存为当前 `todoState.items`
- **AND** 每个新 todo 的状态 SHALL 为 `open`
- **AND** tool result SHALL 返回创建后的 todo ids
- **AND** tool result SHALL NOT 返回完整 todo items 或当前未完成 todo 列表

#### Scenario: 新列表覆盖旧列表
- **WHEN** 当前 `todoState` 已存在 todo items
- **AND** 模型再次调用 `create_todos` 创建新列表
- **THEN** runtime SHALL 用新列表替换旧 `todoState.items`
- **AND** 后续 todo suffix SHALL 只包含新列表中的未完成 todo

#### Scenario: 创建空 todo list
- **WHEN** 模型调用 `create_todos` 并提供空列表
- **THEN** runtime SHALL 清空当前 `todoState.items`
- **AND** 后续 provider 请求 SHALL NOT 注入 todo suffix
- **AND** tool result SHALL 返回已清空 todo list 的紧凑确认

#### Scenario: create_todos 不修改工作区
- **WHEN** 模型调用 `create_todos`
- **THEN** runtime SHALL NOT 修改项目文件或系统状态
- **AND** runtime SHALL NOT 请求文件修改审批

### Requirement: 完成 todo 工具
系统 SHALL 提供 provider-visible `complete_todo` 工具，用于将当前 `todoState` 中的一个或多个 todo 标记为 completed。该工具 SHALL 只修改会话级 todo 状态，不得修改工作区文件。tool result SHALL 只返回本次完成动作的紧凑确认信息；当前完整 todo 状态 SHALL 通过 transient todo suffix 提供给后续 provider 请求。

#### Scenario: 完成指定 todo
- **WHEN** 当前 `todoState` 包含 open todo
- **AND** 模型调用 `complete_todo` 并提供匹配的 todo id
- **THEN** runtime SHALL 将该 todo 标记为 `completed`
- **AND** runtime SHALL 更新 `todoState`
- **AND** tool result SHALL 返回已完成 id
- **AND** tool result SHALL NOT 返回完整 todo items 或剩余未完成 todo 列表

#### Scenario: 批量完成 todo
- **WHEN** 模型调用 `complete_todo` 并提供多个匹配 todo id
- **THEN** runtime SHALL 将所有匹配 todo 标记为 `completed`
- **AND** tool result SHALL 返回所有已完成 id

#### Scenario: 完成未知 todo id
- **WHEN** 模型调用 `complete_todo` 并提供不存在的 todo id
- **THEN** runtime SHALL 保持现有 `todoState` 不变
- **AND** tool result SHALL 标明该 id 未找到
- **AND** agent loop SHALL 继续正常运行

#### Scenario: 全部 todo 完成后停止注入
- **WHEN** 当前 `todoState` 中所有 todo 均为 `completed`
- **THEN** 后续 provider 请求 SHALL NOT 注入 todo suffix

### Requirement: 未完成 todo transient suffix
系统 SHALL 在构造 provider records 时，将当前未完成 todo 作为 transient user suffix 注入。该 suffix SHALL NOT 写入 transcript records，SHALL NOT 写入 session `records`，并 SHALL NOT 改变 system prompt 文本。

#### Scenario: 有未完成 todo 时注入 suffix
- **WHEN** 当前 `todoState` 包含一个或多个 `open` todo
- **AND** agent loop 构造 provider records
- **THEN** provider records SHALL 在 active transcript records 之后包含 todo suffix
- **AND** todo suffix SHALL 包含每个未完成 todo 的 id 和文本

#### Scenario: 无未完成 todo 时不注入 suffix
- **WHEN** 当前 `todoState` 不存在 `open` todo
- **AND** agent loop 构造 provider records
- **THEN** provider records SHALL NOT 包含 todo suffix

#### Scenario: todo suffix 不持久化
- **WHEN** provider request 完成
- **THEN** 本地 transcript SHALL NOT 追加 todo suffix record
- **AND** session persistence SHALL NOT 将 todo suffix 保存到 `records`

#### Scenario: system prompt 保持稳定
- **WHEN** 仅 `todoState` 内容发生变化
- **AND** cwd、AGENTS.md、skill catalog、MCP 状态和 interaction mode 均未变化
- **THEN** provider system prompt 文本 SHALL 保持不变
- **AND** provider-visible tools schema SHALL 保持不变

### Requirement: todo 工具历史按普通 transcript 处理
系统 SHALL 将 todo tool call 和 tool result 作为普通 tool transcript records 记录。context compaction SHALL 可按现有工具配对规则压缩这些 records，但不得因此丢失当前未完成 todo 状态。

#### Scenario: todo tool records 进入 transcript
- **WHEN** 模型调用 `create_todos` 或 `complete_todo`
- **THEN** app SHALL 追加对应 tool_call record
- **AND** app SHALL 追加对应 tool_result record

#### Scenario: compaction 后未完成 todo 仍可见
- **WHEN** todo tool call/result 所在历史区间被 context compaction 压缩
- **AND** 当前 `todoState` 仍包含 open todo
- **THEN** 后续 provider 请求 SHALL 继续通过 todo suffix 注入未完成 todo

#### Scenario: tool result 不作为权威状态源
- **WHEN** todo tool result 已被压缩或不在 active transcript records 中
- **THEN** agent loop SHALL 使用 `todoState` 构造 todo suffix
- **AND** agent loop SHALL NOT 从历史 tool result 反推当前 todo 状态

### Requirement: todo tool message renderer
系统 SHALL 为 `create_todos` 和 `complete_todo` 提供专属 tool message renderer。该 renderer SHALL 能显示工具调用后的当前状态；当 tool result 使用紧凑 JSON 时，renderer SHALL 结合 transcript record、当前 todo state 或可用兼容信息渲染状态，并 SHALL 兼容旧 transcript 中包含完整 todo 状态的 JSON。

#### Scenario: 渲染 create_todos 紧凑结果
- **WHEN** transcript 包含 `create_todos` 的 tool_result
- **AND** tool_result 文本包含紧凑创建结果 JSON
- **THEN** renderer SHALL 显示创建成功和创建出的 todo ids
- **AND** renderer SHALL NOT 要求 tool_result 文本包含完整 todo items 才能渲染

#### Scenario: 渲染 complete_todo 紧凑结果
- **WHEN** transcript 包含 `complete_todo` 的 tool_result
- **AND** tool_result 文本包含紧凑完成结果 JSON
- **THEN** renderer SHALL 显示已完成 ids
- **AND** renderer SHALL 显示未找到 ids（如果存在）
- **AND** renderer SHALL NOT 要求 tool_result 文本包含剩余 open todo 列表才可渲染

#### Scenario: 兼容旧格式 todo result
- **WHEN** transcript 包含旧格式 todo tool_result，且文本包含完整 `items` 或 `openTodos`
- **THEN** renderer SHALL 继续按旧格式显示 todo 列表
- **AND** app SHALL NOT 因旧格式字段存在而渲染失败

#### Scenario: 结构化结果不可解析时降级
- **WHEN** todo tool result 文本不是可解析的 todo 状态 JSON
- **THEN** renderer SHALL 使用通用 tool result 渲染
- **AND** app SHALL NOT 因渲染失败中断 transcript 展示

### Requirement: plan mode 支持 todo 状态工具
系统 SHALL 允许 plan mode 下执行 todo 状态工具，因为 todo 工具只修改会话级 assistant 计划状态，不修改文件、依赖、Git 状态或外部系统。

#### Scenario: plan mode 创建 todo
- **WHEN** 当前 interaction mode 为 `plan`
- **AND** 模型调用 `create_todos`
- **THEN** runtime SHALL 执行该 todo 状态更新
- **AND** runtime SHALL NOT 因 plan mode 拒绝该工具调用

#### Scenario: plan mode 完成 todo
- **WHEN** 当前 interaction mode 为 `plan`
- **AND** 模型调用 `complete_todo`
- **THEN** runtime SHALL 执行该 todo 状态更新
- **AND** runtime SHALL NOT 修改工作区文件

