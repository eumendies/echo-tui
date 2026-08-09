# incremental-streaming-commit Specification

## Purpose
TBD - created by archiving change incremental-stream-commit. Update Purpose after archive.
## Requirements
### Requirement: assistant 正文按稳定 Markdown 前缀增量确定
系统 SHALL 在 assistant 正文 streaming 期间，把当前 provider segment 中已稳定的 Markdown source 前缀增量确定到 terminal scrollback，footer pending preview SHALL 从 visible cursor 开始保留尚未成功 drain 的尾部。稳定边界 SHALL 与最终 Markdown parser 共享 fence/table 判定，并 SHALL 保留 draft 末块、未闭合 code fence、table header candidate、未完成 table 及 table 后仅有空白行的部分。已确定投影 SHALL 是对应最终 assistant record 完整投影的稳定前缀。

#### Scenario: 正文跨块确定稳定前缀
- **WHEN** 当前 assistant segment 产生至少一个已完结 Markdown 块，且其后存在未完结内容
- **THEN** 系统 SHALL 把已完结块对应的新增投影确定到 terminal scrollback
- **THEN** footer pending preview SHALL 从 visible cursor 开始显示尚未成功 drain 的尾部
- **THEN** 分批投影 SHALL 与最终 assistant record 的对应前缀一致

#### Scenario: table header candidate 不提前确定
- **WHEN** draft 末尾包含可能在后续 delimiter 到达后变为 table header 的 pipe 行
- **THEN** 系统 SHALL 把该 candidate 保留在 footer
- **THEN** 后续 delimiter 和 rows 到达时 SHALL NOT 需要修改已经写入 scrollback 的行

#### Scenario: table 后只有空白行仍不确定
- **WHEN** streaming table 后仅有空白行且没有后续非空 block
- **THEN** 系统 SHALL 把该 table 整体保留在 footer
- **THEN** 只有 table 后出现非空 block 时 table 才 SHALL 成为可确定前缀

#### Scenario: 未闭合 fence 保持未确定
- **WHEN** draft 末尾存在未闭合 code fence
- **THEN** 系统 SHALL NOT 把该 fence 的任何投影确定到 scrollback
- **THEN** footer SHALL 继续展示该未确定块的有界 preview

### Requirement: reasoning 按完整视觉行增量确定
reasoning 使用纯文本 renderer。系统 SHALL 按当前 terminal width 把完整 draft 投影为视觉行，并在 activity tick 中把最后一个仍可能增长的视觉行之前的 source 前缀增量确定到 terminal scrollback，不得等待 provider part done。最后一个视觉行 SHALL 留在 footer；app 按 provider reasoning draft 追加更新的协议约束推进显示，不维护修正检测或恢复分支。

#### Scenario: OpenAI Responses 保持 draft 与 complete 分离
- **WHEN** OpenAI Responses 发出 reasoning summary delta、part done 或 output item done
- **THEN** adapter SHALL 按 part 顺序合并当前完整 preview 并发送 draft update
- **THEN** adapter SHALL NOT 因单个 part 或 output item done 提前发送 reasoning complete
- **WHEN** `response.completed` 到达
- **THEN** adapter SHALL 发送唯一一次 reasoning complete

#### Scenario: provider complete 前提交完整视觉行
- **WHEN** reasoning draft 在 complete 前已经投影出多个视觉行
- **THEN** 系统 SHALL 在 activity tick 中把除最后一个视觉行外的 source 前缀写入 terminal scrollback
- **THEN** footer SHALL 只保留最后一个仍可能增长的视觉行
- **THEN** 系统 SHALL NOT 因尚未收到 complete 而折叠已经完整的视觉行

