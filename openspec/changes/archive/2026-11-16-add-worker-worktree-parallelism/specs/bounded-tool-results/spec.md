## MODIFIED Requirements

### Requirement: 流式和长文本工具共享最终预算
`run_bash_command`、`read_files`、`web_fetch`、`web_search`、MCP 和 `run_subagent` SHALL 对最终格式化文本而非单个内容片段应用结果预算。可 offload 的工具 SHALL 返回有界预览，并在成功保存 artifact 时包含其路径。worktree Worker 的基线、工作区路径与未集成事实 SHALL 在同一最终预算内优先保留，再填充模型报告预览；报告 offload 失败 SHALL NOT 抹去工作区定位，无法完整容纳时 SHALL 保留可定位的工作区路径并说明省略。

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

#### Scenario: 长报告仍能看到工作区定位
- **WHEN** worktree Worker 的成功报告或失败交接超过结果预算
- **THEN** 最终结果 SHALL 在预算内保留基线、工作区路径与未集成事实，再截取报告正文
- **THEN** 父 Agent SHALL 无需重新运行 Worker 就能按工作区路径读取结果

#### Scenario: 报告 offload 失败不丢工作区入口
- **WHEN** 报告 artifact 写入失败但源 worktree 仍存在
- **THEN** 工具结果 SHALL 保留工作区路径并明确报告截断/存储失败
- **THEN** 系统 SHALL NOT 将报告 artifact 失败等同于工作区不存在
