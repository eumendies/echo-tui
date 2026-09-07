# bounded-tool-results Specification

## Purpose
规定所有内置工具 handler 与 MCP adapter 在结果生成边界限制 provider-visible 文本，并按工具类别定义截断、分页、offload 与拒绝语义，使 compaction 只处理正常历史累积而非异常大原子记录。

## Requirements
### Requirement: 所有工具结果文本具有显式字节上限
系统 SHALL 由每个内置工具 handler 和 MCP adapter 在结果生成边界限制 provider-visible 文本，并按 UTF-8 字节计算完整结果的上限。成功、失败、取消、超时和异常路径 SHALL 使用相同的最终预算口径，且本能力 SHALL NOT 依赖统一的 `boundToolResult` 后处理器或 compaction 才满足上限。

#### Scenario: 成功结果不超过工具预算
- **WHEN** 任一工具成功生成超过其配置预算的文本结果
- **THEN** handler SHALL 在写入 transcript 前返回不超过该预算的有界结果

#### Scenario: 失败和异常结果同样受限
- **WHEN** 外部进程、文件系统、网络服务、MCP server 或 handler 异常产生超长错误信息
- **THEN** 返回给模型的完整失败文本 SHALL 不超过该工具的结果预算

#### Scenario: 多字节文本安全截断
- **WHEN** 结果在中文、emoji 或其他多字节 UTF-8 字符附近达到预算
- **THEN** 返回文本 SHALL 是合法 UTF-8，且其字节长度 SHALL 不超过预算

### Requirement: 默认文本预算按工具类别确定
系统 SHALL 对除 MCP 外的内置工具采用 65,536 UTF-8 bytes 的默认最终文本硬上限，并对 MCP 工具保留 20,000 UTF-8 bytes 的默认最终文本硬上限。截断说明、状态 header、分隔符和 artifact marker SHALL 计入对应最终上限。

#### Scenario: 默认内置工具预算
- **WHEN** 内置工具未通过测试用 handler 选项覆盖结果预算
- **THEN** 其完整 provider-visible 文本 SHALL 不超过 65,536 UTF-8 bytes

#### Scenario: MCP 默认预算
- **WHEN** MCP 工具返回成功内容或失败信息
- **THEN** 其完整 provider-visible 文本 SHALL 不超过 20,000 UTF-8 bytes

### Requirement: 条目型搜索同时执行条数和字节限制
`grep` 和 `glob` SHALL 在收集 ripgrep 输出时同时执行既有条目上限和最终输出字节上限，并在达到任一上限后终止子进程。结果文本和专属 display metadata SHALL 只包含已纳入预算的条目。

#### Scenario: grep 单条匹配过大
- **WHEN** `grep` 的一条匹配逻辑行无法完整放入剩余字节预算
- **THEN** 工具 SHALL 只保留该行能够安全放入预算的 UTF-8 前缀、标记结果已截断并停止搜索

#### Scenario: grep 多条匹配累计超限
- **WHEN** `grep` 在达到 100 条之前先达到字节预算
- **THEN** 工具 SHALL 返回预算内匹配、`has_more: true` 和字节上限提示，且 display 中不得保留被排除的完整匹配文本

#### Scenario: glob 路径累计超限
- **WHEN** `glob` 在达到 200 条路径之前先达到字节预算
- **THEN** 工具 SHALL 只返回预算内的完整路径、`has_more: true` 和字节上限提示

#### Scenario: ripgrep 输出缺少分隔符
- **WHEN** grep JSON line 或 glob NUL stream 的 pending 数据超过解析预算但尚未出现完整分隔符
- **THEN** 工具 SHALL 终止子进程并返回有界失败或截断结果，而不是继续无界累积内存

### Requirement: 流式和长文本工具共享最终预算
`run_bash_command`、`read_files`、`web_fetch`、`web_search`、MCP 和 `run_subagent` SHALL 对最终格式化文本而非单个内容片段应用结果预算。可 offload 的工具 SHALL 返回有界预览，并在成功保存 artifact 时包含其路径。

#### Scenario: Bash 双流累计超过预算
- **WHEN** Bash 的 stdout 和 stderr 各自低于 65,536 bytes 但格式化后的合计结果超过 65,536 bytes
- **THEN** 工具 SHALL 在状态字段和截断提示计入后共享同一预算，并优先保留输出尾部

#### Scenario: offload marker 计入预算
- **WHEN** 长结果被保存到 tool-result artifact
- **THEN** 预览、分隔符和 artifact marker 的总 UTF-8 字节数 SHALL 不超过工具预算

