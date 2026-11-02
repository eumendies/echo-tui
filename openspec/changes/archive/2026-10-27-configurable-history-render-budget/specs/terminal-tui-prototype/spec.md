## MODIFIED Requirements

### Requirement: destructive resize recovery
系统 SHALL 在终端列宽变化或终端行数压缩时允许 destructive recovery：清可见屏幕、清 scrollback、回到左上角，并从当前状态完整重绘 app snapshot。主会话 snapshot 的稳定历史部分 SHALL 遵循历史重绘预算；“完整快照”不要求展开全部活跃历史，但 SHALL 包含所选历史、必要的瞬时提示和完整的当前实时/footer 状态。当 streaming 进行中触发 recovery 时，完整快照 SHALL 按当前 width/theme 重投影尚未成为 transcript record 的 选定 replay boundary 之前的 in-flight source 与其后的 pending 尾部，不得复用旧宽度下的 rendered line count。

#### Scenario: 列宽变化时触发 destructive recovery
- **WHEN** 最新 terminal columns 不等于上一次 render 时记录的 columns
- **THEN** 应用 SHALL 进入 destructive recovery，而不是继续依赖旧输出物理行数估算来局部擦除

#### Scenario: 行数压缩时触发 destructive recovery
- **WHEN** 最新 terminal rows 小于上一次 render 时记录的 rows
- **THEN** 应用 SHALL 进入 destructive recovery，而不是继续依赖 footer 局部擦除

#### Scenario: 仅行数增大时不触发 destructive recovery
- **WHEN** terminal columns 未变化
- **AND** 最新 terminal rows 大于上一次 render 时记录的 rows
- **THEN** 应用 SHALL NOT 仅因为 rows 增大而执行 destructive recovery
- **THEN** 应用 SHALL 记录新的 terminal rows 供后续 resize 判断使用

#### Scenario: destructive recovery 清 screen 与 scrollback
- **WHEN** terminal columns 发生变化或 terminal rows 变小并触发 destructive recovery
- **THEN** 应用 SHALL 重置滚动区域与文本样式，清可见屏幕，清 scrollback，并把光标移动到左上角后再开始重绘

#### Scenario: destructive recovery 重绘完整快照
- **WHEN** terminal columns 发生变化或 terminal rows 变小并触发 destructive recovery
- **THEN** 新的可见屏幕 SHALL 包含 banner、按当前 owner 规则选定的 transcript projection（主会话应用历史预算）、按当前宽度重投影至选定 boundary 的 in-flight source、从该 boundary 开始的 pending preview、transcript/composer spacer、composer 和 status line 的完整当前快照

#### Scenario: destructive recovery 后光标回到 composer 逻辑位置
- **WHEN** 用户在输入、thinking 或 streaming 期间触发 terminal columns 变化
- **THEN** destructive recovery 完成后可见光标 SHALL 回到 composer 当前逻辑光标位置

### Requirement: resume 确认恢复 session
系统 SHALL 在 `/resume` command session 中支持 Enter 恢复当前选中的 session。恢复 SHALL 替换当前 transcript records 并完整重绘当前 app snapshot，使屏幕只显示恢复出来的 session 投影。主会话稳定历史 SHALL 按当前历史预算选择完整块后缀；该显示选择 SHALL NOT 减少按 compaction 规则恢复的活跃 records。

#### Scenario: Enter 恢复选中 session
- **WHEN** `/resume` command session 处于活跃状态，且用户按下 Enter
- **THEN** 系统 SHALL 关闭 `/resume` command session
- **THEN** 系统 SHALL 清空 composer 并恢复普通输入界面
- **THEN** 系统 SHALL 从持久化存储加载选中 session 的 transcript records
- **THEN** 系统 SHALL 用加载出的 records 替换当前 transcript records
- **THEN** 系统 SHALL 重绘当前 app snapshot，使屏幕显示恢复出来的 session 的预算内历史及必要瞬时提示

#### Scenario: 恢复后不追加提示 transcript
- **WHEN** `/resume` 成功恢复某个 session
- **THEN** 系统 SHALL NOT 追加新的 user transcript record 或 assistant transcript record 作为恢复结果提示
- **THEN** 用户可见反馈 SHALL 是恢复出来的历史投影显示在屏幕上；预算提示 SHALL 为瞬时显示且不追加任何 transcript record