### Requirement: reasoning 显示完成与 record 完成分离
系统 SHALL 在第一个正文 token 到达时结束 reasoning 显示阶段：先把 footer 中当时已有的最后一个 reasoning 视觉行写入 terminal scrollback，再开始正文 footer。正文开始后的 reasoning draft 或 complete SHALL 继续更新并提交完整 transcript 事实，但 SHALL NOT 把迟到内容追加到正文之后。该显示切换 SHALL NOT 提前创建 reasoning record；正常 reasoning record SHALL 只由 provider 的唯一 `complete` 事件创建。assistant segment、tool call 和 turn 正常完成 SHALL NOT 兜底 finalize reasoning；失败或用户中断 MAY 使用尚未完成的 reasoning 草稿创建 partial record。

#### Scenario: complete 先于正文
- **WHEN** Chat 或 Anthropic adapter 在正文开始前发送 reasoning complete
- **THEN** 系统 SHALL 先提交完整 reasoning summary record 并补写其未确定尾部
- **THEN** 后续正文 token SHALL 只更新或提交 assistant 正文，不得再输出同一 reasoning

#### Scenario: 正文 token 先于 complete
- **WHEN** OpenAI Responses 的首个正文 token 先于 turn-level reasoning complete 到达
- **THEN** 系统 SHALL 先把当时已有的 reasoning 视觉行写入 terminal scrollback
- **THEN** 系统 SHALL 关闭 reasoning 实时显示阶段，再开始正文 footer，并允许后续正文稳定块正常进入 scrollback
- **THEN** 后续 reasoning draft SHALL NOT 追加到正文之后
- **THEN** 系统 SHALL NOT 因 reasoning record 尚未完成而阻止正文显示
- **WHEN** reasoning complete 随后到达
- **THEN** 系统 SHALL 创建完整 reasoning record，但 SHALL NOT 把未实时显示的迟到尾部插入正文
- **THEN** destructive replay MAY 按完整最终 records 展示完整 reasoning

#### Scenario: tool call 不负责完成 reasoning record
- **WHEN** provider 产生 tool call，且 reasoning complete 尚未到达
- **THEN** 系统 SHALL 保持当前 reasoning 草稿，tool call callback SHALL NOT 创建 reasoning record
- **WHEN** provider 的 reasoning complete 到达
- **THEN** 系统 SHALL 由该 complete 事件创建唯一 reasoning record

### Requirement: 每个 assistant segment 独立维护确定进度
系统 SHALL 把每次 provider `runTurn` 的 draft 视为独立 assistant segment。正文 committed source cursor SHALL 只在当前 segment 内单调增长；工具调用前提交 segment record 后 SHALL 重置，下一次 provider run SHALL 从新的 segment cursor 开始。

#### Scenario: 工具调用前 finalize 当前 segment
- **WHEN** 当前 provider segment 已部分确定并随后产生工具调用
- **THEN** 系统 SHALL 使用完整当前 draft 创建 assistant segment record
- **THEN** renderer SHALL 直接补写尚未确定的投影并结束该 segment 的流式状态
- **THEN** 系统 SHALL 在追加 tool records 前重置正文 segment cursor

#### Scenario: 工具结果后的新 segment 不复用旧 cursor
- **WHEN** 工具结果后下一次 provider run 从空 draft 开始输出新正文
- **THEN** 系统 SHALL 为新 segment 使用独立 committed cursor
- **THEN** 新 assistant record SHALL 保留自身角色前缀与 block spacer
- **THEN** 新 segment SHALL NOT 被误判为旧 segment 的回退或重复

### Requirement: streaming commit 由 activity tick 合并且 record finalize 补齐尾部
高频 token/reasoning draft callback SHALL 只更新完整 draft，正常 terminal append SHALL 由 activity tick 批量 drain。assistant segment、turn complete 与失败/中断 SHALL 使用完整 assistant record 直接补写尚未显示的正文投影；reasoning complete 仅在正文尚未开始时补写尾部，正文开始后 SHALL 只提交事实并结束显示状态。首个正文 token 与插入独立 retry/compaction notice 前 SHALL 同步 drain，以保证 reasoning 切换和记录顺序。

