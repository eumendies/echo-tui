## 1. Bash 命令投影建模

- [x] 1.1 提取并验证 bash `command` 参数，保留无效参数到通用 renderer 的降级路径。
- [x] 1.2 实现保守的 heredoc 与长 `-c`/`-e` 命令解析，保留完整 shell 前置上下文并在不确定时原样显示。
- [x] 1.3 为命令、内嵌脚本和结果建立独立的逻辑行展示预算与可计数省略行。

## 2. Rail 专属渲染

- [x] 2.1 实现基于现有 theme 语义 token 的 bash 命令 rail、结果 rail 与窄宽度安全换行。
- [x] 2.2 为相邻匹配的 bash call/result 接入 pair-aware renderer，并在标题中投影退出状态、耗时、超时和截断信息。
- [x] 2.3 更新 pending bash 调用预览，使其使用 rail 结构和运行中状态。
- [x] 2.4 处理 stdout、stderr、无输出、失败、超时和截断结果；移除冗余的通用 `output` 标题。

## 3. 测试与验证

- [x] 3.1 更新 transcript renderer 测试，覆盖成功、失败、stdout/stderr 并存、无效参数降级和原始记录不变。
- [x] 3.2 增加 heredoc、长 `-c`/`-e`、复杂命令降级、脚本折叠、窄宽度与自定义 theme 的 rail 渲染测试。
- [x] 3.3 更新 footer pending 预览测试，并运行类型检查、全量测试、JavaScript 语法检查和 diff 空白检查。

## 4. Rail 状态与连续结果输出调整

- [x] 4.1 让 bash 调用标记按成功、失败和 pending 状态使用对应 theme 语义色。
- [x] 4.2 移除 stdout/stderr 结果标题，保留 rail 分段和 stderr 错误色。
- [x] 4.3 更新状态颜色和无通道标题测试，并重新运行完整验证。
- [x] 4.4 让失败态的命令 rail 和标题使用 error 语义色，并补充验证。

## 5. Review 修复

- [x] 5.1 移除 bash 状态的输出文本推断，只使用结构化超时和截断字段。
- [x] 5.2 按 shell heredoc 规则修正 `<<` 与 `<<-` 的闭合分隔符匹配。
- [x] 5.3 合并 stdout/stderr 结果展示预算，并补充回归测试与验证。
