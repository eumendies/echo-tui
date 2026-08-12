## ADDED Requirements

### Requirement: 子 Agent 工作过程作为结构化本地 transcript 事实
交互式 TUI SHALL 将每次子 Agent 运行的稳定工作过程追加为 `subagent` transcript records。每条记录 SHALL 包含稳定 `runId`、外层 `parentToolCallId`、`agentName` 和事件类型；事件 SHALL 能表达 start、可见 reasoning summary、assistant segment、内部 tool call、内部 tool result、completed、failed 与 cancelled。内部工具事件 SHALL 保留重放现有工具 renderer 所需的 call id、tool name、arguments、结果状态和专属 display metadata。系统 SHALL NOT 为每个 token、spinner frame 或 provider 私有 reasoning extension 追加记录。

#### Scenario: 启动后立即保存 start 事实
- **WHEN** `run_subagent` 已通过参数和预算校验并启动 `explorer`
- **THEN** 主 transcript SHALL 立即追加包含 task 摘要、run id 和 parent tool call id 的 subagent start record
- **THEN** 该 record SHALL 在子 Agent 尚未完成时进入当前 session journal

#### Scenario: 内部工具完成后保存工具事实
- **WHEN** 子 Agent 的一个内部工具调用产生结果
- **THEN** 系统 SHALL 以匹配的 call id 保存 subagent tool call 和 tool result 事实
- **THEN** 记录 SHALL 保留专属 renderer 和恢复所需的结构化结果字段

#### Scenario: 流式草稿只在稳定边界持久化
- **WHEN** 子 Agent provider 连续产生 reasoning 或 assistant token
- **THEN** 系统 SHALL 使用 transient pending state 更新当前可见活动
- **THEN** 系统 SHALL 只在 reasoning complete、assistant segment 或最终完成边界追加稳定 subagent record

#### Scenario: 运行结束保存终态
- **WHEN** 子 Agent 成功、失败或因父级取消而结束
- **THEN** 系统 SHALL 追加对应 completed、failed 或 cancelled 终态 record
- **THEN** 终态 SHALL 包含可用的耗时；failed或cancelled MAY在 record正文携带简洁诊断
- **THEN** completed record正文 SHALL为空，最终报告 SHALL只保存在先行 assistant event和外层 tool result中

### Requirement: 子 Agent 过程只供本地展示和恢复
`subagent` records SHALL 是本地可见、可持久化、非 provider-facing 的 transcript role。所有 provider adapter、主上下文构造、token 估算、自动/手动压缩摘要输入和会话引用 provider 投影 SHALL 忽略这些 records。外层 `run_subagent` tool call/result SHALL 继续按普通工具协议进入主 Agent 上下文，且只有该 tool result 的最终文本向主 Agent表达子 Agent结论。

#### Scenario: 主 Provider 只看到外层结果
- **WHEN** 主 transcript 包含完整子 Agent过程和已完成的外层 `run_subagent` call/result
- **THEN** 后续主 provider input SHALL 包含外层 call/result
- **THEN** provider input SHALL NOT 包含任何 `subagent` role record 或内部工具 call id

#### Scenario: 压缩忽略子 Agent过程
- **WHEN** token 估算或压缩摘要输入覆盖一个或多个 subagent records
- **THEN** 系统 SHALL NOT 把这些 records 的文本或内部工具结果计入 provider token 估算或摘要输入
- **THEN** 外层 `run_subagent` call/result SHALL 继续按普通工具记录参与压缩

#### Scenario: 强制压缩按可发送记录保留近期上下文
- **WHEN** 主 transcript 包含大量 subagent records且系统计算强制压缩的最近 K 条保留边界
- **THEN** 系统 SHALL 按 provider-facing records计数并映射回物理 transcript索引
- **THEN** subagent records SHALL NOT 把仍属近期的主 user、assistant 或外层 tool records挤出活跃区间
- **THEN** 映射后的边界 SHALL 继续保护外层 tool call/result 配对

#### Scenario: Provider 私有记录不镜像到主 transcript
- **WHEN** 子 Agent provider 产生加密 reasoning、thinking signature 或其他 provider-private extension
- **THEN** 子 Agent内部 continuation MAY 使用这些记录
- **THEN** 系统 SHALL NOT 把它们镜像成主 transcript 的 subagent 工作过程

