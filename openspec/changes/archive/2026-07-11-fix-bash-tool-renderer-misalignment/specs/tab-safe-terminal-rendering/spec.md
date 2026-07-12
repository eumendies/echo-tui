## ADDED Requirements

### Requirement: 工具消息含制表符文本的稳定终端投影
系统 SHALL 在渲染 tool call、tool result、bash rail 和 footer pending tool preview 时，将制表符投影为与其当前可见列一致的空格，并使用同一投影计算显示宽度、自动换行和 safe render width。系统 SHALL 保留 transcript record、tool arguments、tool result text 和 provider-visible 内容中的原始制表符。

#### Scenario: bash 命令预览显示含制表符的脚本行
- **WHEN** `run_bash_command` tool call 的 command 包含以制表符缩进的逻辑行
- **THEN** bash rail renderer SHALL 按该逻辑行当前 rail 内容列展开制表符
- **THEN** 可见行 SHALL 保持正确 rail prefix 且 SHALL NOT 因 raw tab 产生未预算的终端自动换行
- **THEN** 原始 `argumentsText` 中的制表符 SHALL 保持不变

#### Scenario: bash 输出显示含制表符结果
- **WHEN** `run_bash_command` tool result 的 stdout 或 stderr 包含制表符
- **THEN** bash result rail SHALL 按当前内容列展开制表符并计算显示宽度
- **THEN** 每个可见结果行 SHALL 遵守 safe render width
- **THEN** 原始 tool result text SHALL 保持不变

#### Scenario: 通用工具消息显示含制表符文本
- **WHEN** 通用 tool call 或 tool result fallback 渲染包含制表符的文本
- **THEN** renderer SHALL 按当前 prefix 后的可见列展开制表符
- **THEN** renderer SHALL NOT 输出会让终端产生未预算额外物理行的 raw tab
- **THEN** transcript record SHALL 继续保存原始制表符
