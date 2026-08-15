## MODIFIED Requirements

### Requirement: 主 Agent 可同步委派只读调查任务
系统 SHALL 向主 Agent 暴露 `run_subagent` 工具，用于把一个非空任务同步委派给当前父 run 目录中的具名子 Agent。工具 schema SHALL 从当前 run 冻结的 Subagent 定义目录动态生成必填 `agent` enum，并在该参数描述中投影每个有效定义的 name与description；顶层工具描述 SHALL保持通用，不硬编码各子 Agent能力。调用 SHALL 在子 Agent 完成、失败或被取消前保持当前主 tool continuation；成功时外层 tool result SHALL 只包含子 Agent最终回答；已启动的子运行因非取消错误失败时，外层tool result SHALL保持失败状态并包含安全归一化诊断以及按`subagent-failure-handoff`能力生成的有界部分工作交接；尚未启动runtime的参数、目录或预算拒绝 MAY继续返回简短失败诊断。目录 SHALL始终包含内置`explorer`和`worker`，并 MAY包含合法的用户级与项目级自定义定义；系统 SHALL只允许单层委派，所有子 Agent SHALL NOT获得`run_subagent`工具。

#### Scenario: 委派任务成功
- **WHEN** 主 Agent 调用 `run_subagent` 并提交当前目录中的合法 `agent` 与非空 `task`
- **THEN** 系统 SHALL 启动所选具名子 Agent运行并等待其结束
- **THEN** 外层 `run_subagent` tool result SHALL标记成功并把子 Agent最终回答返回主 Agent
- **THEN** 主 Agent SHALL在取得该tool result后继续既有tool continuation

#### Scenario: 无效任务参数
- **WHEN** `run_subagent` 的 `task` 缺失、不是字符串或trim后为空
- **THEN** 系统 SHALL NOT启动子 Agent或发起provider请求
- **THEN** 系统 SHALL返回可供主 Agent修正调用的失败tool result

#### Scenario: Agent目录由本轮定义动态投影
- **WHEN** 系统为主 Agent构造 `run_subagent` tool definition
- **THEN** `agent`参数 SHALL为必填字符串且enum SHALL来自当前run冻结目录中的内置与有效自定义定义名称
- **THEN** `agent`参数描述 SHALL逐项包含定义自身的name和description
- **THEN** 未知、无效或被高优先级无效定义遮蔽的Agent名称 SHALL在启动子runtime前返回失败tool result

#### Scenario: 子 Agent 不能继续委派
- **WHEN** 系统为任一内置或自定义子 Agent创建provider-visible tool definitions
- **THEN** definitions SHALL NOT包含`run_subagent`
- **THEN** 伪造的嵌套`run_subagent`调用 SHALL在本地执行边界被拒绝

#### Scenario: 子 Agent 失败转为工具交接结果
- **WHEN** 子 Agent因provider、配置或内部执行错误失败，且父turn未被取消
- **THEN** 系统 SHALL生成`ok: false`的外层`run_subagent` tool result
- **THEN** 已启动runtime产生的失败结果 SHALL包含归一化诊断和基于已有运行事实生成的有界failure handoff
- **THEN** 失败 SHALL NOT作为未捕获异常直接终止主Agent loop
