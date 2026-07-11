## MODIFIED Requirements

### Requirement: bash command structure and embedded script preview
系统 SHALL 从有效 bash call arguments 的原始 `command` 字符串投影命令结构。普通多行命令 SHALL 保留其逻辑行和缩进；视觉换行 SHALL NOT 伪造 shell 续行符。系统 SHALL 对边界可安全识别的 heredoc 和长 `-c`/`-e` 内嵌脚本分别显示 shell 头部与脚本正文，并对超出展示预算的脚本显示可计数省略行。`-c`/`-e` 内嵌脚本解析 SHALL NOT 将匹配点之前或之后的多行 shell 上下文合并为单个 renderer row；当无法把 inline script 边界安全限定在单个 shell 逻辑行或整个 command 内时，renderer SHALL 回退为普通多行命令投影。

#### Scenario: heredoc 保留 shell 前置上下文
- **WHEN** bash 命令包含 heredoc marker 之前的多行 shell 前置命令和一个闭合 heredoc 正文
- **THEN** renderer SHALL 显示从命令起始到 marker 的完整 shell 头部
- **THEN** renderer SHALL 将 heredoc 正文作为逐逻辑行的脚本预览显示
- **THEN** 超出脚本展示预算的正文 SHALL 显示隐藏逻辑行数量

#### Scenario: 无法安全拆分的复杂命令
- **WHEN** bash 命令包含无法可靠识别边界的引用、转义或命令替换
- **THEN** renderer SHALL 不拆分或省略命令片段
- **THEN** renderer SHALL 将原始命令按显示宽度安全换行显示

#### Scenario: 长内嵌脚本受限显示
- **WHEN** 可识别的 heredoc 或 `-c`/`-e` 脚本超过脚本展示预算
- **THEN** renderer SHALL 显示预算内的脚本逻辑行
- **THEN** renderer SHALL 显示包含隐藏逻辑行数量的省略提示

#### Scenario: 多行 shell 命令中的 inline script 不吞并上下文
- **WHEN** bash 命令包含多个 shell 逻辑行
- **AND** 其中一行包含 `node -e "..."`、`python -c "..."` 或等价的 `-c`/`-e` inline script 调用
- **AND** inline script 匹配点之前或之后仍存在其他 shell 逻辑行
- **THEN** renderer SHALL 保留这些 shell 逻辑行的独立投影顺序
- **THEN** renderer SHALL NOT 将匹配点前后的 shell 文本合并为单个包含原始换行符的 renderer row
- **THEN** footer pending preview 和 transcript rail SHALL 为每条可见 shell 行保留正确 rail prefix 或 continuation prefix

### Requirement: bash renderer layout safety and record preservation
bash 专属 renderer SHALL 只改变终端可见投影，不得改变 transcript record、tool result、provider continuation 或持久化内容。命令、脚本和结果的每一可见行 SHALL 遵守 safe render width；每一返回给 transcript 或 footer 的可见行 SHALL 是单物理行安全投影，不得包含原始 `\n`、`\r` 或会让终端产生未预算额外物理行的未展开控制字符。无法解析有效 `command` arguments 的记录 SHALL 降级到通用 tool renderer。

#### Scenario: 窄终端中的 rail 投影
- **WHEN** terminal width 较窄，且 bash 命令、脚本行或结果行超过可用宽度
- **THEN** renderer SHALL 按 safe render width 换行或截断内容并按需省略非必要状态细节
- **THEN** renderer SHALL NOT 输出超过 safe render width 的可见行

#### Scenario: 原始工具事实保持不变
- **WHEN** bash call 或 result 被 rail renderer 投影
- **THEN** 原始 `argumentsText`、result text、退出码、耗时、超时和截断字段 SHALL 保持不变
- **THEN** provider continuation SHALL 接收原始 tool result 而不是渲染后的 rail 文本

#### Scenario: 无效调用参数降级
- **WHEN** `run_bash_command` tool call 的 argumentsText 不是包含非空 `command` 字符串的有效 JSON object
- **THEN** renderer SHALL 降级到通用 tool call renderer
- **THEN** renderer SHALL NOT 抛出异常或中断 transcript 渲染

#### Scenario: renderer 返回行不包含原始换行或回车
- **WHEN** bash call、bash call/result 对或 bash pending preview 包含多行 command、长 inline script 或多行 stdout/stderr
- **THEN** renderer 返回的每个可见行元素 SHALL NOT 包含原始 `\n` 或 `\r`
- **THEN** 每个可见行元素的显示宽度 SHALL 小于或等于当前 safe render width
- **THEN** footer 局部重绘 SHALL 能按返回行数量清理 pending preview，而不会遗留重复的旧 `Bash · running` 块
