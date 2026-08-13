## ADDED Requirements

### Requirement: Worker 复用已初始化 MCP 工具目录
Worker SHALL通过独立registry复用父运行持有的已初始化MCP manager，并把当前可用MCP definitions和handlers合并到Worker工具目录。Worker SHALL NOT重新连接、初始化或关闭MCP server，也 SHALL NOT因此取得`run_subagent`。Explorer SHALL继续不包含MCP tools。

#### Scenario: Worker 使用共享 MCP tool
- **WHEN** 父运行的MCP manager已发现一个可用tool并创建Worker
- **THEN** Worker provider-visible registry和executor SHALL包含该namespaced MCP tool
- **THEN** Worker调用 SHALL通过共享manager代理到原server并把结果返回Worker continuation

#### Scenario: Worker registry 生命周期不影响 MCP 连接
- **WHEN** Worker完成、失败或取消
- **THEN** 系统 SHALL释放Worker自身registry和continuation状态
- **THEN** 系统 SHALL NOT关闭或重新初始化共享MCP manager连接

#### Scenario: Worker MCP 遵守 mode 与审批设置
- **WHEN** normal Worker调用MCP tool
- **THEN** 系统 SHALL沿用该tool配置的always或never审批策略并附加Worker origin
- **WHEN** plan Worker调用MCP tool
- **THEN** 系统 SHALL按plan mode语义拒绝执行
