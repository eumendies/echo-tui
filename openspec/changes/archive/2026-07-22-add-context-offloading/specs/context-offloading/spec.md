## ADDED Requirements

### Requirement: 超大工具结果转存到项目分区
系统 SHALL 对声明支持 context offloading 的文本工具结果应用有界预览。当该结果超过工具的模型可见预览上限时，系统 SHALL 把预览之外的完整已采集结果保存到用户级 echo_tui store 的当前项目分区，并 SHALL NOT 在当前工作区创建 offloading 文件。Offloading 文件路径 SHALL 唯一且可由现有本地文件读取工具访问。

#### Scenario: 超限结果成功转存
- **WHEN** 支持 offloading 的工具产生超过其模型可见预览上限的文本结果
- **THEN** 系统 SHALL 在当前 cwd 对应的用户级项目分区中保存完整已采集结果
- **THEN** 系统 SHALL 只把有界预览和 offloading 文件路径返回给模型
- **THEN** 系统 SHALL NOT 为保存结果而把完整输出同时保留在内存预览中

#### Scenario: 工作区不产生 offloading 文件
- **WHEN** 系统为任意工具结果创建 offloading 文件
- **THEN** 文件 SHALL 位于 `~/.echo/echo_tui/` 下的当前项目分区
- **THEN** 系统 SHALL NOT 在 cwd、项目级 `.echo` 或其他仓库路径中创建该文件

#### Scenario: Offloading 写入失败时安全降级
- **WHEN** 超限结果的 offloading 文件无法创建、写入或完成
- **THEN** 工具 SHALL 继续返回安全边界内的截断预览
- **THEN** 返回文本 SHALL NOT 包含不存在或未完成文件的路径
- **THEN** 写入失败 SHALL NOT 以未捕获异常中断 agent loop 或 shell command 收尾

### Requirement: 模型可见截断标记保持最小化
系统 SHALL 使用单一格式 `[tool result truncated: <absolute-path>]` 把成功创建的 offloading 文件告知模型。除原工具结果内容和该标记外，系统 SHALL NOT 为 context offloading 向模型可见结果添加 artifact id、大小、编码、完整性、预览策略或读取提示等额外字段。现有结构化 `truncated` 状态 SHALL 继续表示模型可见结果发生截断。

#### Scenario: 保留开头时标记位于尾部
- **WHEN** 某工具的预览策略为保留结果开头
- **AND** 该结果已成功写入 offloading 文件
- **THEN** 模型可见结果 SHALL 先包含结果开头，再以 `[tool result truncated: <absolute-path>]` 标记结束

#### Scenario: 保留尾部时标记位于开头
- **WHEN** 某工具的预览策略为保留结果尾部
- **AND** 该结果已成功写入 offloading 文件
- **THEN** 模型可见结果 SHALL 先包含 `[tool result truncated: <absolute-path>]` 标记，再包含结果尾部

#### Scenario: 模型按路径回读结果
- **WHEN** 模型收到包含有效 offloading 绝对路径的截断标记
- **THEN** 模型 SHALL 能使用现有 `read_files` 对该路径按行分页读取
- **THEN** 模型 SHALL 能使用现有 `grep` 在该路径中搜索文本

### Requirement: 工具使用语义化预览方向
系统 SHALL 由各工具选择适合自身结果语义的预览方向，而不是对所有工具统一保留开头。`run_bash_command` 和共享 runner 产生的 shell 输出 SHALL 保留尾部；`web_fetch`、`read_files` 的 PDF 已提取文本和普通 MCP 文本结果 SHALL 保留开头。

#### Scenario: Bash 结果保留尾部
- **WHEN** Bash 工具结果或 shell command 输出超过预览上限且 offloading 成功
- **THEN** 模型可见输出 SHALL 保留结果尾部
- **THEN** 截断标记 SHALL 位于所保留尾部之前

#### Scenario: Web Fetch 结果保留开头
- **WHEN** `web_fetch` 格式化文本超过预览上限且 offloading 成功
- **THEN** 模型可见输出 SHALL 保留格式化结果开头
- **THEN** 截断标记 SHALL 位于所保留开头之后

#### Scenario: MCP 文本结果默认保留开头
- **WHEN** MCP tool 的格式化文本结果超过预览上限且 offloading 成功
- **THEN** 模型可见输出 SHALL 保留格式化结果开头
- **THEN** 截断标记 SHALL 位于所保留开头之后

#### Scenario: PDF 已提取文本保留开头
- **WHEN** `read_files` 成功提取 PDF 文本且最终格式化结果超过模型可见上限
- **THEN** 模型可见结果 SHALL 保留 PDF 路径、页数等 metadata 和已提取文本开头
- **THEN** 截断标记 SHALL 位于所保留开头之后
- **THEN** offloading 文件 SHALL 保存应用模型可见上限前的完整已格式化结果

### Requirement: Offloading 不替代工具安全边界
Context offloading SHALL 只减少进入 transcript 和 provider context 的文本，不得取消工具现有的响应读取上限、进程输出硬上限、超时、取消、结果数量上限或媒体类型限制。未声明支持 offloading 的工具 SHALL 保持现有分页或收窄查询行为。

#### Scenario: Web 响应读取仍受硬上限保护
- **WHEN** `web_fetch` 响应 body 超过网络响应读取硬上限
- **THEN** handler SHALL 继续在该硬上限停止读取
- **THEN** offloading SHALL NOT 导致系统无限下载远端响应

#### Scenario: 搜索和文件工具保持现有边界
- **WHEN** `grep`、`glob`、`read_files` 或 `web_search` 达到现有分页、结果数量或输出限制
- **THEN** 工具 SHALL 保持现有 `has_more`、按范围读取或提示收窄查询的行为
- **THEN** 系统 SHALL NOT 为本变更默认收集其无限结果

#### Scenario: PDF 安全边界保持不变
- **WHEN** `read_files` 读取 PDF
- **THEN** handler SHALL 继续执行现有 PDF 文件大小限制
- **THEN** 文本提取 SHALL 继续在现有已提取内容硬上限停止
- **THEN** offloading SHALL NOT 启用 OCR、页面渲染或无限文本提取