### Requirement: 子 Agent 过程随主 session journal 恢复
稳定 subagent records SHALL 通过现有 `append_records` journal 操作增量持久化并随主 session replay、fork、undo transcript 截断和 destructive repaint 一起恢复。Journal 校验 SHALL 验证 subagent role 的必需身份字段和事件结构；未知、损坏或缺少身份字段的 subagent record SHALL 使对应 journal 操作按现有结构校验规则失败。恢复时 start 没有匹配终态的运行 SHALL 投影为意外中断，而 SHALL NOT 自动重启子 Agent。

#### Scenario: Resume 恢复完整工作过程
- **WHEN** session journal 包含一组有效 subagent start、tool、assistant 和 completed records
- **THEN** `/resume` replay SHALL 按原顺序恢复这些 records
- **THEN** transcript 重绘 SHALL 恢复对应子 Agent rail 和嵌套工具过程

#### Scenario: 恢复未完成运行
- **WHEN** journal replay 后存在 subagent start 和部分过程记录但没有 completed、failed 或 cancelled 终态
- **THEN** renderer SHALL 显示该运行上次意外中断或等价本地状态
- **THEN** 系统 SHALL NOT 自动发起 provider 请求、执行工具或补造成功结果

#### Scenario: 外层工具协议保持成对落盘
- **WHEN** 子 Agent仍在运行或进程在其结束前退出
- **THEN** 系统 SHALL NOT 为了显示起始 rail 而提前持久化孤立的外层 `run_subagent` tool call
- **THEN** 外层 call/result SHALL 在结果到达后继续按现有成对方式落盘

### Requirement: 子 Agent 使用外层 rail 嵌套现有工具投影
Renderer SHALL 将同一 `runId` 的连续 subagent records 投影为一段外层 rail。Start SHALL 显示一次子 Agent名称和任务摘要；内部工具 call/result SHALL 在扣除外层 rail 显示宽度后复用现有工具专属行级 renderer的参数解析、结构、状态文本和显示预算，并为每个物理行补上外层 rail；assistant 与 reasoning 内容 SHALL 在同一 rail 内使用有界、主题化的文本投影；终态 SHALL 显示成功、失败、取消或意外中断及可用耗时。渲染 SHALL 只改变可见输出，不得改写持久化 records 或外层 tool result。

所有嵌套工具内容 SHALL 使用当前主题的 `toolOutput` 或等价暗色语义，包括内部 marker、标题、rail、命令、stdout、stderr和结果正文；SHALL NOT 使用 success、error或其他彩色强调。成功、失败、退出码、超时和截断事实 SHALL 继续通过文字表达。该暗色覆盖 SHALL 只作用于子 Agent内部工具，顶层普通工具 SHALL 保持现有颜色行为。

#### Scenario: 内部 Bash 使用双层 rail
- **WHEN** subagent 过程包含匹配的 Bash call/result
- **THEN** 外层每个可见物理行 SHALL 保留子 Agent rail
- **THEN** 内层 Bash SHALL 继续使用现有命令/result rail、状态文本、退出码、耗时和截断投影
- **THEN** 内层 Bash marker、双段rail、命令和输出 SHALL 全部使用 `toolOutput` 或等价暗色，且 SHALL NOT 使用成功绿、错误红或其他强调色
- **THEN** renderer SHALL NOT 把 Bash 降级为原始 JSON 或字面量换行文本

#### Scenario: 内部非 Bash 工具复用专属 renderer
- **WHEN** subagent 过程包含 read_files、grep、glob、web 或 use_skill call/result
- **THEN** renderer SHALL 在外层 rail 内复用该工具现有专属可见摘要和结果预算
- **THEN** 内部工具的调用标记、标题、结构线和结果内容 SHALL 统一使用 `toolOutput` 或等价暗色
- **THEN** subagent renderer SHALL NOT 为同一工具维护第二套参数解析和结果格式规则

#### Scenario: 内部失败只用文字表达状态
- **WHEN** 子 Agent内部工具返回失败、非零退出、超时或截断状态
- **THEN** renderer SHALL 保留可读失败、退出码、超时或截断文字
- **THEN** renderer SHALL NOT 使用 error色或其他彩色强调表达该状态

