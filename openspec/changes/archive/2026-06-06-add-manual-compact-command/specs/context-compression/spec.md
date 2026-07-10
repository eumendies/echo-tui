## ADDED Requirements

### Requirement: 可复用压缩操作
系统 SHALL 提供一个可复用的异步压缩操作 `runCompaction`，封装「估算（可选）→ 阈值判定（可选）→ 边界计算 → 摘要生成」的完整编排，供自动触发与手动触发共享。该操作 SHALL 为纯函数式：仅依据入参计算并返回结果，SHALL NOT 直接修改外部状态或触发回调。返回结果 SHALL 包含是否发生压缩、原因，以及压缩发生时的新压缩状态。

#### Scenario: 压缩成功返回新状态
- **WHEN** 调用 `runCompaction` 且边界计算得到有效活跃区间起点
- **THEN** 该操作 SHALL 生成结构化摘要并返回「已压缩」结果，携带新的压缩状态（摘要文本 + 活跃区间起点索引）
- **THEN** 该操作 SHALL NOT 直接修改调用方的状态或触发回调

#### Scenario: 自动模式未超阈值时不压缩
- **WHEN** 以非强制模式调用 `runCompaction` 且预估上下文长度未超过窗口阈值
- **THEN** 该操作 SHALL 返回「未压缩」结果并标明原因为未达阈值
- **THEN** 该操作 SHALL NOT 发起摘要请求

#### Scenario: 边界不足以压缩
- **WHEN** 调用 `runCompaction` 但边界吸附后无法得到比当前活跃区间起点更靠前的有效边界
- **THEN** 该操作 SHALL 返回「未压缩」结果并标明原因为无有效边界
- **THEN** 该操作 SHALL NOT 发起摘要请求

### Requirement: 强制触发压缩
系统 SHALL 支持以强制模式调用压缩操作：强制模式 SHALL 跳过上下文长度阈值判定，直接进入边界计算与摘要生成。强制模式 SHALL 仍执行压缩边界吸附，确保不切断 tool_call/tool_result 配对、活跃区间不以孤立 tool_result 开头。

#### Scenario: 强制模式绕过阈值直接压缩
- **WHEN** 以强制模式调用压缩操作且存在可前移的有效边界
- **THEN** 该操作 SHALL 跳过阈值判定直接生成摘要并返回「已压缩」结果
- **THEN** 该操作 SHALL NOT 因当前长度未超阈值而拒绝压缩

#### Scenario: 强制模式仍保护工具配对
- **WHEN** 以强制模式调用压缩操作且初始边界会切断 tool_call/tool_result 配对
- **THEN** 该操作 SHALL 把边界向前吸附到干净 turn 起点
- **THEN** 压缩后的活跃区间 SHALL NOT 以孤立 tool_result 开头
