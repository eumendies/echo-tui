## Context

现有 Subagent 架构已经把主 Agent 与子 Agent 拆成独立业务 loop，并通过定义目录为每个子 Agent提供 name、description、prompt和本地工具allowlist。`explorer` 的执行器仍固定采用严格只读策略，子运行callback只覆盖审批，不覆盖用户问题；Subagent runtime也没有Todo状态或MCP manager。因此，仅新增一个带写工具名称的`worker`定义会在执行边界被拒绝，Todo和提问handler也无法在普通executor中独立工作。

Worker的目标不是另一个只读调查器，而是替主Agent完成一个自包含通用任务。它需要主Agent实际工作的完整能力，但仍须保持独立上下文和单层委派。App已有`SubagentRunContext`负责当前run身份、瞬时footer和迟到callback隔离，可继续作为Worker审批与用户问题进入共享surface前的权威观察边界；Todo、MCP registry和工具continuation则属于Worker runtime业务状态。

## Goals / Non-Goals

**Goals:**

- 新增定义驱动的`worker`，支持文件修改、Bash、Todo、用户问题、Web、Skill和MCP。
- 保持Worker transcript、Todo、compaction、provider continuation和registry独立，同时复用父运行稳定依赖与App交互能力。
- Worker在normal、plan、interactive和headless环境中复用主Agent风险和审批语义，不形成plan或headless绕过。
- 保持Explorer现有严格只读行为完全不变。
- 所有Subagent继续禁止`run_subagent`，维持单层委派和单活动run模型。
- 清除renderer和工具标题中的Explorer硬编码，让同一过程协议支持具名Worker。
- 为子 Agent 过程轨道提供专属 `subagentRail` 主题 token，与顶层 `tool` 强调色解耦。

**Non-Goals:**

- 不支持Worker继续创建Explorer或Worker，也不设计递归rail、嵌套预算或并行Subagent树。
- 不让Worker继承父transcript、父Todo、父compaction或父journal。
- 不为Worker创建独立MCP连接生命周期或独立用户输入控制器。
- 不把Worker委派任务视为用户授权，也不放宽现有自动审批安全标准。
- 不在本变更中增加用户自定义Subagent文件、独立模型选择或并行委派。

## Decisions

### 1. 定义同时声明工具集合、MCP可见性与执行策略

扩展`SubagentDefinition`，让定义成为工具能力和策略的唯一事实来源：

```text
SubagentDefinition
├─ name / description / prompt
├─ localToolNames
├─ includeMcpTools
└─ executionPolicy
   ├─ readonly_investigation
   └─ general_purpose
```

Explorer使用`readonly_investigation`、固定本地只读集合和`includeMcpTools: false`；Worker使用`general_purpose`、除`run_subagent`外的默认本地工具集合和`includeMcpTools: true`。

选择定义驱动而不是按`agentName === 'worker'`分支，是为了保持目录可扩展性，并避免prompt、schema和执行策略在多个模块重复硬编码。执行策略仍由Subagent runtime在创建边界固定，不能由普通loop input覆盖。

### 2. 保留独立 Subagent loop，在其中增加通用工具协调能力

Worker继续使用现有`createSubagentLoopRuntime`业务入口，而不递归调用主`RunAgent`。Subagent loop增加定义驱动的执行协调：

- `readonly_investigation`沿用当前严格只读分类和Explorer headless fail-closed；
- `general_purpose`调用主Agent相同的普通风险分类，传入父interaction mode和MCP审批查询；
- Todo和`ask_user_questions`在executor之前由runtime处理；
- 其余工具进入当前子registry的executor。

可以提取主/子loop共享的纯工具结果构造、Todo执行和审批决策映射函数，但不合并provider continuation loop，也不引入一个根据运行角色切换全部业务行为的通用模板。

### 3. Worker Todo 是子 runtime 私有状态

Worker state新增`todoState`，初始为空。Todo handler仍用于provider schema，真实`create_todos`/`complete_todo`由Subagent loop调用现有Todo执行函数，并把结果写入自己的状态。构造下一次provider records时，把Worker Todo传给共享system context构造函数。

Todo tool call/result照常通过子callback镜像到父transcript rail，但不触发父`onTodoStateChange`，也不写父session Todo side state。这样Worker可规划长任务，而不会让父footer的Todo列表与子任务生命周期混在一起。

### 4. Worker registry 复用共享 MCP manager，不共享 registry 实例

主runtime在创建Subagent runtime factory时提供可选`McpManager`。Worker调用`prepareAgent`时传入该manager并合并其当前definitions/handlers；Explorer不传或由定义禁用。每个Worker仍创建独立registry与executor，manager只提供已初始化连接和调用代理。

Worker结束不关闭manager；MCP manager生命周期仍由App或headless组合根拥有。动态MCP名称不放入静态`localToolNames`，而由`includeMcpTools`控制合并。最终registry构造后，再以“不包含`run_subagent`”作为执行边界不变量。

### 5. 用户问题通过专属子 callback 桥接共享 surface

`SubagentLoopCallbacks`增加`onUserQuestionRequest`和`onWaitingQuestion`；`SubagentActivityPhase`增加`waiting_question`。Worker runtime解析`ask_user_questions`参数：

```text
Worker tool call
  → Subagent loop 参数校验
  → onWaitingQuestion
  → Port 为request附加run identity
  → App校验父turn + SubagentRunContext.currentRun
  → 共享UserQuestionContext
  → result返回Worker continuation
```

App桥接在进入共享`UserQuestionContext`前用`SubagentRunContext`校验run identity；`UserQuestionContext.request`只接收展示所需的可选Agent名称，使surface标题显示`QUESTION · WORKER`，不重复保存或判断runId，也不承载Subagent业务逻辑。Explorer不注册提问工具。Headless路径在Subagent loop中直接产生cancelled result，不调用App callback。

