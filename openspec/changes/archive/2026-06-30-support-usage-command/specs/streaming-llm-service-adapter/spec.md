## ADDED Requirements

### Requirement: provider adapter 回传完整 token usage
真实 LLM adapter SHALL 在 provider stream 完成时尽量从 provider usage 字段中提取输入 token、缓存命中输入 token、缓存创建输入 token 和输出 token，并通过 provider-neutral usage 结构回传给 agent loop。缺少部分字段时 SHALL 保留可用字段，不得因 usage 字段缺失而阻断响应完成。

#### Scenario: OpenAI Responses adapter 提取 usage
- **WHEN** OpenAI Responses stream completed event 携带 usage
- **THEN** adapter SHALL 提取输入 token
- **AND** adapter SHALL 提取缓存命中输入 token
- **AND** adapter SHALL 提取输出 token
- **AND** adapter SHALL 将这些字段写入 provider-neutral usage

#### Scenario: OpenAI Chat adapter 提取 usage
- **WHEN** OpenAI Chat compatible stream chunk 携带 usage
- **THEN** adapter SHALL 提取输入 token
- **AND** adapter SHALL 提取缓存命中输入 token
- **AND** adapter SHALL 提取输出 token
- **AND** adapter SHALL 将这些字段写入 provider-neutral usage

#### Scenario: Anthropic adapter 提取 usage
- **WHEN** Anthropic compatible stream event 携带 usage
- **THEN** adapter SHALL 提取输入 token
- **AND** adapter SHALL 提取缓存创建输入 token
- **AND** adapter SHALL 提取缓存命中输入 token
- **AND** adapter SHALL 提取输出 token
- **AND** adapter SHALL 将这些字段写入 provider-neutral usage

#### Scenario: usage 字段缺失时不中断响应
- **WHEN** provider stream 正常完成但 usage 缺少部分或全部 token 字段
- **THEN** adapter SHALL 返回所有可用 usage 字段
- **AND** adapter SHALL NOT 因 usage 缺失抛出错误
- **AND** assistant response SHALL 继续按 provider stream 的完成结果处理
