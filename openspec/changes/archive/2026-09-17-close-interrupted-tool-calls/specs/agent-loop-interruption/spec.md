## MODIFIED Requirements

### Requirement: 中断后不产生孤儿工具记录
系统 SHALL 避免因 Esc 中断在 transcript 中留下只有 `tool_call` 而没有对应 `tool_result` 的孤儿工具调用记录。已经成对完成并作为可见事实追加的工具记录 MAY 保留；尚未取得 tool result 的已播报工具调用 SHALL 成对收尾，而不是只清理 pending preview：系统 SHALL 在同一个 journal batch 内追加相邻的 `tool_call` record 与合成的失败 `tool_result` record，后者的 `ok` SHALL 为 false、details SHALL 为 generic，文本 SHALL 说明该调用被用户中断且未返回结果。同轮中尚未播报给 app 的调用 SHALL NOT 被补写。

#### Scenario: tool call pending 时中断
- **WHEN** agent loop 已显示工具调用 pending preview
- **AND** 对应工具尚未产生 tool result
- **AND** 用户按 Esc 中断当前 assistant turn
- **THEN** 系统 SHALL 清理该工具 pending preview
- **THEN** 系统 SHALL 在同一个 journal batch 中追加相邻的 `tool_call` 和合成失败 `tool_result` records
- **THEN** 合成 tool result SHALL 使用 `ok: false`、generic details 和说明用户中断且未返回结果的文本
- **THEN** 系统 SHALL NOT 追加缺少 tool result 的孤儿 `tool_call` transcript record

#### Scenario: 审批或提问等待期间中断
- **WHEN** 某个工具调用已经进入工具审批 surface 或 `ask_user_questions` 等待
- **AND** 该调用尚未取得 tool result
- **AND** 用户按 Esc 中断当前 assistant turn
- **THEN** 系统 SHALL 以同样的相邻 call/result 成对方式为该调用收尾
- **THEN** 审批或提问 surface 的既有取消与迟到回调隔离语义 SHALL 保持不变

#### Scenario: 并行只读段中断
- **WHEN** 多个已播报的连续只读调用尚未全部取得结果
- **AND** 用户按 Esc 中断当前 assistant turn
- **THEN** 系统 SHALL 按 provider 原始调用顺序为每个未完成调用补写相邻的 call/result pair
- **THEN** 已经成对追加的调用 SHALL NOT 被重复追加

#### Scenario: 已完成工具记录在中断后保留
- **WHEN** 某个工具调用已经产生并追加了匹配的 `tool_call` 和 `tool_result` records
- **AND** 用户随后按 Esc 中断后续 continuation
- **THEN** 系统 MAY 保留这些已完成工具 records 作为 transcript 事实
- **THEN** 系统 SHALL NOT 再发起基于这些 records 的新 provider continuation
