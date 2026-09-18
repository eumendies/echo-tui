## MODIFIED Requirements

### Requirement: Shell command live output preview
系统 SHALL 在 shell mode 命令运行期间即时展示命令与命令产生的终端输出，而不是只显示 spinner 等待最终结果。命令提交后的首个投影 SHALL 立即把 `$ <command>`（shell-local 追加 ` [local]`）确定到终端历史区；运行期间的终端输出 SHALL 由与 thinking/working 动效共享的 activity tick 增量确定到终端历史区，footer pending preview SHALL 只保留尚未确定的尾部。

#### Scenario: Echo command before first output
- **WHEN** 用户在 shell mode 提交命令且命令尚未产生任何输出
- **THEN** 系统 SHALL 在首个投影中把命令行写入终端历史区
- **THEN** status line SHALL 显示 working activity
- **THEN** 系统 SHALL NOT 等待第一个输出 chunk 才展示命令

#### Scenario: Show output before command completes
- **WHEN** 用户在 shell mode 执行一个尚未结束但已经产生 stdout 或 stderr 的命令
- **THEN** 系统 SHALL 在命令完成前把已稳定的完整输出行确定到终端历史区
- **THEN** footer MAY 保留尚未确定的尾部 preview
- **THEN** status line SHALL 继续显示 working activity

#### Scenario: Keep transcript append-only during live output
- **WHEN** shell 命令仍在运行且产生多个输出 chunk
- **THEN** 系统 SHALL 只更新运行期投影与 pending 状态
- **THEN** 系统 SHALL NOT 为每个输出 chunk 追加 transcript record

#### Scenario: Commit final shell transcript after completion
- **WHEN** shell 命令完成
- **THEN** 系统 SHALL 清除 live output preview
- **THEN** 系统 SHALL 追加一条完整 shell transcript record，包含最终捕获的合并终端输出和退出状态

### Requirement: Shell live output rendering
系统 SHALL 使用 shell 专用纯文本渲染展示运行期 shell 投影（终端历史区的增量确定投影与 footer 未确定尾部），避免把命令输出当作 assistant Markdown 流式响应处理。已确定投影 SHALL 使用与最终 shell record 展示相同的文本净化口径；footer 未确定尾部 SHALL 保留原始 CR 以维持进度类输出的既有播放语义。

#### Scenario: Render shell output without Markdown interpretation
- **WHEN** shell live output 或在终端历史区的已确定投影包含 Markdown 标记、表格文本或代码 fence 字符
- **THEN** 系统 SHALL 按原始纯文本 shell 输出展示
- **AND** 系统 SHALL NOT 使用 assistant streaming 的 Markdown 渲染样式

#### Scenario: Bound long uncommitted tail preview
- **WHEN** shell 未确定尾部行数超过 footer 可显示高度
- **THEN** 系统 SHALL 限制 preview 占用高度
- **AND** 系统 SHALL 显示最新输出尾部和隐藏内容摘要

#### Scenario: Committed projection uses record sanitization
- **WHEN** shell 输出包含 CR 或 CRLF 并进入终端历史区
- **THEN** 已确定投影 SHALL 使用与最终 shell record 展示相同的净化口径
- **AND** footer 未确定尾部 SHALL 继续保留原始 CR 语义

### Requirement: Shell live output context policy
系统 SHALL 保持 shell ctx/local 策略只作用于最终 shell transcript 的 provider context 投影，不因运行期输出投影（终端历史区增量确定与 footer 尾部）改变模型上下文边界。

#### Scenario: Local live output stays local
- **WHEN** 当前为 shell local 子状态且命令运行中产生 live output
- **THEN** 系统 SHALL 在本地终端历史区与 footer 中显示输出
- **AND** 系统 SHALL NOT 将运行中的输出发送给模型
- **AND** 命令完成后的 shell transcript SHALL 继续标记为不进入模型上下文

#### Scenario: Included shell output enters context only after completion
- **WHEN** 当前为 shell ctx 子状态且命令运行中产生 live output
- **THEN** 系统 SHALL 在运行中仅本地显示（终端历史区增量确定与 footer 尾部）
- **AND** 系统 SHALL 仅在命令完成并追加最终 shell transcript 后，允许该最终记录进入后续 provider context

## ADDED Requirements

### Requirement: Shell live output 增量确定到终端历史区
系统 SHALL 把 shell mode 运行期输出按稳定行边界增量确定到终端历史区：确定边界 SHALL 落在与最终 shell record 展示相同的净化文本的完整行边界上；footer pending preview SHALL 只从该边界之后继续展示原始输出尾部。每个 activity tick 的确定 SHALL 与 footer 重绘合并为同一次终端写入，单个输出 chunk SHALL NOT 直接触发额外终端写入。命令完成、中断或失败 SHALL 只追加一条 `shell` record，renderer SHALL 补写尚未确定的后缀投影，使分批写入的投影拼接 SHALL 等于一次性渲染最终 record block 的投影。destructive recovery SHALL 按当前宽度把 records 与 shell in-flight 投影（已 echo 命令行与已确定输出）一并重投影，且 SHALL NOT 重复或丢失已确定文本。

#### Scenario: Commit complete lines per activity tick
- **WHEN** 命令产生至少一行的输出且 activity tick 触发
- **THEN** 系统 SHALL 把新增的已稳定完整行确定到终端历史区
- **THEN** footer SHALL 只保留未确定尾部
- **THEN** 该次确定与 footer 重绘 SHALL 合并为同一次终端写入

#### Scenario: Keep incomplete last line in footer
- **WHEN** 输出的最后一行尚未以换行结束
- **THEN** 系统 SHALL NOT 把该行确定到终端历史区
- **THEN** 该行 SHALL 继续由 footer 展示，并保留 CR 覆盖语义

#### Scenario: Completion append equals one-shot render
- **WHEN** shell 命令正常完成、中断或失败并追加最终 shell record
- **THEN** 系统 SHALL 补写尚未确定的后缀投影并恰好追加一次 record 尾部 spacer
- **THEN** 分批投影拼接 SHALL 等于一次性渲染该 record block 的投影

#### Scenario: ctx offload keeps committed head and appends final projection
- **WHEN** shell ctx 输出超过共享 runner 上限并触发 offload，且运行期已确定部分头部输出
- **THEN** completion SHALL 按最终 record 的投影（marker + 尾部 + 尾注）补写剩余部分
- **THEN** 已确定头部行 SHALL 保留为运行期投影
- **THEN** 系统 SHALL NOT 重复命令行，也 SHALL NOT 删除已写入历史区的行

#### Scenario: destructive recovery keeps commit cursor
- **WHEN** 命令仍在运行且 columns 变化或其他 destructive recovery 触发
- **THEN** 系统 SHALL 按新宽度重投影 records 与 shell in-flight 投影
- **THEN** 后续 activity tick SHALL 从同一确定水位继续增量确定
- **THEN** 系统 SHALL NOT 重复或丢失已确定文本

#### Scenario: Non-visible owner does not commit
- **WHEN** shell 命令运行期间当前可见投影不是 main
- **THEN** 系统 SHALL NOT 把 shell 投影写入终端历史区
- **THEN** 恢复 main 投影时 SHALL 由 destructive recovery 重建 shell in-flight 投影与 pending 尾部
