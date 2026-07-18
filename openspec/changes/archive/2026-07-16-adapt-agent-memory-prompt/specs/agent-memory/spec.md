## MODIFIED Requirements

### Requirement: Agent memory catalog 遵守 global 和 project scope
系统 SHALL 支持 global 与 project 两类 agent memory catalog scope。Project scope SHALL 绑定规范化 project root；每次 provider request 和 memory 工具调用 SHALL 仅考虑 global catalog 与当前 cwd 对应 project catalog。未显式指定 scope 的 agent memory 新建操作 SHALL 默认使用当前 project scope；显式 global mutation SHALL 在审批信息中标明其全局影响。Provider prompt 与 `read_memory` 的有效 catalog 解析 SHALL 先排除 disabled catalog，再由 enabled project catalog 覆盖大小写不敏感同名的 enabled global catalog。

#### Scenario: 当前项目只看到适用 catalog
- **WHEN** 系统在某个 project root 下构造 provider request
- **THEN** agent memory prompt 投影 SHALL 只考虑 global catalog 与绑定该 project root 的 catalog
- **THEN** 其他 project scope 的 catalog 及其 items SHALL NOT 被注入或由默认读取解析

#### Scenario: 默认创建 project catalog
- **WHEN** agent 调用 `add_memory` 添加 agent memory 且没有提供 scope
- **THEN** 系统 SHALL 将新 catalog 绑定到当前 project root
- **THEN** 系统 SHALL NOT 默认创建 global catalog

#### Scenario: Enabled project 同名 catalog 覆盖 global catalog
- **WHEN** 当前项目存在与 enabled global catalog 大小写不敏感同名的 enabled project catalog
- **THEN** provider agent memory prompt SHALL 只投影 project catalog 及其 enabled items
- **THEN** 未显式指定 scope 的 `read_memory` SHALL 解析到 project catalog
- **THEN** 未显式指定 scope 的 `update_memory` 和 `remove_memory` SHALL 继续解析到 project catalog

#### Scenario: Disabled project 同名 catalog 回退 global catalog
- **WHEN** 当前项目存在 disabled project catalog，且存在大小写不敏感同名的 enabled global catalog
- **THEN** provider agent memory prompt SHALL 投影 global catalog 及其 enabled items
- **THEN** 未显式指定 scope 的 `read_memory` SHALL 解析到 global catalog

### Requirement: Provider 每轮自动注入有效 catalog 索引
系统 SHALL 在每次真实 provider request 构造时重新读取当前 scope 下 enabled 的有效 agent memory catalogs 及其 enabled items，并构造展开版 transient system prompt 区块。系统 SHALL 使用与 provider context usage 相同的 token 估算器计算完整展开区块的 token 数；当该数值不超过当前模型 context window 的 2% 且不超过 8,000 tokens 时，系统 SHALL 展开所有有效 catalogs 的全部 enabled items，否则 SHALL 仅注入所有有效 catalog 的名称和描述。模式选择 SHALL 对该轮全部有效 catalogs 整体生效，不得混合展开和折叠。两种区块均 SHALL 说明 agent memory 可能过时，且不得覆盖系统指令、项目指令或当前用户请求，并 SHALL NOT 作为 transcript 或 session record 持久化。

#### Scenario: 小型 agent memory 全部展开
- **WHEN** 所有有效 agent memory 的完整展开区块不超过当前模型 context window 的 2%
- **AND** 完整展开区块不超过 8,000 tokens
- **THEN** provider system prompt SHALL 包含所有有效 catalog 的名称、描述和全部 enabled item 内容
- **THEN** provider system prompt SHALL NOT 包含 disabled catalog 或 disabled item

#### Scenario: Agent memory 超过比例预算时折叠
- **WHEN** 完整展开区块超过当前模型 context window 的 2%
- **THEN** provider system prompt SHALL 仅包含所有有效 catalog 的名称和描述
- **THEN** provider system prompt SHALL NOT 包含任何 catalog item 内容

#### Scenario: Agent memory 超过绝对预算时折叠
- **WHEN** 完整展开区块超过 8,000 tokens
- **THEN** provider system prompt SHALL 仅包含所有有效 catalog 的名称和描述
- **THEN** 大 context window SHALL NOT 放宽该绝对限制

#### Scenario: 展开与折叠不暴露内部元数据
- **WHEN** 系统构造任一模式的 agent memory prompt 区块
- **THEN** 区块 SHALL NOT 包含 scope、enabled、item id、item count、时间戳或其他内部元数据
- **THEN** 展开模式下需要精确更新或删除 item 的 agent SHALL 仍可通过 `read_memory` 获取 item id

#### Scenario: Catalog 文件读取失败时整轮回退折叠
- **WHEN** 系统能够读取有效 catalog 索引但任一有效 catalog 文件无法读取或格式无效
- **THEN** 该轮 provider system prompt SHALL 回退为完整的有效 catalog 名称和描述索引
- **THEN** 系统 SHALL NOT 注入仅包含部分 catalog items 的展开区块

#### Scenario: Catalog 或 item 变更在下一次请求生效
- **WHEN** memory 工具或 `/memory` 成功创建、重命名、修改、启停或删除 catalog 或 item
- **AND** agent loop 随后构造下一次真实 provider request
- **THEN** system prompt SHALL 使用保存后的最新有效 catalogs 和 enabled items 重新选择展开或折叠模式