#### Scenario: 顶层工具颜色保持不变
- **WHEN** 主 Agent的普通工具call/result不位于subagent rail内
- **THEN** renderer SHALL 继续使用现有success、error、tool和toolOutput语义颜色
- **THEN** subagent muted tone SHALL NOT 改变顶层工具投影

#### Scenario: 最终结果不重复显示
- **WHEN** 已完成的 subagent rail 已显示最终回答，且其后存在外层 `run_subagent` call/result pair
- **THEN** `run_subagent` 专属 pair renderer SHALL 隐藏重复结果正文或仅显示紧凑返回状态
- **THEN** transcript 中的外层 result 原文 SHALL 保持不变并继续提供给主 provider

#### Scenario: 可见行遵守宽度
- **WHEN** 子 Agent内部工具、路径、命令或文本超过可用终端宽度
- **THEN** renderer SHALL 先扣除外层 rail 的显示宽度，再按现有 safe render width 规则换行或截断内部内容
- **THEN** 每个返回行 SHALL 不包含原始换行或回车，且显示宽度 SHALL 不超过当前 safe render width

#### Scenario: 窄终端降级
- **WHEN** 终端宽度不足以同时容纳可读的外层和内层 rail
- **THEN** renderer SHALL 降级为扁平标题、缩进或等价安全投影
- **THEN** renderer SHALL 保留子 Agent身份、工具名和状态，且 SHALL NOT 输出越界行

### Requirement: 子 Agent 活动使用 footer 实时反馈
子 Agent运行期间，TUI SHALL 使用独立 transient pending state 在 footer 展示 agent 名称、当前 thinking/reasoning/streaming/tool/waiting-approval 阶段、可用的当前工具摘要和 elapsed time。稳定 start、tool pair、assistant segment 与终态 SHALL 清理 footer 后增量 append 到 transcript 区再重绘 footer；系统 SHALL NOT 为每个 token destructive repaint，也 SHALL NOT 切换 alternate screen。

#### Scenario: 等待 Provider 时 footer 持续更新
- **WHEN** 子 Agent正在等待 provider且尚无稳定事件可追加
- **THEN** footer SHALL 显示 `explorer`、当前活动阶段和递增耗时
- **THEN** 共享 activity timer SHALL 能重绘该 transient 状态而不修改 transcript

#### Scenario: 内部工具运行时显示工具摘要
- **WHEN** 子 Agent开始内部 tool call且尚未取得结果
- **THEN** footer SHALL 显示外层子 Agent身份和该工具的现有 pending 摘要
- **THEN** 工具完成后稳定 call/result SHALL 进入 transcript rail，footer SHALL 切换到下一阶段

#### Scenario: 等待人工审批
- **WHEN** 子 Agent Bash 正在等待人工审批
- **THEN** permission surface SHALL 按既有高优先级 modal 语义接管 footer 和输入
- **THEN** surface 结束且父 turn 仍有效时 SHALL 恢复子 Agent pending 投影

#### Scenario: Resize 重绘运行中投影
- **WHEN** 子 Agent运行期间终端列宽变化或行数缩小
- **THEN** destructive recovery SHALL 按新宽度重绘主 transcript 中已持久化的 subagent records和当前 transient pending
- **THEN** 系统 SHALL NOT 重复已经提交的子 Agent工具或 assistant 内容

### Requirement: 子 Agent 迟到 callback 不污染后续状态
系统 SHALL 为每次子 Agent运行分配稳定 run identity，并在把 start、streaming、tool、result、终态或 footer 更新写入 app 状态前校验父 turn 和 run identity。运行结束、父 turn 取消或新 turn 启动后，旧子 Agent的迟到 callback SHALL NOT 追加 transcript、更新 pending、打开审批 surface或改变后续 turn 的 response lock。

#### Scenario: 取消后迟到工具结果被忽略
- **WHEN** 父 turn 已取消且旧子 Agent随后返回内部 tool result
- **THEN** 系统 SHALL 忽略该 result 的 app/transcript 投影
- **THEN** 该 result SHALL NOT 出现在新 turn 或恢复后的当前 pending 中

#### Scenario: 新 turn 不被旧 complete 污染
- **WHEN** 子 Agent所属父 turn 已结束且用户启动新 turn
- **AND** 旧子 Agent随后触发 complete callback
- **THEN** 系统 SHALL 不追加 completed record或外层 result到新 turn
- **THEN** 新 turn 的 response lock和 footer SHALL 保持不变
