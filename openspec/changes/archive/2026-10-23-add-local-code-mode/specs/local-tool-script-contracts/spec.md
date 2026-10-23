## ADDED Requirements

### Requirement: 版本化的本地脚本工具契约
系统 SHALL 为 `tools.glob`、`tools.grep` 和 `tools.read_files` 提供输入 JSON Schema、输出 JSON Schema 和由维护的契约生成的精简说明。脚本参数名称及含义 SHALL 与原生工具一致；输入 SHALL 接受 JSON object，并遵守原生参数的必填、默认值和可空归一化语义。结果 SHALL 使用 JSON envelope：`schema_version` 固定为 `1`，`ok` 表示工具是否全部成功，`data` 为工具数据或 `null`，`error` 为 `null` 或含 `code`、`message` 的错误对象，`truncated` 表示因预算丢弃信息。宿主 SHALL 校验输入和输出，契约错误 SHALL 明确失败而不是猜字段或返回不符合 schema 的数据。

#### Scenario: 模型获得准确字段说明
- **WHEN** Code Mode 启用并向模型提供脚本 API 说明
- **THEN** 说明 SHALL 覆盖真实输入、输出、可选字段、错误及截断语义
- **AND** 真实结果 SHALL 通过对应 schema 校验
- **AND** 说明 SHALL 不将采样推断结构当作保证

#### Scenario: 非法输入与内部契约错误
- **WHEN** 参数不是 JSON object、包含不允许字段、违反原生字段约束，或采集结果违反已声明输出 schema
- **THEN** 无效输入 SHALL 在 handler 数据采集前被拒绝
- **AND** 输出契约错误 SHALL 返回明确的执行级 `contract_error` 并关闭后续派发
- **AND** 系统 SHALL 不回退到解析工具展示文本

### Requirement: 结构化数据与原生展示兼容
脚本数据 SHALL 直接来自与原生工具共用的参数归一化和数据采集边界，不通过解析文本 envelope、ANSI、行号、截断提示或 UI-only display metadata 构造。单次调用 SHALL 不为生成两种投影执行两遍工具。系统 SHALL 保持原生工具的参数、文本输出、附件、专属 UI metadata 和展示语义不变，新增机器数据 SHALL 不自动进入原生 provider 结果或持久化正文。

#### Scenario: 原生与脚本查询使用同一事实来源
- **WHEN** 相同查询分别通过原生工具和脚本工具执行，且文件状态与预算相同
- **THEN** 两者 SHALL 使用相同路径解析、参数默认值和采集规则
- **AND** 脚本结果 SHALL 不含展示层添加的行号、ANSI 或文本截断通知
- **AND** 原生展示 SHALL 继续通过既有回归测试

### Requirement: glob 脚本结果
成功的 `tools.glob` SHALL 在 `data` 中返回 `paths`、`has_more`。`paths` SHALL 为实际保留的有序路径列表，路径口径与原生 glob 一致；空匹配 SHALL 为成功且空列表。`has_more` SHALL 在因为条数、采集或 JSON 预算不能确认完整结果时为 `true`，SHALL NOT 提供没有实际支持的游标或总匹配数。路径发现 SHALL 保持隐藏文件、`.git` 排除和现有 ripgrep 规则。

#### Scenario: 空匹配不是失败
- **WHEN** glob 查询成功但没有匹配文件
- **THEN** envelope SHALL 为 `ok: true`、`error: null`
- **AND** `data.paths` SHALL 为 `[]`，`data.has_more` SHALL 为 `false`

#### Scenario: 结果达到条数或字节预算
- **WHEN** glob 发现的路径超过现有工具上限或脚本 JSON 预算
- **THEN** 结果 SHALL 只保留完整路径项
- **AND** `has_more` 与 `truncated` SHALL 为 `true`
- **AND** 说明 SHALL 要求缩小路径或 pattern，不伪造 next cursor

### Requirement: grep 脚本结果
成功的 `tools.grep` SHALL 在 `data` 中返回 `matches`、`has_more`。每个匹配 SHALL 包含 `path`、`line`、`column`、`text`；行号 SHALL 为 1-based，column SHALL 延续 ripgrep 的 1-based UTF-8 字节列位置，text SHALL 是保留的匹配源行，不含展示行号。literal、case_sensitive、glob、路径、隐藏文件和 `.git` 规则 SHALL 与原生工具一致。没有匹配 SHALL 为成功，源行或匹配项不能完整保留时 SHALL 标记不完整而不输出伪造完整匹配。

#### Scenario: Unicode 匹配保持位置口径
- **WHEN** 包含中文或 emoji 的源行产生匹配
- **THEN** 脚本结果 SHALL 保留实际源行及 1-based 行号
- **AND** column SHALL 按 UTF-8 字节位置解释，说明 SHALL 不将其描述为 JS 字符下标