#### Scenario: Esc 取消 resume
- **WHEN** `/resume` command session 处于活跃状态，且用户按下 Esc
- **THEN** 系统 SHALL 关闭 `/resume` command session
- **THEN** 系统 SHALL 清空 composer 并恢复普通输入界面
- **THEN** 系统 SHALL NOT 替换当前 transcript records
- **THEN** 系统 SHALL NOT 追加 transcript record

### Requirement: 压缩会话仅重绘活跃 transcript
系统 SHALL 在已压缩主会话的破坏性重绘中展示压缩历史提示及按历史预算选择的当前活跃 transcript 后缀，而不重新加载或重放被摘要覆盖的原始前缀。提示 SHALL 表达较早历史已压缩、完整记录保存在会话文件中，SHALL 避免同一提示重复展示，且 SHALL NOT 因重绘额外追加 transcript record。当前 banner、in-flight 内容、footer 和光标恢复规则 SHALL 保持不变。本要求 SHALL 同样适用于恢复 session、主题切换及退出 BTW/子 Agent 视图后重建主会话快照。

#### Scenario: 压缩成功不主动清除 scrollback
- **WHEN** compaction 成功且当前没有其他破坏性重绘触发条件
- **THEN** 系统 SHALL NOT 仅为了释放内存清空 screen 或 scrollback
- **THEN** 已输出的旧消息 SHALL 留在终端现有历史中，新记录继续增量追加

#### Scenario: Resize 后只重绘提示与活跃记录
- **WHEN** 已压缩主会话因终端尺寸变化执行破坏性重绘
- **THEN** transcript projection SHALL 包含当前压缩历史提示及压缩边界之后、历史预算所选范围内的可见记录
- **THEN** 系统 SHALL NOT 为该次重绘读取 journal 中已压缩的原文
- **THEN** pending、composer、status line 和光标 SHALL 遵循现有恢复规则

#### Scenario: 恢复和主题切换沿用活跃投影
- **WHEN** 系统恢复已压缩 session 或为该 session 切换主题并重绘
- **THEN** 主会话 SHALL 只按当前主题投影压缩历史提示与按历史预算选中的活跃记录
- **THEN** 该展示提示 SHALL NOT 产生新的持久化 transcript record

#### Scenario: 退出历史视图不重新装入旧前缀
- **WHEN** 用户退出 BTW 或历史子 Agent 回看视图并返回已压缩主会话
- **THEN** 主会话快照 SHALL 恢复压缩历史提示与按历史预算选中的活跃记录
- **THEN** 主 renderer SHALL NOT 为重建旧 run 身份而长期持有已释放 transcript 原始对象

#### Scenario: 无压缩会话保持原有重绘
- **WHEN** 主会话没有 compaction 状态并执行重绘
- **THEN** 系统 SHALL 从全部当前有效 transcript 中按历史预算选择完整块后缀；不限时投影全部可见内容
- **THEN** 系统 SHALL NOT 显示压缩历史提示
- **THEN** 若有限预算省略了可见历史，系统 SHALL 仅显示预算省略提示，不将其描述为压缩历史

### Requirement: transcript error role
系统 SHALL 支持 `error` transcript role 表示本地错误反馈。`error` record SHALL 作为 transcript 的可见、可持久化记录参与 session 恢复，但 SHALL NOT 被视为 assistant 回复发送给 agent。 主会话破坏性重绘中的可见投影 SHALL 遵循历史预算；预算外记录 SHALL 保持原始事实，但不要求在本次快照展开。普通增量显示和独立视图 SHALL 保持原有语义。

#### Scenario: agent 失败追加 error record
- **WHEN** agent 在 thinking 或 streaming 期间失败
- **THEN** 系统 SHALL 清空 pending preview 并释放 response lock
- **THEN** 系统 SHALL 追加一条 `role: 'error'` 的 transcript record 作为可见反馈
- **THEN** 该 record 文本 SHALL 不包含敏感配置值

#### Scenario: error record 可恢复可显示
- **WHEN** 包含 `error` record 的 session 被持久化并通过 `/resume` 恢复
- **THEN** 系统 SHALL 恢复该 `error` record
- **THEN** 该 `error` record 位于当前历史所选范围内时，transcript 渲染 SHALL 为其提供可见投影

