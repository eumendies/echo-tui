# readonly-subagent-delegation Specification

## Purpose
定义主 Agent 通过具名只读子 Agent 执行隔离调查、工具审批和 headless 安全边界的行为。
## Requirements
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

### Requirement: 子 Agent委派复用普通工具执行边界
`run_subagent` SHALL 作为普通 `ToolHandler` 注册，并 SHALL 通过现有 `ToolRegistry` 和 `ToolExecutor` 完成 handler查找、JSON object参数解析、执行和失败归一化。Handler SHALL 只依赖注入的窄 `SubagentToolPort` 列出可用定义并按名称请求本轮嵌套运行，SHALL NOT 直接依赖具体子 Agent定义、`AppContext`、renderer、transcript store或具体 provider adapter。交互式与 headless入口 SHALL 复用同一 handler；TUI观察和持久化能力 SHALL 通过可选 run callbacks连接，headless缺少这些 callbacks时 SHALL 仍能返回最终 tool result。

#### Scenario: 普通 executor 调用子 Agent handler
- **WHEN** 主 Agent产生合法 `run_subagent` tool call
- **THEN** ToolExecutor SHALL 按名称取得已注册的普通 handler并将解析后的参数交给它
- **THEN** agent loop SHALL NOT 通过硬编码 tool name绕过 registry或 executor

#### Scenario: Handler 通过窄端口运行子 Agent
- **WHEN** `run_subagent` handler执行合法的 agent名称与任务
- **THEN** handler SHALL 通过注入的 `SubagentToolPort` 请求嵌套运行
- **THEN** Port SHALL按名称解析定义，并由定义提供 description、prompt和工具 allowlist的唯一事实来源
- **THEN** handler SHALL NOT 直接读取或修改 AppContext成员

#### Scenario: Headless 复用同一 handler
- **WHEN** `--once` 路径的主 Agent调用 `run_subagent`
- **THEN** 系统 SHALL 使用与TUI相同的 ToolHandler参数与结果协议
- **THEN** 缺少app观察callback SHALL NOT 阻止严格只读子任务成功返回结果

### Requirement: 长任务工具过程记录与外层工具对保持顺序一致
工具执行边界 SHALL 支持 handler声明是否在执行期间发布本地 transcript records。发布本地过程的 handler SHALL 使用通用延迟成对提交模式：过程 records先按发生顺序进入父 runtime与app transcript，外层 tool call/result在执行结束后成对追加。该能力 SHALL 基于 handler契约或执行元数据，而 SHALL NOT 基于 `run_subagent` 工具名硬编码。普通不发布过程的工具 SHALL 保持既有执行和持久化行为。

#### Scenario: 子 Agent过程先于外层工具对提交
- **WHEN** `run_subagent` handler执行期间发布一个或多个subagent records并最终返回结果
- **THEN** runtime record region和app transcript SHALL 以相同顺序包含过程records及其后的外层call/result pair
- **THEN** compaction使用的物理record索引 SHALL 与持久化transcript保持一致

#### Scenario: 崩溃前不保存孤立外层call
- **WHEN** 发布过程records的handler尚未返回结果且进程意外结束
- **THEN** journal MAY包含已经稳定提交的本地过程records
- **THEN** journal SHALL NOT 因该执行模式包含孤立的外层tool call

#### Scenario: 普通工具行为不变
- **WHEN** 一个不发布本地过程records的普通handler执行
- **THEN** 系统 SHALL 沿用现有tool call/result continuation、审批和持久化语义
- **THEN** 该handler SHALL NOT 被迫创建SubagentToolPort或subagent records

### Requirement: 子 Agent 使用独立业务 runtime、prompt 与隔离上下文
每次已接受的具名委派 SHALL通过runtime factory创建一个绑定所选定义的新Subagent loop runtime实例，SHALL NOT递归调用或复用父Agent的loop runtime实例。主Agent runtime与Subagent runtime SHALL作为同一runtime包中的两个独立业务入口，各自拥有provider continuation loop、工具执行编排、hook顺序和callback边界；系统 SHALL NOT通过`runtimeOptions.kind`或等价角色开关在同一个业务loop中切换主/子行为。二者 MAY共享不持有跨轮状态的provider context和结果投影函数，以及配置snapshot、hooks、debug、usage store等进程级依赖。定义 SHALL固定专属行为prompt、本地工具集合、MCP可见性和执行策略；Explorer SHALL保持独立只读prompt和MCP禁用，Worker SHALL使用通用任务prompt并可复用共享MCP manager。子Agent SHALL使用与父run相同配置revision、cwd和适用项目指令、memory与skill catalog，但 SHALL从只包含委派任务的独立transcript、空Todo和空compaction状态开始；Worker MAY随后在自身runtime创建Todo。系统 SHALL NOT自动复制父transcript、父Todo、父compaction或父journal路径。

