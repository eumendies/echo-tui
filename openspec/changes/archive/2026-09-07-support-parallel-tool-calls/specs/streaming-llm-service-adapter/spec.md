## ADDED Requirements

### Requirement: Provider 多工具调用响应
支持工具调用的 provider adapter SHALL 能在单次 provider turn 中收集并返回多个完整 tool call，并 SHALL 保留 provider 给出的调用顺序、call id、tool name 和 arguments。协议支持并行 tool call 请求开关时，普通带工具请求 SHALL 启用该能力；不暴露工具的 compaction 请求 SHALL 继续不发送工具或并行工具参数。

#### Scenario: OpenAI Chat 请求允许并行工具调用
- **WHEN** OpenAI Chat compatible adapter 构造普通且包含工具 definitions 的请求
- **THEN** 请求 SHALL 允许 provider 在同一响应中返回多个 tool call
- **THEN** stream reader SHALL 按 tool index 组装并返回全部完整调用

#### Scenario: Responses 和 Codex 收集多个 function call
- **WHEN** OpenAI Responses 或 Codex stream 在同一 turn 中完成多个不同 call id 的 function call
- **THEN** adapter SHALL 返回全部去重后的 tool calls
- **THEN** 返回顺序 SHALL 与 provider 输出顺序一致

#### Scenario: Anthropic 收集多个 tool_use block
- **WHEN** Anthropic message 在同一响应中包含多个 `tool_use` block
- **THEN** adapter SHALL 按 content block index 返回全部 tool calls
- **THEN** 每个调用 SHALL 保留自己的 tool use id 和完整 input JSON

#### Scenario: Compaction 请求不携带并行工具参数
- **WHEN** adapter 构造上下文压缩用途的 provider 请求
- **THEN** 请求 SHALL NOT 暴露 tool definitions
- **THEN** 请求 SHALL NOT 仅为本能力发送并行 tool call 开关

### Requirement: 多工具结果 continuation 关联
Provider transcript converter SHALL 将同一 agent loop 批次产生的每个 tool result 与原始 call id 正确关联，并 SHALL 让下一次 provider turn 获得全部结果。一个调用失败 SHALL NOT 导致同批次其他有效结果被过滤或错误关联。

#### Scenario: 多个结果按 call id 回传
- **WHEN** transcript 包含多个具有不同 call id 的完整 call/result 对
- **THEN** provider converter SHALL 为每个结果生成对应协议的 tool output
- **THEN** 每个 output SHALL 引用正确的原始 call id

#### Scenario: 成功与失败结果混合回传
- **WHEN** 同一批次同时包含成功和失败 tool result
- **THEN** converter SHALL 保留所有有效结果
- **THEN** provider SHALL 能区分每个调用的结果文本和失败语义
