## MODIFIED Requirements

### Requirement: 主 Agent 可同步委派只读调查任务
系统 SHALL 在主工具策略允许且当前可执行 Subagent 目录非空时向主 Agent 暴露 `run_subagent` 工具，用于把一个非空任务同步委派给当前父 run 目录中的具名子 Agent。工具 schema SHALL 从当前 run 冻结的 Subagent 定义目录动态生成必填 `agent` enum，并在该参数描述中投影每个有效定义的 name与description；顶层工具描述 SHALL保持通用，不硬编码各子 Agent能力。调用 SHALL 在子 Agent 完成、失败或被取消前保持当前主 tool continuation；成功时外层 tool result SHALL 包含子 Agent最终回答；对于 worktree Worker SHALL 另附系统生成的有界工作区交接（路径、基线、执行目录与未集成事实），其他子 Agent SHALL 保持只返回最终回答；已启动的子运行因非取消错误失败时，外层tool result SHALL保持失败状态并包含安全归一化诊断以及按`subagent-failure-handoff`能力生成的有界部分工作交接，worktree Worker SHALL 同时提供可定位的保留工作区路径或状态不可确认事实；尚未启动runtime的参数、目录或预算拒绝 MAY继续返回简短失败诊断。目录 SHALL 仅包含启用且有效的内置及自定义定义，内置 `explorer` 和 `worker` SHALL 与自定义名称一样受全局启停约束；目录为空时 SHALL 不注册该工具且 SHALL NOT 生成空 `agent` enum；系统 SHALL只允许单层委派，所有子 Agent SHALL NOT获得`run_subagent`工具。

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
- **THEN** `agent`参数 SHALL为必填字符串且enum SHALL来自当前 run 冻结目录中启用且有效的内置与自定义定义名称
- **THEN** `agent`参数描述 SHALL逐项包含定义自身的name和description
- **THEN** 未知、停用、无效或被高优先级无效定义遮蔽的 Agent 名称 SHALL在启动子runtime前返回失败tool result

#### Scenario: 子 Agent 不能继续委派
- **WHEN** 系统为任一内置或自定义子 Agent创建provider-visible tool definitions
- **THEN** definitions SHALL NOT包含`run_subagent`
- **THEN** 伪造的嵌套`run_subagent`调用 SHALL在本地执行边界被拒绝

#### Scenario: 子 Agent 失败转为工具交接结果
- **WHEN** 子 Agent因provider、配置或内部执行错误失败，且父turn未被取消
- **THEN** 系统 SHALL生成`ok: false`的外层`run_subagent` tool result
- **THEN** 已启动runtime产生的失败结果 SHALL包含归一化诊断和基于已有运行事实生成的有界failure handoff
- **THEN** 失败 SHALL NOT作为未捕获异常直接终止主Agent loop

#### Scenario: 全部 Agent 停用
- **WHEN** 所有内置与有效自定义 Agent 均全局停用
- **THEN** 主 registry 与 schema-only 工具投影 SHALL 不包含 `run_subagent`，且主运行 SHALL 仍能继续其他工作
- **THEN** 伪造的 `run_subagent` 调用 SHALL 在未注册工具边界被拒绝，不创建子 runtime

#### Scenario: Worker 工作区交接不要求新参数
- **WHEN** 主 Agent 使用既有 agent 与 task 参数完成一次 worktree Worker 委派
- **THEN** 外层结果 SHALL 包含最终报告、启动基线、工作区路径和待集成事实
- **THEN** 系统 SHALL NOT 自动把这些成果应用到父工作区

### Requirement: 子 Agent 使用独立业务 runtime、prompt 与隔离上下文
每次已接受的具名委派 SHALL通过runtime factory创建一个绑定所选定义的新Subagent loop runtime实例，SHALL NOT递归调用或复用父Agent的loop runtime实例。主Agent runtime与Subagent runtime SHALL作为同一runtime包中的两个独立业务入口，各自拥有provider continuation loop、工具执行编排、hook顺序和callback边界；系统 SHALL NOT通过`runtimeOptions.kind`或等价角色开关在同一个业务loop中切换主/子行为。二者 MAY共享不持有跨轮状态的provider context和结果投影函数，以及配置snapshot、hooks、debug、usage store等进程级依赖。定义 SHALL固定专属行为prompt、本地工具集合、MCP可见性和执行策略；Explorer SHALL保持独立只读prompt和MCP禁用，Worker SHALL使用通用任务prompt并可复用共享MCP manager。子Agent SHALL使用与父run相同配置revision、项目身份和适用项目指令、memory与skill catalog；实际 cwd 对 worktree Worker SHALL 使用受管执行目录，其他子 Agent SHALL 保持共享父 cwd，但 SHALL从只包含委派任务的独立transcript、空Todo和空compaction状态开始；Worker MAY随后在自身runtime创建Todo。系统 SHALL NOT自动复制父transcript、父Todo、父compaction或父journal路径。

