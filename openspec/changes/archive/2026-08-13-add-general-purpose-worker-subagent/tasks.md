## 1. 定义与协议

- [x] 1.1 扩展 `SubagentDefinition`，声明本地工具集合、MCP 可见性和 readonly/general-purpose 执行策略，并为所有新增结构字段补齐中文语义注释。
- [x] 1.2 新增内置 `worker` 定义与专属 prompt，将 Explorer/Worker 同时投影到 `run_subagent` 动态目录，并确保两者定义都不包含 `run_subagent`。
- [x] 1.3 扩展专属子运行输入、callbacks 和 activity phase，支持 Worker 继承父 interaction mode、等待用户问题及用户问题结果桥接，不向子 runtime 暴露完整主 callbacks。

## 2. Worker 工具目录与独立状态

- [x] 2.1 为 Worker 构造除 `run_subagent` 外的完整默认本地 registry，包含配置选择的文件编辑、Bash、读取搜索、Web、Skill、Todo 和 `ask_user_questions`，同时保持 Explorer 现有裁剪集合不变。
- [x] 2.2 向 Subagent runtime factory 提供共享 MCP manager；按定义只为 Worker 合并当前 MCP registry，并确保 Worker 结束不关闭、重载或重新初始化共享连接。
- [x] 2.3 在 Worker runtime 内维护独立 `TodoState`，复用现有 Todo 参数/结果语义和 provider prompt 注入，但不调用父 `onTodoStateChange` 或修改父 session Todo。
- [x] 2.4 在 provider schema 与 executor 两层拒绝 Worker 伪造的 `run_subagent` 调用，并验证动态 MCP 名称不会绕过该单层委派边界。

## 3. 执行策略与审批

- [x] 3.1 为 general-purpose Worker 复用主 Agent 普通风险分类和 MCP approval 查询，统一给文件编辑、高风险 Bash 与 MCP 的 approval request 附加 Worker origin。
- [x] 3.2 让 Worker 在 plan mode 拒绝文件编辑、非只读 Bash 和 MCP，同时保留读取、Todo 与用户问题；验证 Explorer 不读取父 interaction mode且严格只读行为不回归。
- [x] 3.3 让 headless Worker 按父 execution mode 执行 deny/full-access 策略，不创建 reviewer或等待stdin；保留 Explorer非只读Bash始终fail-closed。
- [x] 3.4 复用共享 `ToolApprovalContext` 会话授权、manual/auto resolver和change recorder，覆盖主/Worker/Explorer之间allow-all、按工具和精确Bash command缓存复用。

## 4. Worker 用户问题

- [x] 4.1 在 Subagent loop 内解析并处理 `ask_user_questions`，interactive 路径通过专属 callback等待App，headless路径直接返回cancelled tool result，并把call/result提交为Worker稳定过程。
- [x] 4.2 扩展 `SubagentRunContext` 和 assistant turn桥接，在打开问题surface前校验父turn与runId，支持`waiting_question`活动并在问题结束后恢复Worker footer。
- [x] 4.3 为共享 `UserQuestionContext` 增加受信任的来源显示参数，渲染 `QUESTION · WORKER`，保持输入优先级和Esc只取消当前问题的语义。
- [x] 4.4 在父turn取消、失败和结束路径解析活跃Worker问题并隔离迟到答案，确保旧问题不会悬挂response lock、追加records或污染新turn。

## 5. 自动审批信任投影

- [x] 5.1 为 Worker approval request携带有界委派任务上下文，并在 reviewer prompt中把它投影为不可建立或扩大授权的不可信分区。
- [x] 5.2 扩展澄清答案投影，按当前Worker run和内部call id配对Subagent `ask_user_questions` call/result，复用现有答案结构校验后作为可信用户澄清。
- [x] 5.3 验证Worker assistant文本、委派任务、普通内部工具结果、失败或陈旧问题答案不会进入可信授权分区。

## 6. Transcript 与渲染

- [x] 6.1 保持Worker内部Todo、提问、MCP和写工具通过现有Subagent tool call/result records增量持久化、provider隔离和恢复投影，不引入新的provider-facing角色。
- [x] 6.2 将 `run_subagent` 通用工具显示名从Explorer改为`Run subagent`，按外层合法`agent`参数动态渲染Worker/Explorer紧凑成功失败状态并保持正文去重。
- [x] 6.3 清理Subagent rail、footer、注释和测试中的Explorer单实例假设，验证Worker身份、muted嵌套工具、宽度、resize和resume行为。
- [x] 6.4 新增 blocks 级 `subagentRail` 专属主题 token：代码默认值、全部内置主题 JSON、用户 override 合并与渲染接入，验证子 Agent 轨道与顶层 `tool` 语义色解耦。

## 7. 测试与文档

- [x] 7.1 添加定义/handler/runtime测试，覆盖Worker目录、独立runtime/registry/Todo/compaction、完整本地工具面、MCP复用和禁止再次委派。
- [x] 7.2 添加策略与审批测试，覆盖normal、plan、interactive、headless deny/full-access、MCP审批、共享缓存、change recorder及Explorer不回归。
- [x] 7.3 添加App用户问题测试，覆盖Worker问题提交、取消、headless、modal/footer恢复、父取消和迟到callback隔离。
- [x] 7.4 添加审批prompt测试，覆盖不可信Worker任务、可信配对答案和无效/陈旧Subagent答案排除。
- [x] 7.5 添加transcript/renderer测试，覆盖Worker Todo、问题、MCP、写工具rail、动态外层pair身份、resume和窄终端投影。
- [x] 7.6 更新架构文档和相关主spec说明，记录Worker完整工具能力、独立状态、共享交互/MCP/审批、mode/headless和单层委派边界。
- [x] 7.7 依次运行 `npm run typecheck`、`npm test`、`find bin src test scripts -name '*.js' -exec node --check {} \;` 和 `git diff --check`，修复全部回归。
- [x] 7.8 由用户手动验证真实Worker文件修改、Todo过程、MCP调用、问题surface、manual/auto审批、plan拒绝、Esc取消、resize/resume、`--once` deny/full-access及`/config`外观Tab切换主题后subagent rail专属色生效。
