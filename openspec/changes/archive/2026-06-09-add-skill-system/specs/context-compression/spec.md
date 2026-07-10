## ADDED Requirements

### Requirement: skill 工具结果随普通上下文压缩
系统 SHALL 将 `use_skill` 的 tool_call/tool_result 记录视为普通工具记录参与上下文压缩。系统 SHALL NOT 为 skill 内容实现独立 active 生命周期、手动逐出或特殊重挂机制。

#### Scenario: skill result 保留在活跃区间时继续投影
- **WHEN** `use_skill` 的 tool_result 位于压缩状态的活跃区间内
- **THEN** provider input SHALL 按普通 tool_result 转换规则包含该 skill 内容
- **THEN** 系统 SHALL NOT 额外注入另一份 skill 正文

#### Scenario: skill result 进入被压缩区间时由摘要承载
- **WHEN** 历史中的 `use_skill` tool_result 位于新的压缩边界之前
- **THEN** 压缩摘要请求 SHALL 可把该 skill 使用事实和必要结论纳入结构化摘要
- **THEN** 后续 provider input SHALL 不再包含该旧 tool_result 原文，除非它仍在活跃区间内

#### Scenario: 压缩边界继续保护 use_skill 工具配对
- **WHEN** 压缩边界落在 `use_skill` 的 tool_call/tool_result 配对中间
- **THEN** 系统 SHALL 沿用普通工具配对保护，把边界吸附到干净 turn 起点
- **THEN** 活跃区间 SHALL NOT 以孤立 `use_skill` tool_result 开头
