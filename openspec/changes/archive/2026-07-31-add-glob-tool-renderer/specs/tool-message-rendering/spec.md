## ADDED Requirements

### Requirement: glob query and lifecycle projection
系统 SHALL 为 `glob` pending call、孤立 call 和相邻且 call id 匹配的 call/result pair 提供专属终端投影。投影 SHALL 使用 `Glob · “<pattern>”` 或等价的人类可读标题替代完整 arguments JSON，并 SHALL 通过调用标记或标题让 pending、成功、无文件和失败状态清晰可辨。

#### Scenario: Pending glob 显示查询摘要
- **WHEN** footer pending preview 或孤立 transcript call 的 `toolName` 为 `glob`
- **AND** arguments 包含非空 pattern `**/*.ts`
- **THEN** renderer SHALL 显示 `Glob · “**/*.ts” · searching` 或等价查询和 pending 状态
- **THEN** renderer SHALL NOT 显示完整 arguments JSON

#### Scenario: 搜索范围显示在第二行
- **WHEN** 合法 `glob` arguments 包含 paths，或者使用默认当前目录搜索范围
- **THEN** renderer SHALL 在标题下方显示有界的搜索范围 metadata
- **THEN** metadata SHALL 表达 paths，且 SHALL NOT 把字段名和值以原始 JSON 形式展示

#### Scenario: 查询标题过长时安全换行
- **WHEN** pattern 和生命周期或结果状态无法放入一个 safe render width
- **THEN** renderer SHALL 使用与第一行标题一致的 continuation prefix 安全换行
- **THEN** 第二行 SHALL 继续只表达搜索范围

#### Scenario: 完成 pair 使用共享标题和结果状态
- **WHEN** transcript 包含相邻且 call id 匹配的 `glob` call 与 result
- **THEN** renderer SHALL 将二者投影为一个共享查询标题的工具块
- **THEN** 成功和无文件调用的 `◆` SHALL 使用 `toolSuccess` 语义状态，失败调用的 `◆` SHALL 使用 `toolError` 语义状态
- **THEN** pending 调用 SHALL 保持中性 marker，完成态 SHALL NOT 继续显示 searching 状态

### Requirement: glob flat path tree projection
系统 SHALL 在成功 `glob` result 包含合法结构化 display metadata 时，将路径按 metadata 原始顺序投影为有界的扁平文件路径树。每个可见文件 SHALL 使用一条完整路径而不重建目录节点，并 SHALL 使用当前主题的低强调语义色，而不是 syntax theme 或固定 ANSI 调色板。

#### Scenario: 多个文件形成扁平路径树
- **WHEN** 成功 result 的 display metadata 包含多个文件路径
- **THEN** renderer SHALL 按 metadata 原始顺序显示路径
- **THEN** renderer SHALL 使用 `├─`、`└─` 或等价树形元素区分列表项
- **THEN** 每个文件 SHALL 常态占用一个逻辑节点，renderer SHALL NOT 为路径中的目录段额外生成层级节点

#### Scenario: 路径树保持低强调样式
- **WHEN** renderer 显示一个或多个文件路径
- **THEN** renderer SHALL 使用当前主题的 `toolOutput` 或等价低强调语义样式投影树线、路径和省略提示
- **THEN** renderer SHALL NOT 对路径应用 syntax theme
- **THEN** renderer SHALL NOT 为 glob 写死 RGB 或 256 色值

#### Scenario: 无匹配显示紧凑空状态
- **WHEN** 成功 result 的合法 display metadata 包含空 paths 数组
- **THEN** 标题 SHALL 显示 `no files` 或等价空状态
- **THEN** renderer SHALL NOT 显示空路径树或重复的无匹配正文

### Requirement: glob result count and display budget
系统 SHALL 区分 `glob` handler 的结构化截断事实与 renderer 为控制终端占用而执行的展示省略。结果数量、more-available 状态和可见省略数量 SHALL 从结构化 result details 与 display metadata 得出，不得从路径文本中的同名字面量推断。

#### Scenario: 未截断结果显示捕获数量
- **WHEN** 成功 result 的 `details.truncated` 为 false 且 display metadata 包含 N 个路径
- **THEN** 标题 SHALL 显示 N 个 file 的数量语义
- **THEN** renderer SHALL NOT 把 TUI 自身未展示的路径误报为 handler 截断

#### Scenario: Handler 截断显示 more available
- **WHEN** 成功 result 的 `details.truncated` 为 true
- **THEN** 标题 SHALL 将 metadata 中的路径数量表达为已捕获或已显示数量，并 SHALL 表达 more available
- **THEN** renderer SHALL NOT 将该数量表述为完整发现总数

#### Scenario: 超出 renderer 预算时显示可计数省略
- **WHEN** 合法路径树在当前 terminal width 下超过专属 renderer 的最终物理行预算
- **THEN** renderer SHALL 只投影预算内的文件路径
- **THEN** 路径树末尾 SHALL 显示被 renderer 省略的 metadata 路径数量
- **THEN** 省略 SHALL NOT 删除或修改 result text、display metadata 或 `details.truncated`

### Requirement: glob renderer safety and record preservation
`glob` 专属 renderer SHALL 只改变终端可见投影，不得改变 tool execution、transcript record、provider continuation 或 session 持久化事实。失败诊断 SHALL 有界显示；无法安全解析的 arguments 或 display metadata SHALL 降级到通用 tool renderer。所有可见行 SHALL 遵守 safe render width、grapheme 和 Tab 展开规则。

#### Scenario: glob 失败显示短诊断
- **WHEN** 相邻匹配的 `glob` result 标记失败且包含非空失败原因
- **THEN** renderer SHALL 显示带 failed 状态的查询标题和有界诊断
- **THEN** renderer SHALL NOT 把失败文本伪装为路径树

#### Scenario: 非标准调用参数安全降级
- **WHEN** `glob` call arguments 不是预期 JSON object，或 pattern、paths 的类型不可信
- **THEN** renderer SHALL 使用通用 tool call renderer
- **THEN** renderer SHALL NOT 抛出异常或中断 footer/transcript 渲染

#### Scenario: 缺失或非法 display metadata 安全降级
- **WHEN** 成功 `glob` result 缺少 display metadata，或者 metadata 中的 kind、paths 或任一路径类型非法
- **THEN** renderer SHALL 使用通用 tool result renderer 展示有界原始文本
- **THEN** renderer SHALL NOT 部分构造、伪造或重排路径树

#### Scenario: 窄终端、宽字符、Tab 和控制换行安全投影
- **WHEN** terminal width 较窄，或 pattern、scope、文件路径包含长文本、宽字符、Tab、CR 或 LF
- **THEN** renderer SHALL 折叠标题和路径中的控制换行，按当前可见列展开 Tab，并按 safe render width 换行或截断内容
- **THEN** 每个 renderer 返回行 SHALL NOT 包含原始换行或回车，也 SHALL NOT 超过 safe render width
- **THEN** tree prefix 和 continuation prefix SHALL 保持层级可辨认；固定树结构无法适配时 SHALL 安全降级

#### Scenario: 原始 glob 事实保持不变
- **WHEN** `glob` call 或 result 被专属 renderer 投影
- **THEN** 原始 `toolName`、`argumentsText`、result text、`ok`、`toolCallId`、`exitCode`、`truncated` 和 display metadata SHALL 保持不变
- **THEN** provider continuation SHALL 接收原始 tool result 文本而不是渲染后的标题、scope 或路径树
- **THEN** session 重放 SHALL 使用持久化 metadata 产生等价投影，历史缺少 metadata 的记录 SHALL 无需迁移并安全降级
