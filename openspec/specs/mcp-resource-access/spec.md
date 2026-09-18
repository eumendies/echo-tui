# mcp-resource-access Specification

## Purpose
定义 echo_tui 对 Model Context Protocol resources 能力的集成行为：按 server capability 门控且有界的资源发现与缓存、`list_mcp_resources` 与 `read_mcp_resource` 两个内置读取工具的参数与输出契约、只读放行与 plan / 只读运行 / 子 Agent / headless 边界，以及 MCP 级结果预算与二进制投影。
## Requirements
### Requirement: MCP 资源发现按 server capability 门控且有界
MCP manager SHALL 在 bootstrap 与 reload 时为每个已初始化的 server 发现资源。发现 SHALL 以 server 声明的 `resources` capability 为门控：未声明该 capability 的 server SHALL NOT 被调用，其资源目录视为空。声明了 capability 但调用返回 `-32601` 或其它错误时，该 server 的资源目录 SHALL 降级为空并记录既有脱敏诊断，SHALL NOT 影响该 server 的工具能力、连接状态或其它 server 的初始化。资源目录 SHALL 跟随分页游标并设置页数与条目上限，且 SHALL 对单条资源的名称、标题与描述长度设上限；resource templates SHALL 使用同一有界策略。

#### Scenario: 声明 resources 的 server 被拉取目录
- **WHEN** 某 server 在初始化响应中声明 `resources` capability
- **THEN** manager SHALL 拉取该 server 的资源列表并缓存
- **THEN** 缓存 SHALL 包含每项资源的 uri、名称、可选标题、可选描述与可选 mimeType

#### Scenario: 未声明 capability 的 server 不被调用
- **WHEN** 某 server 未声明 `resources` capability
- **THEN** manager SHALL NOT 向该 server 发送任何 resources 请求
- **THEN** 该 server 的工具能力与状态 SHALL 保持不变

#### Scenario: 可选端点返回 method not found
- **WHEN** 声明了 capability 的 server 对 `resources/list` 返回 `-32601`
- **THEN** manager SHALL 把该 server 的资源目录降级为空
- **THEN** manager SHALL 记录一条脱敏诊断
- **THEN** 该 server SHALL 继续提供其工具能力

#### Scenario: 超长资源目录被有界截断
- **WHEN** server 返回的资源条目数或单条描述长度超过上限
- **THEN** 缓存 SHALL 只保留上限内的条目与截断后的描述
- **THEN** 发现过程 SHALL NOT 因 server 持续返回分页游标而无限继续

### Requirement: 资源读取工具的参数与输出契约
系统 SHALL 在 MCP 真正启用时（存在至少一个初始化成功的 server）注册 `list_mcp_resources` 与 `read_mcp_resource` 两个全局内置工具，SHALL NOT 为每个 server 展开资源工具；未配置 MCP 或显式关闭 MCP 时 registry SHALL 只包含既有内置工具，与既有 MCP 边界保持一致。`list_mcp_resources` SHALL 支持可选的 server 过滤并同时输出该 server 的 resource templates；`read_mcp_resource` SHALL 要求 server 与 uri 两个参数。两个工具的 provider-visible schema 与执行 registry SHALL 来自同一装配结果，且在 run 启动时冻结、运行中不重新拉取目录。工具 SHALL 在同一 run 内复用共享 MCP manager 的连接，SHALL NOT 重新建立连接。

#### Scenario: 列出全部资源
- **WHEN** 模型调用 `list_mcp_resources` 且不指定 server
- **THEN** 结果 SHALL 按 server 分组列出当前缓存内的资源 uri 与描述性元数据
- **THEN** 每条资源的名称、可选标题、可选 mimeType 与可选描述 SHALL 出现在结果中
- **THEN** 结果 SHALL 包含已缓存的 resource templates
- **THEN** 每条模板 SHALL 使用与资源一致的元数据口径（uriTemplate、名称、可选标题、可选 mimeType 与可选描述）

#### Scenario: 按 server 过滤
- **WHEN** 模型调用 `list_mcp_resources` 并指定一个已配置的 server 名称
- **THEN** 结果 SHALL 只包含该 server 的资源与模板

#### Scenario: 读取指定资源
- **WHEN** 模型调用 `read_mcp_resource` 并提供存在的 server 与 uri
- **THEN** 工具 SHALL 通过共享 manager 调用该 server 的 `resources/read`
- **THEN** 成功结果 SHALL 使用对应 call id 与工具名返回文本内容

#### Scenario: 未知 server 或 uri
- **WHEN** 调用指定的 server 未初始化，或 server 返回该 uri 不存在
- **THEN** 工具 SHALL 返回 `ok: false` 的有界失败结果
- **THEN** 失败文本 SHALL 经过既有敏感信息脱敏

#### Scenario: 未启用 MCP 时不注册资源工具
- **WHEN** 用户配置没有 `mcp` 节点、`mcp.enabled` 为 false，或没有任何 server 初始化成功
- **THEN** provider-visible schema 与执行 registry SHALL NOT 包含 `list_mcp_resources` 或 `read_mcp_resource`
- **THEN** 默认工具目录 SHALL 与既有仅内置工具行为一致

