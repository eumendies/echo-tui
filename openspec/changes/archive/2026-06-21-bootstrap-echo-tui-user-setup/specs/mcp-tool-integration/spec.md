## ADDED Requirements

### Requirement: setup skill 文档化 MCP 配置
默认 `echo-tui-setup` skill SHALL 文档化用户级 MCP 配置结构，使模型和用户可以按现有 MCP runtime 规则配置 server，但 bootstrap SHALL NOT 自动创建任何 enabled MCP server。

#### Scenario: setup skill 说明 MCP server 配置
- **WHEN** 用户或模型加载 `echo-tui-setup` skill
- **THEN** skill 正文 SHALL 说明 `mcp.enabled` 和 `mcp.servers` 的基本结构
- **THEN** skill 正文 SHALL 说明 `stdio` server 的 `command`、`args`、`env`、`cwd`、`timeoutMs` 和 `approval` 字段
- **THEN** skill 正文 SHALL 说明 `http` server 的 `url`、`headers`、`timeoutMs` 和 `approval` 字段

#### Scenario: 默认配置不自动启用 MCP server
- **WHEN** bootstrap 创建默认 `~/.echo/config.json`
- **THEN** 默认配置 SHALL NOT 包含依赖外部命令、本机路径或网络地址的 enabled MCP server
- **THEN** MCP runtime SHALL 保持未配置 MCP 时的既有行为