子runtime SHALL使用专属子运行输入和callback协议，不接收完整主`AgentSessionInput`或把完整主`AgentCallbacks`作为自身业务接口。专属输入 SHALL只包含任务、子运行身份、父级取消/执行模式、所需的父interaction mode语义、模型选择和配置snapshot；专属callback SHALL只表达子运行需要的reasoning、streaming、工具、审批、用户问题、完成和change recorder事件。端口 SHALL负责把这些事件桥接为父级稳定records、瞬时活动和共享交互surface。

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
- **THEN** 子Agent SHALL使用父run捕获的用户配置revision和当前cwd
- **THEN** 父run期间发生的配置文件变化 SHALL NOT改变已经启动的子Agent

#### Scenario: 子 runtime 策略不能被 session 输入放宽
- **WHEN** 系统启动一个具名子runtime
- **THEN** 子runtime SHALL在创建边界固定所选定义的prompt、工具集合、MCP可见性和执行策略
- **THEN** 子session输入 SHALL NOT覆盖这些runtime级策略

### Requirement: 子 Agent 只看到专属工具目录
系统 SHALL 在 provider adapter 创建前为 `explorer` 构造真实裁剪后的工具 registry，而不是只在执行时拒绝主 Agent 工具。第一版 registry SHALL 只包含 `read_files`、`glob`、`grep`、`run_bash_command`、`web_fetch`、`web_search` 和 `use_skill`；SHALL NOT 包含 `apply_patch`、`edit_file`、Todo、`ask_user_questions`、MCP 或其他未列入 allowlist 的工具。执行边界 SHALL 再次按同一 allowlist 校验工具名，防止伪造调用绕过 provider-visible schema。

#### Scenario: Provider 只接收 allowlist 工具
- **WHEN** 系统构造 `explorer` provider 请求
- **THEN** tool definitions SHALL 只包含子 Agent allowlist 中的工具
- **THEN** tool definitions SHALL NOT 因主 registry 存在 MCP 或写入工具而包含它们

#### Scenario: 执行边界拒绝未允许工具
- **WHEN** 子 Agent provider 返回一个不在 allowlist 中的 tool call
- **THEN** 系统 SHALL NOT 执行对应 handler
- **THEN** 系统 SHALL 生成失败 tool result 并允许子 Agent 根据反馈继续或结束

### Requirement: 子 Agent Bash 使用严格只读或共享审批策略
子 Agent 的 `run_bash_command` SHALL 使用不继承父级 interaction mode 的固定 fail-closed 分类。命中现有严格只读 Bash allowlist 的命令 SHALL 直接执行；interactive环境下任何无法证明为严格只读的命令 SHALL 在执行前进入与主 Agent相同的审批流程。主 Agent和子 Agent SHALL 共享 allow-all、tool和精确 Bash command会话授权缓存，SHALL NOT按 Agent来源分区；缓存未命中时 SHALL沿用当前 manual或auto设置。人工 surface SHALL 标明请求来自 `explorer`并提供现有完整审批语义。用户允许后系统 MAY执行该 Bash命令；无法追踪其副作用时 SHALL沿用现有 change history失效语义。headless环境下此类子 Agent命令 SHALL直接拒绝。

#### Scenario: 严格只读 Bash 直接执行
- **WHEN** 子 Agent 调用 `run_bash_command`，且 command 命中严格只读 allowlist
- **THEN** 系统 SHALL 直接执行该命令
- **THEN** 系统 SHALL NOT 请求自动审批模型或显示人工 permission surface