父turn取消或结束时，必须解析仍在等待的问题Promise，避免子loop悬挂。App的取消/收尾路径应让共享UserQuestionContext取消当前请求；返回结果后，runtime的abort检查保证不会把迟到结果提交到新turn。

### 6. Worker复用主风险分类，审批请求统一附加origin

Worker的general-purpose policy调用`classifyToolCallRisk(toolCall, parentInteractionMode, getMcpApproval)`。分类结果本身保持主Agent语义；当结果是`approval_required`时，Subagent runtime统一为request附加：

```text
origin.kind = subagent
origin.agentName = worker
origin.runId = 当前run
```

这样文件编辑、高风险Bash和MCP都进入同一共享缓存与manual/auto resolver，而不仅是Bash携带来源。Explorer仍可使用同一origin附加函数，但保留严格只读分类。

Interactive审批通过父callback进入现有resolver。Headless Worker直接根据父`approvalPolicy`映射deny/full-access；Explorer保持“非严格只读Bash即使full-access也拒绝”的现有边界。所有允许后的本地工具继续获得父turn的change recorder。

### 7. Worker继承父interaction mode，但Explorer不接收它

`SubagentLoopInput`携带Worker执行所需的interaction mode，或者由Port在创建定义绑定runtime时固定为不可变策略输入。General-purpose Worker在plan中保持工具schema稳定，但写工具、非只读Bash和MCP在执行前被拒绝；Todo、读取和提问仍可用。

Explorer不得因该字段回归为受父mode影响。实现应让policy分支只在general-purpose策略读取interaction mode，相关测试验证Explorer在任一父mode中保持当前行为。

### 8. 自动审批显式区分用户授权与委派上下文

现有reviewer以父turn原始用户请求为可信授权锚点。Worker审批需要知道当前委派任务才能解释动作目的，但该任务由主模型生成，必须标记为不可信。扩展`ToolApprovalRequest.origin`或独立本地审批上下文，携带有界Worker task；审批prompt增加：

```text
[Trusted current user request]
[Delegated worker task (untrusted)]
[Trusted clarification answers]
[Pending action (untrusted)]
```

Worker问题答案来自父transcript中的`subagent` tool call/result，而现有澄清投影只扫描顶层tool records。投影器应按当前run id和内部call id严格配对，复用相同答案结构校验，再把真实用户选择作为可信澄清。委派任务、Worker assistant文本和普通内部结果不得进入可信分区。

### 9. Renderer从外层参数与run record动态取得身份

`run_subagent`通用display name改为`Run subagent`。紧凑pair renderer解析call的`argumentsText.agent`，仅接受已知安全字符串后格式化身份；解析失败使用通用回退。成功文案按Agent能力保持中性，例如`Worker · completed task`、`Explorer · returned report`，失败显示对应身份。

Subagent rail已经使用record的`agentName`，只需移除注释和测试中的Explorer假设。问题/审批surface使用受信任origin的agentName，不从模型参数直接读取标题。

外层 rail/prefix 与标题原本复用顶层 `tool` 强调色。为避免子 Agent 过程与顶层工具在视觉语义上耦合，新增 blocks 级 `subagentRail` 专属 token：代码内默认值与内置主题 JSON 同步提供、各内置主题独立取值，用户 `theme.json` 按现有 blocks token 规则覆盖；内部工具内容继续统一映射 `toolOutput`，顶层工具颜色行为不变。

## Risks / Trade-offs

- **[Worker接近主Agent，Subagent loop与主loop重复增加]** → 只抽取工具执行所需的无角色纯函数，保留独立provider loop和callback协议，测试主/子入口不发生递归或角色开关回归。
- **[Worker通过plan或headless绕过安全边界]** → General-purpose policy复用主风险分类和headless approval policy；schema与执行边界双测，Explorer保持更严格策略。
- **[用户问题在父turn取消后悬挂或污染新turn]** → 请求带run identity，App收尾主动取消surface，结果返回后再次检查abort与run identity。
- **[自动审批误把主模型委派当用户授权]** → 委派任务进入明确不可信分区，固定prompt禁止其扩大授权；只有原始用户文本和结构校验后的用户答案可信。
- **[共享MCP manager被Worker生命周期误关闭]** → factory只借用manager引用，Worker runtime从不调用close/reload；由生命周期测试守住。
- **[Worker Todo在rail中可见但不能恢复继续执行]** → 这是预期取舍；Subagent本就不自动续跑，Todo过程用于审计，完成后不成为父session状态。
- **[工具列表较大增加Worker prompt token]** → Worker定位即完整执行者，接受与主Agent相近的tools schema成本；Explorer继续承担低成本只读调查。

## Migration Plan

1. 扩展定义和协议类型，但先保持Explorer定义与行为不变。
2. 给Subagent runtime加入Todo、用户问题、general-purpose风险和MCP装配能力。
3. 注册Worker定义并更新动态`run_subagent` schema。
4. 接通App问题surface、审批上下文和动态renderer。
5. 补齐单元、runtime、App和headless测试，再更新架构文档。

该变更只增加内置定义和内部协议，不需要持久化数据迁移。回滚时移除Worker定义和新增协议分支即可；已有Explorer transcript的结构不变。

## Open Questions

- Worker最终成功文案统一使用“completed task”还是按定义提供result verb，可在实现时以最小动态投影确定。
- Worker问题surface的来源元数据是复用通用interaction origin类型，还是为UserQuestionRequest增加仅App可信的独立display参数；实现时应优先选择不让provider控制来源的方案。