### Requirement: transcript local interruption notice role
系统 SHALL 支持本地中断提示 transcript role 表示用户主动中断 assistant response 的本地反馈。该 record SHALL 作为 transcript 的可见、可持久化记录参与 session 恢复，但 SHALL NOT 被视为 assistant 回复或 error 反馈发送给 agent。 主会话破坏性重绘中的可见投影 SHALL 遵循历史预算；预算外记录 SHALL 保持原始事实，但不要求在本次快照展开。普通增量显示和独立视图 SHALL 保持原有语义。

#### Scenario: interruption notice record 可恢复可显示
- **WHEN** 包含本地中断提示 record 的 session 被持久化并通过 `/resume` 恢复
- **THEN** 系统 SHALL 恢复该本地中断提示 record
- **THEN** 该 record 位于当前历史所选范围内时，transcript 渲染 SHALL 为其提供区别于 user、assistant 和 error 的克制可见投影

#### Scenario: resize 后重新投影中断提示
- **WHEN** 当前历史所选范围包含本地中断提示 record，且 terminal columns 变化触发 app snapshot 重绘
- **THEN** 中断提示 SHALL 按新的 terminal width 重新计算可见投影
- **THEN** 重绘 SHALL NOT 删除该提示的原始记录，且 SHALL NOT 隐藏所选范围内的该提示

### Requirement: tool transcript message rendering
系统 SHALL 支持 `tool_call` 与 `tool_result` transcript record 的 TUI 可见投影。工具消息 SHALL 作为 transcript content records 参与当前 app snapshot 重绘、destructive resize recovery 和 session 恢复后的显示。系统 SHALL 根据 tool metadata 生成工具专属展示：tool call SHALL 使用 assistant 风格调用行，tool result SHALL 使用区别于 assistant 的弱化结果行。未知工具或缺少 metadata 的历史记录 SHALL 使用安全 fallback 渲染。 主会话破坏性重绘中的可见投影 SHALL 遵循历史预算；预算外记录 SHALL 保持原始事实，但不要求在本次快照展开。普通增量显示和独立视图 SHALL 保持原有语义。

#### Scenario: 显示 bash tool_call record
- **WHEN** transcript records 包含 `role: 'tool_call'` 且 `toolName` 为 `run_bash_command` 的记录
- **THEN** transcript 渲染 SHALL 为该记录生成可见消息块
- **THEN** 该消息块 SHALL 使用 assistant 调用前缀并显示 `Bash('...')` 形式的命令调用
- **THEN** 该消息块 SHALL NOT 显示原始 JSON arguments

#### Scenario: 显示 bash tool_result record
- **WHEN** transcript records 包含 `role: 'tool_result'` 且 `toolName` 为 `run_bash_command` 的记录
- **THEN** transcript 渲染 SHALL 为该记录生成可见消息块
- **THEN** 该消息块 SHALL 使用灰色弱化样式和 `⎿` 前缀显示命令输出或简洁状态
- **THEN** 该消息块 SHALL NOT 显示 `exit_code`、`duration_ms`、`timed_out` 或 `truncated` 等执行摘要行

#### Scenario: bash tool_result 无输出
- **WHEN** bash tool result 没有可显示的 stdout 或 stderr 内容
- **THEN** transcript 渲染 SHALL 显示简洁的无输出状态
- **THEN** 渲染 SHALL NOT 产生空白工具结果块

#### Scenario: tool_result 显示层截断
- **WHEN** tool result 的可见投影超过显示层上限
- **THEN** transcript 渲染 SHALL 截断可见输出并显示截断提示
- **THEN** 截断 SHALL 只影响 TUI 展示，不改变 transcript record 的事实内容

#### Scenario: 完整消息块之间保留空行
- **WHEN** transcript records 中存在相邻的两个完整可见消息块，例如连续 assistant 记录或 tool result 后的 assistant 记录
- **THEN** transcript 渲染 SHALL 在两个完整消息块的投影之间保留一个空行
- **THEN** 同一工具调用组内的 tool call 与紧随其后的 tool result SHALL NOT 被额外空行分隔
- **THEN** 该空行 SHALL 只影响 TUI 展示，不改变 transcript record 的事实内容

#### Scenario: resize 后重新投影工具消息
- **WHEN** 当前历史所选范围包含 `tool_call` 或 `tool_result` 记录，且 terminal columns 变化触发 app snapshot 重绘
- **THEN** 工具消息 SHALL 按新的 terminal width 重新计算可见投影
- **THEN** 重绘 SHALL NOT 删除原始工具记录，且 SHALL NOT 隐藏所选范围内的这些工具消息

