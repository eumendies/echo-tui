## MODIFIED Requirements

### Requirement: 能力模板只能收窄工具与执行权限
解析后的自定义定义 SHALL 把 `capability` 映射到系统拥有的固定执行策略与工具上限。`readonly` 定义的 tools SHALL 只能是 Explorer 本地工具上限的子集（上限包含 MCP 资源读取工具）且 SHALL 强制不启用 MCP tools；`general` 定义的 tools SHALL 只能是 Worker 本地工具上限的子集，并仅在 `mcp: true` 时合并父运行已初始化的 MCP tools。所有自定义定义 SHALL 禁止 `run_subagent`，且 SHALL NOT通过 description、正文、tools 或 mcp 字段改变风险分类、审批、interaction mode、headless policy、委派预算、取消传播或 transcript 隔离。

#### Scenario: 只读定义收窄工具集合
- **WHEN** readonly 定义只声明 `read_files`、`glob` 与 `grep`
- **THEN** 子 provider-visible schema和 executable registry SHALL 只包含这些可用本地工具
- **THEN** 系统 SHALL NOT自动补入 Bash、Web、Skill、MCP tools、资源读取、编辑、Todo、提问或委派工具

#### Scenario: 只读定义显式声明资源读取
- **WHEN** readonly 定义在工具列表中声明 `read_mcp_resource`
- **THEN** 该定义 SHALL 通过能力上限校验
- **THEN** 子 registry SHALL 包含该资源读取工具且 SHALL NOT 包含任何 `mcp__` 工具

#### Scenario: 只读定义请求越权工具
- **WHEN** readonly 定义声明文件编辑、Todo、提问、MCP tools 或其他超出 Explorer 上限的能力
- **THEN** 系统 SHALL 将整个定义标记为无效
- **THEN** prompt 中关于写入或免审批的文字 SHALL NOT放宽该结果

#### Scenario: 通用定义显式启用 MCP
- **WHEN** general 定义合法声明本地工具并设置 `mcp: true`
- **THEN** 子 registry SHALL 包含声明且当前可用的本地工具以及父运行当前发现的 MCP tools
- **THEN** MCP调用 SHALL 继续遵守父 normal、plan、interactive 或 headless 的现有风险和审批语义

#### Scenario: 所有自定义定义禁止递归委派
- **WHEN** 系统为任一 custom definition 构造 provider-visible schema和 executable registry
- **THEN** 两者 SHALL NOT包含 `run_subagent`
- **THEN** 伪造的嵌套委派调用 SHALL在本地执行边界返回失败结果