子runtime SHALL使用专属子运行输入和callback协议，不接收完整主`AgentSessionInput`或把完整主`AgentCallbacks`作为自身业务接口。专属输入 SHALL只包含任务、子运行身份、父级取消/执行模式、所需的父interaction mode语义、模型选择、配置snapshot及系统决定的项目身份/工作区上下文；专属callback SHALL只表达子运行需要的reasoning、streaming、工具、审批、用户问题、完成和change recorder事件。端口 SHALL负责把这些事件桥接为父级稳定records、瞬时活动和共享交互surface。

#### Scenario: 每次委派创建新的 loop runtime
- **WHEN** 同一个父run先后接受两个合法`run_subagent`调用
- **THEN** runtime factory SHALL为两个调用分别创建新的Subagent loop runtime实例
- **THEN** 两个子运行 SHALL NOT共享provider continuation、record region、compaction、Todo或工具registry实例
- **THEN** 子运行 SHALL NOT通过父`RunAgent`的隐藏递归参数取得隔离上下文

#### Scenario: 主子 runtime 不共享业务 loop入口
- **WHEN** 系统装配主Agent和任一具名子Agent
- **THEN** 主Agent SHALL使用主loop runtime入口，子Agent SHALL使用独立Subagent loop runtime入口
- **THEN** 任一入口 SHALL NOT通过运行时角色开关进入另一个入口的provider、hook或callback流程

#### Scenario: 子 runtime 使用专属协议
- **WHEN** `SubagentToolPort`启动一个新的子runtime
- **THEN** 端口 SHALL传入专属子运行输入而不是伪造完整主会话
- **THEN** 子runtime SHALL只通过专属callback协议发布内部活动，端口再把活动翻译到父callbacks

#### Scenario: 共享模块不拥有运行身份语义
- **WHEN** 主/子runtime共同调用runtime共享模块
- **THEN** 共享函数 SHALL不读取primary、btw或具体Subagent名称来切换provider loop
- **THEN** 共享函数 SHALL不直接提交主/子transcript callback或lifecycle hook

#### Scenario: 子 Agent 请求包含定义专属行为 prompt
- **WHEN** 系统构造任一具名子Agent的首次provider请求
- **THEN** system context SHALL包含所选定义的专属行为和边界规则
- **THEN** 该规则 SHALL NOT仅依赖普通user message表达

#### Scenario: 子 Agent 不继承父 transcript
- **WHEN** 父会话已包含多轮user、assistant和tool records并启动子Agent
- **THEN** 子Agent初始对话records SHALL只包含当前委派任务
- **THEN** 子Agent SHALL通过其工具按需读取项目事实，而不是自动取得完整父transcript

#### Scenario: 子 Agent 保持运行配置一致性
- **WHEN** 子Agent在一个已启动的父assistant run中创建
- **THEN** 子Agent SHALL使用父run捕获的用户配置revision和项目身份，并使用系统决定的实际执行cwd
- **THEN** 父run期间发生的配置文件变化 SHALL NOT改变已经启动的子Agent

#### Scenario: 子 runtime 策略不能被 session 输入放宽
- **WHEN** 系统启动一个具名子runtime
- **THEN** 子runtime SHALL在创建边界固定所选定义的prompt、工具集合、MCP可见性和执行策略
- **THEN** 子session输入 SHALL NOT覆盖这些runtime级策略

#### Scenario: worktree 目录不重选项目配置
- **WHEN** Worker 执行目录位于项目外的受管 worktree
- **THEN** 子 runtime SHALL 继续使用父运行冻结的配置、AGENTS 和 Skill 作用域
- **THEN** 运行环境 SHALL 如实说明实际执行目录及不包含父未提交修改的基线
