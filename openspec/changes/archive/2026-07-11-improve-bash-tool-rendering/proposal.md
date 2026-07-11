## Why

当前 `run_bash_command` 的专属调用行会将多行命令拍平成带转义换行的 `Bash('...')` 文本。大模型通过 heredoc、`-c` 或 `-e` 执行内嵌脚本时，用户难以区分 shell 命令、脚本正文和执行输出，也难以快速确认实际执行内容。

## What Changes

- 将 `run_bash_command` 的可见投影改为专属的 rail 样式：调用标记位于左侧，命令区和结果区使用不同颜色的连续左侧 rail 区分。
- 保留多行命令的原始结构；对可安全识别的 heredoc 和长 `-c`/`-e` 内嵌脚本，分离 shell 头部与脚本正文并提供可计数折叠预览。
- 在完成态的调用标题中显示紧凑执行状态（成功、失败、超时、退出码和可用时的耗时）；pending 态显示运行状态。
- 保持结果区无冗余 `output`、`stdout` 或 `stderr` 标题；以 rail、文本颜色和原有结果顺序表达输出，并保留错误、超时和截断信息。
- 超时和截断状态只来自结构化 result 字段；stdout/stderr 的展示共用同一个输出行预算，避免两路输出各自突破上限。
- 让调用标记按完成状态使用成功或失败语义色，失败态的命令 rail 与标题也使用失败语义色；pending 调用保持弱化色。
- 为窄终端、解析失败、长命令和长输出定义安全降级与宽度约束，且不改变 transcript、工具结果或 provider continuation 内容。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tool-message-rendering`: 修改 bash 工具调用与结果在 transcript 及 pending 预览中的专属可见投影要求。

## Impact

- 影响 `src/render/tool-message-renderers/bash.ts`、`src/render/tool-message-renderer.ts` 及相关 transcript/footer 渲染测试。
- 可能复用现有 render theme 的 tool、success、error、muted 与 code 语义颜色，不新增运行时依赖、不改变工具 schema。
- `run_bash_command` 的原始 `argumentsText`、result text、执行元数据、持久化记录和 provider 输入保持不变。
