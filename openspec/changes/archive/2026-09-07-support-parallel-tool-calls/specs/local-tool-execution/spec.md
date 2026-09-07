## ADDED Requirements

### Requirement: 工具调用并发分类
系统 SHALL 在风险审批分类之外为每个 provider tool call 计算独立的执行并发类别。`glob`、`grep`、`read_files`、`web_fetch`、`web_search`、`use_skill` 以及通过严格只读 Bash 判定的 `run_bash_command` SHALL 可归类为只读并行调用；写入型、会话状态型、交互型、需要审批、MCP、subagent 和未知工具 SHALL 归类为独占调用。无法可靠判定时系统 SHALL 默认选择独占执行，且并发分类 SHALL NOT 放宽既有 mode、readonly policy 或审批边界。

#### Scenario: 已知观察工具可并行
- **WHEN** provider 在同一 turn 返回多个 `glob`、`grep`、`read_files`、`web_fetch`、`web_search` 或 `use_skill` 调用
- **THEN** 并发分类器 SHALL 将这些调用标记为只读并行调用
- **THEN** 系统 SHALL 继续对每个调用应用既有参数校验、结果截断和失败归一化语义

#### Scenario: 只读 Bash 可并行
- **WHEN** `run_bash_command` 的 command 通过现有严格 plan-mode 只读 Bash 判定
- **THEN** 并发分类器 SHALL 将该调用标记为只读并行调用
- **THEN** 并发分类 SHALL NOT 使用 normal mode 的低风险判断替代严格只读判定

#### Scenario: 有副作用或交互的工具保持独占
- **WHEN** provider 返回文件编辑、非只读 Bash、todo 状态更新、`ask_user_questions`、需要审批的工具或其他可能产生副作用的调用
- **THEN** 并发分类器 SHALL 将该调用标记为独占调用
- **THEN** 系统 SHALL NOT 与其他工具同时执行该调用

#### Scenario: MCP、subagent 和未知工具默认独占
- **WHEN** provider 返回 MCP tool、`run_subagent` 或 registry 无法提供已知只读语义的工具
- **THEN** 并发分类器 SHALL 将该调用标记为独占调用
- **THEN** server 信任配置、无需审批或未知工具失败结果 SHALL NOT 自动使该调用变为只读并行调用

### Requirement: 连续只读段有序工具调度
系统 SHALL 按 provider 返回顺序直接处理一次 turn 的 tool calls。相邻的连续只读调用 SHALL 作为一个执行段全部并行启动，不得使用缺少实际观测依据的固定本地并发上限对该段再次分批；遇到独占调用时，系统 SHALL 先等待此前已启动的只读调用全部结束，再独占执行该调用，并 SHALL 在完成后才继续处理后续调用。系统 SHALL NOT 为该调度引入 provider-visible 分组概念、创建 subagent 或改变工具参数。

#### Scenario: 连续只读调用并行开始
- **WHEN** 同一 provider turn 按顺序返回多个连续只读调用
- **THEN** scheduler SHALL 启动该连续段内的全部调用而不逐个等待前一调用完成
- **THEN** scheduler SHALL NOT 把该连续只读段拆成固定大小的顺序子批次

#### Scenario: 写调用形成执行屏障
- **WHEN** provider call 顺序为两个只读调用、一个写调用和另一个只读调用
- **THEN** 前两个只读调用 SHALL 并行执行并全部完成
- **THEN** 写调用 SHALL 随后独占执行
- **THEN** 最后一个只读调用 SHALL 只在写调用完成后开始

#### Scenario: 多个独占调用保持原序串行
- **WHEN** 同一 provider turn 包含两个或更多连续独占调用
- **THEN** 系统 SHALL 按 provider 原始顺序逐个执行这些调用
- **THEN** 任意两个独占调用的 handler 执行区间 SHALL NOT 重叠

### Requirement: 并行结果顺序与取消一致性
同时运行的只读工具实际完成顺序 MAY 不同于 provider 调用顺序，但 runtime SHALL 按 provider 原始顺序提交相邻的 tool call/result 对、调用 app result callback 并构建下一轮 continuation。每个结果 SHALL 保留自己的 call id 和 tool name。turn 取消时，系统 SHALL 取消全部同时运行的可中断操作、等待已启动任务结束或 settled，并 SHALL NOT 在 app transcript 中提交未完成并发调用组的孤立 tool call。

#### Scenario: 完成顺序不改变 transcript 顺序
- **WHEN** 同时运行的只读调用中，后一个调用先于前一个调用完成
- **THEN** runtime SHALL 等待这组连续只读调用全部达到可提交状态
- **THEN** transcript 和 app result callback SHALL 仍按 provider 原始调用顺序提交对应 call/result 对
- **THEN** 下一次 provider continuation SHALL 包含全部对应结果

#### Scenario: 单个工具失败不取消其他并发只读工具
- **WHEN** 一个只读工具返回 `ok: false` 或 handler 异常被 executor 归一化为失败结果
- **THEN** 同时运行的其他只读工具 SHALL 继续完成
- **THEN** 失败结果 SHALL 在其原始调用位置参与稳定顺序提交

#### Scenario: 用户中断并行只读调用
- **WHEN** 用户在多个只读调用同时执行期间中断当前 assistant turn
- **THEN** 同一 turn 的 abort signal SHALL 传递给全部已启动工具
- **THEN** runtime SHALL 隔离中断后的迟到 callback
- **THEN** app transcript SHALL NOT 包含只提交 call 而没有 result 的并行工具记录