#### Scenario: 多 token 在一个 tick 内合并
- **WHEN** 多个 token 在一次 activity tick 前跨越一个或多个稳定块边界
- **THEN** 系统 SHALL 在下一次 tick 一次性 append 截至最新 queued boundary 的新增投影
- **THEN** 每个 source 区间 SHALL 只输出一次

#### Scenario: queued source 在成功 drain 前不从 footer 消失
- **WHEN** callback 已推进 queued stable boundary但 activity drain 尚未成功写入 terminal
- **THEN** footer pending preview SHALL 从 visible cursor 开始继续包含该 queued source
- **THEN** 系统 SHALL NOT 仅因 source 已进入 queued 状态就把它从当前投影移除
- **WHEN** drain 成功
- **THEN** 系统 SHALL 在同一终端帧中推进 visible cursor并重绘其后的 pending tail

#### Scenario: completion 早于首个 tick
- **WHEN** draft 跨越稳定边界后 completion 在首个 activity tick 前到达
- **THEN** 最终 record SHALL 直接补写完整尚未显示的投影
- **THEN** renderer SHALL 清理对应流式显示进度并恰好追加一次 record 间距
- **THEN** 可见输出 SHALL 与一次性渲染最终 record 相同

#### Scenario: tool call 早于首个 tick
- **WHEN** 当前 segment 在首个 activity tick 前产生 tool call
- **THEN** tool call 前的 assistant segment record SHALL 直接补写完整尚未显示的投影
- **THEN** assistant、tool call 和后续 tool result SHALL 保持正确顺序

### Requirement: 正常 streaming 内容不再因 footer 预算折叠
系统 SHALL 对正文中已满足 Markdown 稳定边界的内容，以及 reasoning 中最后一个视觉行之前的内容执行增量确定，不得继续把这些内容隐藏在整段头部折叠摘要后。折叠 SHALL 仅用于正文的单个未闭合块，或极端终端高度下仍无法容纳的 reasoning 最后视觉行。

#### Scenario: 长正文不折叠稳定块
- **WHEN** 长正文包含多个已稳定块且整体投影远超 footer 预算
- **THEN** 系统 SHALL 把稳定块增量确定到 terminal scrollback
- **THEN** footer SHALL NOT 使用 `已生成 N 行` 摘要隐藏这些稳定块

#### Scenario: 超长未闭合块使用兜底
- **WHEN** 单个未闭合 Markdown 块超过 footer 剩余预算
- **THEN** footer SHALL 显示有界摘要和最新尾部
- **THEN** footer layout SHALL 不超过当前 terminal rows 推导出的预算

### Requirement: 最终与 partial records 不重复不丢失
正常完成、segment 完成、中断或失败时，系统 SHALL 为对应事实提交包含完整 draft 的 append-only records。assistant 渲染 SHALL 只补写尚未确定的正文投影；reasoning 在正文尚未开始时补写尾部，正文开始后 SHALL 保留完整 record 但不把迟到尾部追加到实时投影。中断/失败时，已经在 footer 展示的非空 reasoning 与 assistant 尾部 SHALL 进入 partial records，不得因尚未确定而丢失。

#### Scenario: 正常完成只补写剩余
- **WHEN** assistant streaming 完成
- **THEN** 最终 assistant record SHALL 包含当前 segment 完整正文
- **THEN** renderer SHALL 先补写未确定正文投影，再恰好追加一次 record 尾部 spacer
- **THEN** 增量确定正文时 SHALL NOT 提前写入 record 尾部 spacer
- **THEN** 分批输出行序列 SHALL 等于最终 record block 的一次性完整投影

#### Scenario: 中断保存完整当前 drafts
- **WHEN** 用户在 reasoning 或正文 streaming 期间中断 turn
- **THEN** 系统 SHALL 使用完整当前 reasoning draft 创建非空 partial reasoning summary record
- **THEN** 系统 SHALL 使用完整当前 assistant draft 创建非空 partial assistant record
- **THEN** 已确定前缀 SHALL 保持不动；正文未开始时补写 reasoning 尾部，正文已开始时不把迟到 reasoning 插入正文
- **THEN** 系统 SHALL 补写 assistant 尾部并最后追加中断 notice

