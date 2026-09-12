## ADDED Requirements

### Requirement: 子 Agent 过程渲染按并行标记分叉
主窗口投影 SHALL 依据子运行 start record 的 `parallelSize` 分叉：无标记的 run SHALL 保持既有 rail 流式渲染、singular footer 活动块与完成后 compact 外层 pair；带标记的 run SHALL NOT 在主窗口渲染其任何内部过程记录，执行中以 plural 紧凑 pending 块展示，完成后外层 `run_subagent` tool pair SHALL 展开显示最终报告正文。该分叉 SHALL 对实时渲染、快照重绘、resize recovery 与会话重放一致。

#### Scenario: 并行 run 不进入主 rail
- **WHEN** 一个 start record 携带 `parallelSize` 的子运行产生稳定过程记录
- **THEN** 主窗口 SHALL NOT 渲染这些记录
- **THEN** 这些记录 SHALL 继续完整持久化并可被会话窗口读取

#### Scenario: 单 run 渲染保持现状
- **WHEN** 一个子运行 start record 不携带 `parallelSize`
- **THEN** 主窗口 SHALL 按既有方式流式渲染 rail 并在完成后 compact 外层 pair

#### Scenario: 并行完成后报告正文可见
- **WHEN** 并行子运行全部完成并提交外层 tool pair
- **THEN** 主窗口 SHALL 展开显示每个 `run_subagent` 结果的报告正文

### Requirement: run_subagent 外层工具对的专属展开渲染
主窗口对 `run_subagent` 外层 tool pair 的展开投影 SHALL 使用专属 renderer：以与单 subagent rail 同构的单条连续 rail 分三段展示——rail 标题段（Agent 原名 · 任务原文，专属 rail 色）、报告正文段（rail assistant 同款弱化正文与行数预算）与终态行，不渲染中间过程与原始 JSON 参数。外层参数无法解析出 agent 与 task 时 SHALL 回退通用工具消息投影以保留事实内容。已有本地子运行终态的单委派 SHALL 保持既有 compact 单行终态文案。

#### Scenario: 并行委派完成后的 rail 同构三段
- **WHEN** 并行只读段内的 `run_subagent` 委派完成并进入外层 pair 投影
- **THEN** 主窗口以单 subagent rail 同构的连续 rail 渲染标题段（agent · 任务）、报告正文段与终态行，不出现中间过程与原始 JSON 参数

#### Scenario: 参数解析失败回退通用投影
- **WHEN** 外层 `run_subagent` 参数无法解析出 agent 或 task 字段
- **THEN** 该 pair 回退通用工具消息投影，保留事实内容

#### Scenario: 单委派终态保持 compact 一行
- **WHEN** 单委派已有本地子运行终态且过程 rail 已完整展示
- **THEN** 外层 pair 保持既有 compact 单行终态文案

### Requirement: 并行子 Agent 的 plural footer 紧凑块
存在带并行标记的活跃子运行时，footer SHALL 使用单一 plural 紧凑块：共享标题展示运行中数量与总耗时，并按 start 顺序为每个 run 展示最多一行的 agent 名、任务摘要、当前 phase、当前工具摘要与 elapsed；行数超过预算时 SHALL 以 `… +N more` 类文案折叠。提示 SHALL 指示可用会话窗口快捷键查看运行详情。无并行标记的单 run SHALL 继续使用既有 singular 活动块。

#### Scenario: 同时展示多个并行运行
- **WHEN** 两个及以上并行子运行同时活跃
- **THEN** footer SHALL 使用一个共享标题与每 run 一行的紧凑块
- **THEN** 每行 SHALL 保持 start 顺序稳定，不随事件到达重排

#### Scenario: 预算不足时折叠
- **WHEN** 紧凑块行数超过 footer 可用预算
- **THEN** footer SHALL 保留标题与可容纳的前序行并展示隐藏数量

#### Scenario: 排队审批可见
- **WHEN** 并行子运行中某个内部工具等待人工授权
- **THEN** 对应行 SHALL 展示 waiting_approval 相位