#### Scenario: 查询无匹配或被截断
- **WHEN** grep 正常结束但无匹配，或因条数、源行、JSON 预算无法保留全部匹配
- **THEN** 无匹配 SHALL 返回成功、空 `matches`、`has_more: false`
- **AND** 不完整结果 SHALL 返回 `has_more: true`、`truncated: true`，且只保留完整匹配项

### Requirement: read_files 的文本专用脚本结果
`tools.read_files` SHALL 接受原生 `{files: [{path, offset?, limit?}]}` 参数，但仅采集普通 UTF-8 文本文件。系统 SHALL 在多媒体处理或目录枚举前拒绝目录、图片、PDF、其他媒体及特殊文件，SHALL 不解码图片、提取 PDF 或返回二进制/base64。现有编码、`.git`、路径、单次文件数量和读取预算 SHALL 继续生效。批量结果 `data.files` SHALL 按请求顺序返回逐项结果，即使部分文件失败也保留其他成功项。

成功项 SHALL 包含 `path`、`ok: true`、`kind: "text"`、`content`、`offset`、`returned_lines`、`start_line`、`end_line`、`has_more`、`content_truncated` 和 `next_offset`；完整扫描到 EOF 时才提供 `total_lines`。`content` SHALL 是与文本 reader 相同的 LF 归一化选中内容，不含展示行号，SHALL 不声称逐字节保留原文件行尾。空内容的 start/end line SHALL 为 `null`。失败项 SHALL 包含 `path`、`ok: false`、`kind: "error"` 和结构化 `error`。

#### Scenario: 按真实行号读取文本
- **WHEN** 脚本请求某个文本文件的 offset 和 limit
- **THEN** offset SHALL 是从零开始的跳过行数，start/end line SHALL 是真实 1-based 行号
- **AND** content SHALL 不包含 renderer 添加的行号或 envelope
- **AND** 仅因 limit 仍有完整后续行时，`has_more` SHALL 为 `true`，`next_offset` SHALL 为本次 offset 加实际返回行数

#### Scenario: 空文件与已越过 EOF
- **WHEN** 请求空文本文件或 offset 已超过 EOF
- **THEN** 文件项 SHALL 成功，content SHALL 为 `""`，returned_lines SHALL 为 `0`
- **AND** start_line、end_line、next_offset SHALL 为 `null`，has_more SHALL 为 `false`

#### Scenario: 批量部分失败和不支持的类型
- **WHEN** 一次读取同时包含有效文本、缺失文件、目录、图片或 PDF
- **THEN** `data.files` SHALL 按输入顺序保留成功文本项和明确错误项
- **AND** 顶层 `ok` SHALL 为 `false`，error SHALL 表达部分失败而不丢弃 data
- **AND** 非文本项 SHALL 不触发目录枚举或图片/PDF 处理

#### Scenario: 长行截断不丢失续读信息
- **WHEN** 字节预算使最后一条返回源行不完整
- **THEN** 系统 SHALL 标记 `content_truncated: true`、`has_more: true` 和 envelope `truncated: true`
- **AND** `next_offset` SHALL 为 `null`，SHALL 不提供会跳过该行剩余内容的伪续读位置
- **AND** 说明 SHALL 提示无法按字节续读该行，可改用原生工具或缩小任务

### Requirement: 截断及工具失败显式传递
脚本工具 SHALL 保持原生采集上限，且以更严格的脚本 JSON 单次/累计预算约束实际返回数据；SHALL 不因为脚本环境可做中间处理就无界读取。`has_more` SHALL 表示结果集合仍有或可能有后续数据，`truncated` SHALL 表示预算造成的信息缺失，正常请求 limit 的分页 SHALL 不自动等同于字节截断。工具失败 SHALL 返回明确的 `ok: false` 和稳定错误 code，不能用空数组伪装执行失败；普通工具错误 SHALL 允许脚本显式检查，执行级错误 SHALL 终止后续派发。

#### Scenario: JSON 预算和分页有不同语义
- **WHEN** 文本读取仅因请求 limit 停止，或工具数据因 JSON 字节预算被裁减
- **THEN** 正常分页 SHALL 使用 `has_more` 和可靠的 next_offset，且不单凭分页设置 truncated
- **AND** JSON 预算裁减 SHALL 显式设置 truncated 并只保留符合 schema 的完整数据
- **AND** 单项连同错误元数据都无法装入预算时 SHALL 返回有界的 `result_limit_exceeded`，不发送损坏 JSON

#### Scenario: ripgrep 不存在或读取失败
- **WHEN** ripgrep 启动失败、查询出错或文件读取失败
- **THEN** 返回 SHALL 明确区分工具失败与正常空结果
- **AND** 脚本 SHALL 能通过 `ok` 和 `error.code` 做有限的恢复分支
- **AND** 错误消息 SHALL 不含宿主凭据或无界堆栈