#### Scenario: 未知或可能写入的 Bash 请求人工审批
- **WHEN** interactive环境中的子 Agent 调用 `run_bash_command`，且 command 未命中严格只读 allowlist
- **THEN** 系统 SHALL 先查询与主 Agent共用的会话授权缓存，再按当前 manual或auto设置解析审批
- **THEN** 需要人工确认时 surface SHALL标明 `explorer`来源并显示 command preview和现有完整选项

#### Scenario: 子 Agent审批写入共享会话授权
- **WHEN** 子 Agent Bash permission surface活跃且用户选择精确 command会话授权或 allow-all会话授权
- **THEN** 系统 SHALL把决定写入与主 Agent共用的 `ToolApprovalContext`缓存
- **THEN** 后续匹配的主 Agent或子 Agent调用 SHALL复用该授权而不再次打开 surface
- **THEN** 真实 Bash结果 SHALL返回发起当前调用的 Agent

#### Scenario: 用户拒绝或反馈
- **WHEN** 子 Agent Bash permission surface 活跃且用户拒绝、按 Esc 或提交反馈
- **THEN** 系统 SHALL NOT 执行该 command
- **THEN** 子 Agent SHALL 收到保留原 call id 的失败 tool result
- **THEN** 提交反馈时失败结果 SHALL 包含用户反馈文本

#### Scenario: 父级 mode 不改变固定审批规则
- **WHEN** interactive父 turn 处于任一 interaction mode且子 Agent请求未命中严格只读 allowlist的 Bash command
- **THEN** 系统 SHALL使用相同的共享审批和会话缓存流程
- **THEN** 子 runtime SHALL NOT 接收或判断父级 interaction mode

#### Scenario: Headless 模式无法人工升级
- **WHEN** headless 父 run 中的子 Agent 请求未命中严格只读 allowlist 的 Bash command
- **THEN** 系统 SHALL 返回需要交互式人工审批的失败 tool result
- **THEN** 系统 SHALL NOT 等待 stdin，也 SHALL NOT 因父 run 使用 full-access 而静默放行该子 Agent command

### Requirement: 子 Agent 委派预算与父级取消
系统 SHALL 为每个父 agent run 最多接受四次 `run_subagent` 委派。超过委派预算的调用 SHALL 以失败 tool result 结束。子 Agent SHALL 沿用主 Agent相同的 provider continuation 语义，不设置子 Agent专属 provider turn 上限。父 assistant turn 的取消信号 SHALL 传播到正在等待的子 Agent provider 请求和 Bash 进程；父级取消 SHALL 继续按主 turn 中断语义收尾，而不是转换成普通子 Agent失败结果。

#### Scenario: 父 run 超过委派次数预算
- **WHEN** 同一个父 agent run 已经接受四次子 Agent 委派后再次调用 `run_subagent`
- **THEN** 系统 SHALL NOT 启动第五个子 Agent
- **THEN** 系统 SHALL 返回预算耗尽的失败 tool result

#### Scenario: Esc 取消正在运行的子 Agent
- **WHEN** 交互式父 assistant turn 正在等待子 Agent且用户在无更高优先级 surface 时按 Esc
- **THEN** 父 turn abort signal SHALL 取消子 Agent provider 请求和可中断工具
- **THEN** 系统 SHALL 释放父 response lock并按既有用户中断语义收尾

#### Scenario: 审批 surface 优先消费 Esc
- **WHEN** 子 Agent Bash permission surface 活跃且用户按 Esc
- **THEN** 当前 Esc SHALL 先拒绝该 Bash 调用并关闭 surface
- **THEN** 父 assistant turn SHALL 保持运行，除非用户在 surface 关闭后再次请求中断

### Requirement: Explorer 保持现有严格只读策略
新增Worker SHALL NOT改变Explorer的工具allowlist、固定Bash人工升级、headless fail-closed或不接收父interaction mode的行为。Explorer定义 SHALL继续只包含读取搜索、Bash、只读Web和Skill工具，并 SHALL继续禁用Todo、提问、MCP、文件编辑和再次委派。

#### Scenario: Worker 不放宽 Explorer
- **WHEN** Worker已注册且主Agent选择`explorer`
- **THEN** Explorer provider-visible和executable registry SHALL与新增Worker前的严格只读集合一致
- **THEN** Explorer非只读Bash的interactive/headless行为 SHALL保持不变