### Requirement: 资源读取按只读观察工具放行
两个资源读取工具 SHALL 在风险分类中直接判定为安全执行，SHALL NOT 进入人工审批或自动审批流程。该判定 SHALL 早于 plan 分支与 MCP 工具分支，因此 SHALL 在 normal 与 plan 模式直接执行，SHALL 在只读运行（BTW、`/review`）中放行，并 SHALL 在 headless `--once` 中无需 `--full-access` 即可执行。既有 MCP tool 的只读注解审批语义 SHALL 保持不变，资源读取 SHALL NOT 参与该判定。

#### Scenario: normal 模式不请求审批
- **WHEN** agent 在 normal 模式调用任一资源读取工具
- **THEN** runtime SHALL 直接执行该调用
- **THEN** runtime SHALL NOT 打开 approval surface 或调用自动审批模型

#### Scenario: plan 模式放行只读资源读取
- **WHEN** agent 在 plan 模式调用 `list_mcp_resources` 或 `read_mcp_resource`
- **THEN** runtime SHALL 执行该调用
- **THEN** plan 模式对写入型工具与 `mcp__` 命名空间工具的既有拒绝行为 SHALL 保持不变

#### Scenario: 只读运行放行资源读取
- **WHEN** BTW 或 `/review` 的只读运行收到资源读取调用
- **THEN** runtime SHALL 放行该调用进入既有 executor
- **THEN** 未被声明为只读的 `mcp__` 工具 SHALL 继续被只读策略拒绝

#### Scenario: headless 默认策略下可用
- **WHEN** `--once` 运行未使用 `--full-access` 且模型调用资源读取工具
- **THEN** runtime SHALL 执行该调用而不是按 deny policy 拒绝

### Requirement: 资源结果的预算与二进制投影
资源读取的 provider-visible 文本 SHALL 使用与 MCP 工具结果一致的 20,000 UTF-8 bytes 最终预算，并 SHALL 复用既有 tool-result offloading：超限时保留头部、追加截断 marker 与完整 artifact 路径。资源内容中的 `blob` SHALL 投影为显式的二进制占位符（含 mimeType 与字节数），SHALL NOT 内联 base64 内容。`resources/read` 的多条 contents SHALL 按返回顺序合并为单条有界结果。

#### Scenario: 超限资源内容落盘
- **WHEN** `read_mcp_resource` 返回的文本超过 20,000 bytes
- **THEN** 结果 SHALL 只包含头部预览与截断 marker
- **THEN** marker SHALL 指向包含完整内容的 artifact 路径

#### Scenario: 二进制内容投影为占位符
- **WHEN** 资源内容项包含 `blob` 字段
- **THEN** 结果 SHALL 使用 `[Binary resource content <mimeType>, <N> bytes]` 形式的占位符
- **THEN** 结果 SHALL NOT 包含 base64 内容

#### Scenario: 多内容项按序合并
- **WHEN** 一次 `resources/read` 返回多个 contents 项
- **THEN** 结果 SHALL 按返回顺序合并文本与占位符
- **THEN** 合并后的完整文本 SHALL 不超过最终预算

### Requirement: 子 Agent 的资源可见性由能力上限与白名单决定
只读子 Agent 工具上限 SHALL 包含两个资源读取工具，内置 `explorer` 定义 SHALL 默认包含它们；自定义 readonly 定义 SHALL 需显式声明才获得资源读取。`general` 上限 SHALL 同样包含这两个工具，内置 `worker` SHALL 默认包含。子 Agent 的 `mcp` manifest 字段 SHALL 继续只控制 MCP tools 的合并，SHALL NOT 控制资源读取工具；readonly 定义声明 `mcp: true` SHALL 继续被判为无效。子 Agent 的资源读取 SHALL 复用父运行的共享 manager，且 SHALL 遵守与主 Agent 相同的只读放行语义。

#### Scenario: explorer 可读资源但仍无 MCP tools
- **WHEN** 系统为内置 `explorer` 构造 provider-visible 与 executable registry
- **THEN** registry SHALL 包含 `list_mcp_resources` 与 `read_mcp_resource`
- **THEN** registry SHALL NOT 包含任何 `mcp__` 命名空间的 MCP tools

#### Scenario: 自定义 readonly 需显式声明
- **WHEN** 自定义 readonly 定义只声明 `read_files` 与 `grep`
- **THEN** 其 registry SHALL NOT 自动包含资源读取工具
- **THEN** 定义显式声明资源读取工具时 SHALL 通过校验并生效

#### Scenario: readonly 定义启用 MCP tools 仍无效
- **WHEN** readonly 定义设置 `mcp: true`
- **THEN** 系统 SHALL 继续把该定义标记为无效
- **THEN** 资源读取工具 SHALL NOT 被解释为该字段的合法用途

