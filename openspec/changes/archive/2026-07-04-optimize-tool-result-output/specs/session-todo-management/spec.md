## MODIFIED Requirements

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
