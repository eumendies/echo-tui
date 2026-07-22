## MODIFIED Requirements

### Requirement: Display shell output as message transcript
系统 SHALL 使用新的 shell transcript role 记录一次完整 shell execution，并以 message 风格展示命令、合并终端输出和退出状态，而不是以 tool call / tool result 风格展示。模型可见 shell ctx 输出超过共享 runner 上限时，系统 SHALL 保存完整已采集终端输出，并 SHALL 在最终 shell transcript 中记录统一截断路径标记和输出尾部。shell-local SHALL 不应用该上下文 offloading 上限，并 SHALL 把完整合并输出保存在本地 transcript/session 中。

#### Scenario: Render successful shell output
- **WHEN** 用户在 shell mode 执行成功且有输出的命令
- **THEN** transcript SHALL 显示 `$ <command>` 和按 stdout/stderr 到达顺序合并的终端输出
- **AND** transcript SHALL 不显示 `tool_call` 或 `tool_result` 样式

#### Scenario: Render non-zero exit
- **WHEN** 用户在 shell mode 执行退出码非 0 的命令
- **THEN** transcript SHALL 显示终端输出和轻量退出状态，例如 `[exit 1]`

#### Scenario: Render truncated shell ctx output
- **WHEN** shell ctx 命令输出超过共享 runner 的模型可见上限
- **AND** offloading 文件写入成功
- **THEN** transcript SHALL 在命令信息之后显示 `[tool result truncated: <absolute-path>]`
- **THEN** transcript SHALL 在该标记之后显示已捕获终端输出的尾部
- **THEN** 后续 shell ctx provider 投影 SHALL 使用相同的标记和尾部预览

#### Scenario: Preserve complete shell-local output
- **WHEN** shell-local 命令输出超过共享 runner 的模型可见上限
- **THEN** transcript 和持久化 session SHALL 保存完整合并输出
- **AND** shell record SHALL NOT 包含 offloading marker
- **AND** 该 shell record SHALL NOT 进入 provider context
