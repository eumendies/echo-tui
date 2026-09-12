## MODIFIED Requirements

### Requirement: 工具调用并发分类
判断工具调用能否与相邻只读调用重叠执行；未知或无法证明只读的调用一律独占。`read_files`、`glob`、`grep`、`web_fetch`、`web_search`、`use_skill` SHALL 分类为 `parallel_read`。`run_bash_command` SHALL 按严格只读 Bash 策略判定：命中只读 allowlist 为 `parallel_read`，否则 `exclusive`。`run_subagent` SHALL 在调用参数可解析为目标 readonly executionPolicy subagent 时分类为 `parallel_read`；参数 JSON 解析失败、agent 名称未知或目标为 general_purpose 时 SHALL 分类为 `exclusive`。其余工具一律 `exclusive`。分类器 SHALL 通过注入的只读 subagent 名称谓词获取策略，不携带目录依赖。

#### Scenario: 观察工具保持并行分类
- **WHEN** 分类器收到 `grep`、`read_files`、`glob`、`web_fetch`、`web_search` 或 `use_skill` 调用
- **THEN** 分类结果 SHALL 为 `parallel_read`

#### Scenario: 只读 Bash 与风险 Bash 分类不变
- **WHEN** 分类器收到只读 allowlist 内外的 `run_bash_command` 调用
- **THEN** 前者 SHALL 为 `parallel_read`，后者 SHALL 为 `exclusive`

#### Scenario: 只读子 Agent 委派并行分类
- **WHEN** 分类器收到 `agent` 参数指向 readonly executionPolicy subagent 的 `run_subagent` 调用
- **THEN** 分类结果 SHALL 为 `parallel_read`

#### Scenario: 未知或解析失败的委派保持独占
- **WHEN** `run_subagent` 参数不是合法 JSON object、`agent` 名称不在目录中，或目标为 general_purpose
- **THEN** 分类结果 SHALL 为 `exclusive`

#### Scenario: 无委派目录的运行保持独占
- **WHEN** 当前运行没有注入 subagent 委派目录
- **THEN** 所有 `run_subagent` 调用 SHALL 分类为 `exclusive`