#### Scenario: 失败保存完整当前 drafts
- **WHEN** assistant streaming 失败
- **THEN** 系统 SHALL 先按 reasoning、assistant 的顺序提交非空 partial records
- **THEN** 正文未开始时 renderer SHALL 补写 reasoning 尾部；正文已开始时 SHALL 只保存完整 reasoning 事实
- **THEN** renderer SHALL 补写 assistant 尾部，再追加 error record并释放 response lock
- **THEN** destructive replay SHALL 按完整 records 恢复规范顺序

### Requirement: destructive recovery 按当前宽度重投影 in-flight source
系统 SHALL 在 destructive recovery 中把 records 与当前可见 owner 尚未落成 record 的 in-flight source 纳入完整快照，并 SHALL 按当前 width/theme 重新投影，不得复用旧宽度下的 rendered line count 或物理行差分。replay SHALL 原子选择纳入快照的稳定/queued source boundary并同步 visible cursor；未纳入的 source SHALL 继续出现在 footer，不得产生显示空洞。

#### Scenario: columns 变化重算已确定投影
- **WHEN** streaming 期间 terminal columns 变化
- **THEN** destructive replay SHALL 用新宽度重绘 records 和选定 boundary 之前的 in-flight source
- **THEN** 系统 SHALL 把 visible cursor 同步到该 boundary
- **THEN** footer SHALL 用新宽度从该 boundary 继续展示 pending tail
- **THEN** 快照 SHALL 不重复也不丢失 source 内容

### Requirement: reasoning 显示偏好与增量确定一致
`showReasoningSummary=false` 时，系统 SHALL NOT 把 reasoning draft 增量确定到 terminal scrollback；现有 transient footer reasoning preview MAY 继续有界显示。reasoning summary record SHALL 照常提交事实，但 transcript append 和 destructive replay SHALL 过滤该 record。

#### Scenario: 关闭偏好时只保留 transient preview
- **WHEN** `showReasoningSummary=false` 且 reasoning 正在 streaming
- **THEN** 系统 SHALL NOT 把 reasoning 行焊入 terminal scrollback
- **THEN** footer MAY 显示有界 transient preview
- **THEN** 最终 summary record SHALL 提交但不作为 transcript block 渲染

#### Scenario: 运行中切换偏好
- **WHEN** 已有 reasoning in-flight projection 可见时偏好从 true 切换为 false
- **THEN** 系统 SHALL 通过 destructive recovery 移除该 reasoning projection
- **THEN** 后续 reasoning update SHALL NOT 执行 terminal commit
- **WHEN** 偏好随后从 false 切换为 true
- **THEN** 同一次 destructive recovery SHALL 按当前视觉行边界重投影 reasoning 并同步 visible cursor
- **THEN** 后续 activity drain SHALL 只追加该边界之后的新 source

### Requirement: terminal projection owner 隔离
系统 SHALL 区分 main 与 BTW in-flight projection owner。只有当前可见 owner MAY 向 terminal scrollback 增量 append；隐藏 owner MAY 更新 draft 和 queued state，但 SHALL NOT 写入当前投影。

#### Scenario: BTW 活跃时后台主 turn 跨越新的可提交边界
- **WHEN** BTW 是当前可见 owner且后台主 turn 产生新的稳定正文或 reasoning 前缀
- **THEN** 系统 SHALL 更新主 turn in-flight source state
- **THEN** 系统 SHALL NOT 把主 turn 行追加到 BTW scrollback
- **WHEN** 用户退出 BTW
- **THEN** destructive replay SHALL 恢复最新主 records、主 in-flight stable source 和主 pending tail
- **THEN** 系统 SHALL 把主 visible cursor 同步到 replay 已展示的 source boundary