#### Scenario: artifact 写入失败
- **WHEN** 长结果超过预算且 artifact 无法写入
- **THEN** 工具 SHALL 返回预算内预览和固定截断提示，且不得回退为完整结果

#### Scenario: Web 所有失败尝试产生长摘要
- **WHEN** `web_search` 或 `web_fetch` 的失败原因累计超过结果预算
- **THEN** 失败结果 SHALL 被安全限制且保留可识别的失败状态

#### Scenario: 子 Agent 最终结果过大
- **WHEN** `run_subagent` 的成功回答或失败 handoff 超过结果预算
- **THEN** 父 Agent SHALL 只接收预算内预览和可用时的 artifact 路径

### Requirement: 指令型工具不得返回残缺指令
`use_skill` SHALL 在返回前验证由 skill 元数据、调用 arguments、完整 `SKILL.md` 和资源列表组成的最终 envelope。若完整结果超过预算，工具 SHALL 拒绝加载并返回有界迁移提示，而不是截断 skill 指令。

#### Scenario: Skill 正文超出预算
- **WHEN** 完整 skill envelope 超过 65,536 UTF-8 bytes
- **THEN** `use_skill` SHALL 返回失败、指出对应 source path，并提示可通过 `read_files` 的 offset/limit 分页读取该文件获取完整指令

#### Scenario: Skill 正文在预算内
- **WHEN** 完整 skill envelope 未超过预算
- **THEN** `use_skill` SHALL 返回完整且未经截断的 skill 指令

### Requirement: 结构化工具结果保持完整格式
Todo 和 `ask_user_questions` SHALL 通过限制单字段及聚合输入大小保证结果有界。其成功、取消和失败结果在返回 JSON 时 SHALL 保持语法完整，不得直接截断序列化后的 JSON 字符串。

#### Scenario: Todo 文本输入过大
- **WHEN** Todo 单项或所有 Todo 文本的 UTF-8 聚合大小超过对应限制
- **THEN** 工具 SHALL 拒绝状态更新并返回有界错误，不得把超限文本写入 Todo 状态

#### Scenario: 问题定义过大
- **WHEN** 问题、选项或描述超过单字段或聚合限制
- **THEN** `ask_user_questions` SHALL 在打开交互 surface 前拒绝该调用

#### Scenario: 自定义回答达到上限
- **WHEN** 用户在问题交互中输入超过允许大小的自定义回答
- **THEN** 交互控制器 SHALL 阻止继续增长或明确拒绝提交，并保证最终 tool result 是预算内的合法 JSON

### Requirement: 文件编辑工具的摘要和错误有界
`apply_patch` 和 `edit_file` SHALL 对成功摘要、文件路径、解析提示和文件系统错误应用最终文本预算，同时保留现有 patch、源文件、文件数量和 hunk 输入边界。

#### Scenario: 文件系统错误包含超长内容
- **WHEN** 文件编辑失败原因或 hint 使格式化结果超过预算
- **THEN** 工具 SHALL 返回预算内、结构可识别的失败摘要

#### Scenario: 成功结果包含大量或超长路径
- **WHEN** 文件编辑成功摘要中的路径累计接近结果预算
- **THEN** 工具 SHALL 返回预算内的路径摘要并明确指示存在未展示项

### Requirement: 图片附件具有单项和聚合上限
`read_files` SHALL 保留单张最终图片 5,000,000 bytes 的限制，并对一次调用返回的全部图片附件实施 10,000,000 bytes 聚合上限。超过剩余聚合预算的图片 SHALL NOT 进入 provider attachments。

#### Scenario: 多张图片累计超限
- **WHEN** 多张图片分别满足单图限制但累计超过 10,000,000 bytes
- **THEN** `read_files` SHALL 按请求顺序只附加预算内图片，并在文本结果中报告其余图片被跳过及结果已截断

#### Scenario: 图片自动压缩后满足预算
- **WHEN** 图片经自动压缩后同时满足单图上限和本次调用剩余聚合预算
- **THEN** 工具 SHALL 返回完整压缩附件并正确计入聚合大小

### Requirement: 截断结果提供可执行的后续指引
工具定义和截断结果 SHALL 根据工具能力提示模型通过分页、收窄查询、分批读取、分页读取 skill 源文件或读取 artifact 获取更多内容，并 SHALL 区分空结果与因预算而未完整返回的结果。

#### Scenario: 搜索因预算截断
- **WHEN** grep 或 glob 因字节预算提前结束
- **THEN** 结果 SHALL 明确设置 `has_more: true` 并提示收窄查询范围

#### Scenario: 可分页读取因预算截断
- **WHEN** read_files 或网络读取结果因预算截断
- **THEN** 结果 SHALL 提供可用的 offset/limit 或 artifact 后续方式

