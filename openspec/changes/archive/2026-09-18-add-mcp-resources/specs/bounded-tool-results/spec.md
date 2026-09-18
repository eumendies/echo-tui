## MODIFIED Requirements

### Requirement: 默认文本预算按工具类别确定
系统 SHALL 对除 MCP 工具与 MCP 资源读取外的内置工具采用 65,536 UTF-8 bytes 的默认最终文本硬上限，并对 MCP 工具与 MCP 资源读取保留 20,000 UTF-8 bytes 的默认最终文本硬上限。截断说明、状态 header、分隔符和 artifact marker SHALL 计入对应最终上限。

#### Scenario: 默认内置工具预算
- **WHEN** 内置工具未通过测试用 handler 选项覆盖结果预算
- **THEN** 其完整 provider-visible 文本 SHALL 不超过 65,536 UTF-8 bytes

#### Scenario: MCP 默认预算
- **WHEN** MCP 工具返回成功内容或失败信息
- **THEN** 其完整 provider-visible 文本 SHALL 不超过 20,000 UTF-8 bytes

#### Scenario: MCP 资源读取沿用 MCP 预算
- **WHEN** `read_mcp_resource` 返回成功内容、失败信息或二进制占位符
- **THEN** 其完整 provider-visible 文本 SHALL 不超过 20,000 UTF-8 bytes
- **THEN** 截断时 SHALL 使用既有 head 预览与 artifact marker 语义