#### Scenario: 恢复 session 后显示工具消息
- **WHEN** 包含 `tool_call` 或 `tool_result` 记录的 session 被持久化并通过 `/resume` 恢复
- **THEN** 系统 SHALL 恢复这些 transcript records
- **THEN** transcript 渲染 SHALL 为当前历史所选范围内的这些工具消息提供可见投影

#### Scenario: 未知工具使用通用 fallback
- **WHEN** TUI 渲染未知 `toolName` 或缺少 tool metadata 的 `tool_call` / `tool_result` 记录
- **THEN** 系统 SHALL 使用通用工具消息 fallback 渲染该记录
- **THEN** 系统 SHALL NOT 因未知工具展示方式中断 app snapshot 渲染

#### Scenario: 工具消息不代表工具执行能力
- **WHEN** TUI 渲染 `tool_call` 或 `tool_result` 记录
- **THEN** 系统 SHALL NOT 因此要求已实现新的真实工具调用、工具执行或 tool result 回传模型

### Requirement: reasoning summary transcript role
系统 SHALL 支持 `reasoning_summary` transcript role 表示模型返回的 reasoning summary。该 record SHALL 作为可见、可持久化的 append-only transcript content record 参与 session 恢复和当前 app snapshot 重绘，但 SHALL NOT 被视为 assistant final answer、用户消息、本地错误或工具结果。 主会话破坏性重绘中的可见投影 SHALL 遵循历史预算；预算外记录 SHALL 保持原始事实，但不要求在本次快照展开。普通增量显示和独立视图 SHALL 保持原有语义。

#### Scenario: 追加 reasoning summary record
- **WHEN** agent loop 收到非空 reasoning summary 并通知 app 层追加记录
- **THEN** 应用 SHALL 追加一条 `role: 'reasoning_summary'` 的 transcript record
- **THEN** 该 record 文本 SHALL 保存 reasoning summary 原文
- **THEN** 应用 SHALL NOT 把该文本合并进 assistant record

#### Scenario: 工具循环中 summary 位于工具记录之前
- **WHEN** 同一 provider turn 同时产生 reasoning summary 和 tool call
- **THEN** 可见 transcript SHALL 先追加 `reasoning_summary` record
- **THEN** 工具执行完成后 SHALL 再追加对应 `tool_call` 与 `tool_result` records

#### Scenario: 最终回复中 summary 位于 assistant 之前
- **WHEN** 同一 provider turn 产生 reasoning summary 且随后完成最终 assistant 回复
- **THEN** 可见 transcript SHALL 先追加 `reasoning_summary` record
- **THEN** 随后追加最终 `assistant` record

#### Scenario: summary record 被持久化和恢复
- **WHEN** 包含 `reasoning_summary` record 的 session 被保存并通过 `/resume` 恢复
- **THEN** 系统 SHALL 恢复该 record
- **THEN** 启用 reasoning 显示且该 record 位于当前历史所选范围内时，transcript 渲染 SHALL 为其提供可见投影

### Requirement: reasoning summary 可见渲染
系统 SHALL 为 `reasoning_summary` transcript record 提供区别于 user、assistant、error 和 tool result 的低强调可见投影。该投影 SHALL 根据当前 terminal width 和当前 render theme 重新计算，且 SHALL NOT 改变 transcript record 的原始文本。 主会话破坏性重绘中的可见投影 SHALL 遵循历史预算；预算外记录 SHALL 保持原始事实，但不要求在本次快照展开。普通增量显示和独立视图 SHALL 保持原有语义。

#### Scenario: 渲染 reasoning summary
- **WHEN** 当前历史所选范围包含 `reasoning_summary` record 且已启用 reasoning 显示
- **THEN** renderer SHALL 生成低强调的 reasoning summary 消息块
- **THEN** 该消息块 SHALL 使用区别于 assistant final answer 的前缀或 theme 样式
- **THEN** 渲染 SHALL NOT 把该 record 当作 Markdown assistant final message 处理

#### Scenario: resize 后重新投影 reasoning summary
- **WHEN** 当前历史所选范围包含 `reasoning_summary` record 且已启用 reasoning 显示，且 terminal columns 变化触发 app snapshot 重绘
- **THEN** reasoning summary SHALL 按新的 terminal width 重新计算可见投影
- **THEN** 重绘 SHALL 使用当前进程 render theme
- **THEN** 重绘 SHALL NOT 删除或改写原始 summary record，且 SHALL NOT 隐藏所选范围内已启用显示的 summary
