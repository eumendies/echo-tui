## MODIFIED Requirements

### Requirement: Worker 可执行自包含通用子任务
系统 SHALL 在内置 Subagent 定义目录中提供 `worker`，并 SHALL 与其他名称一样应用 `subagent-enablement` 全局启停规则。仅当 Worker 全局启用且处于本轮冻结的可执行目录、并且主工具策略允许委派时，主 Agent SHALL 能通过 `run_subagent` 把一个自包含通用任务同步交给 Worker，并在 Worker 完成、失败或取消后取得外层 tool result。Worker SHALL 使用专属行为 prompt，只完成被委派任务、遵守适用项目指令、在受阻时向父 Agent 报告，不得接管父任务或继续委派。

#### Scenario: 主 Agent 委派 Worker
- **WHEN** Worker 在本轮可执行目录中且主工具策略允许委派，主 Agent 调用 `run_subagent` 并提交 `agent: worker` 与非空 `task`
- **THEN** 系统 SHALL 创建一个绑定 Worker 定义的独立 Subagent runtime 并等待其结束
- **THEN** 成功的外层 tool result SHALL 返回 Worker 最终报告供主 Agent 继续既有 continuation

#### Scenario: Worker 不能继续委派
- **WHEN** 系统为 Worker 构造 provider-visible 和 executable registry
- **THEN** registry SHALL NOT 包含 `run_subagent`
- **THEN** 伪造的嵌套委派调用 SHALL 在本地执行边界失败

#### Scenario: 内置 Worker 停用不享有例外
- **WHEN** Worker 在本轮全局停用，provider 仍请求委派 Worker
- **THEN** 调用 SHALL 在创建子 runtime、发布子运行 start、子任务审批或子 provider 请求之前失败
- **THEN** 系统 SHALL NOT 因为 Worker 是内置 Agent 或主运行使用 full-access 而忽略停用
