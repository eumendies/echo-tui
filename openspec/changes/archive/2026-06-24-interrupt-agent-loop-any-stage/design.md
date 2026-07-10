## Context

当前项目已经支持在 assistant response 的 thinking / streaming 阶段按 Esc 中断，但中断入口仍依赖 `pendingKind`。当 agent loop 已经进入工具调用、工具执行、工具结果后 continuation、自动上下文压缩、等待下一轮 provider 请求等阶段时，response lock 仍然被当前 assistant turn 占用，用户却可能无法通过 Esc 停止本轮 loop。

同时，TUI 已有多类高优先级 surface：`ask_user_questions` choice surface、tool approval、file picker、slash command / info / confirm / skills 等 command surface，以及 shell mode 的本地命令中断。用户明确要求 `ask_user_questions` 的 Esc 只关闭当前 surface；surface 关闭后，如果用户继续按 Esc，才中断整个 agent loop。因此本设计需要扩大 assistant turn 的可中断窗口，同时不破坏现有 surface-first 输入分发语义。

## Goals / Non-Goals

**Goals:**

- 让 Esc 在 assistant turn 占用 response lock 的任意 agent loop 阶段都能请求中断，而不是只依赖 thinking / streaming pending 状态。
- 保留 surface-first 优先级：活跃 surface 首次消费 Esc；无活跃 surface 时 Esc 才作为全局 assistant turn interrupt。
- 将同一个 turn 级取消信号贯穿 provider request、自动压缩摘要请求、工具授权 / 用户问题等待、工具执行和 continuation 边界。
- 对长耗时工具提供 best-effort 取消；即使工具无法即时停止，也要在工具返回后阻止后续 provider continuation。
- 继续沿用既有中断收尾：保留 partial assistant、本地中断提示可见且持久化、释放 response lock、隔离迟到回调。

**Non-Goals:**

- 不改变 `ask_user_questions`、tool approval、file picker、command surface 的首次 Esc 关闭 / 取消语义。
- 不要求所有工具都必须物理终止正在执行的底层工作；不可取消工具可以完成返回，但返回后不得推进已中断 loop。
- 不改变 shell mode 本地命令的 Esc 中断模型；正在运行的 shell command 仍优先走 shell command interruption。
- 不引入新的第三方 TUI 框架、异步任务调度库或 provider 专用中间消息模型。

## Decisions

### 1. 中断判定改为 active turn 绑定

`interruptActiveAssistantTurn()` SHALL 以当前 active assistant turn identity、response lock 和 turn-level `AbortController` 为准，而不是以 `pendingKind` 是否为 thinking / streaming 为准。只要当前 turn 尚未结束、取消信号未触发、且没有更高优先级 surface 消费 Esc，系统就请求 abort。

备选方案是继续扩展 `pendingKind` 枚举，把 tool、compaction、continuation 等阶段都加入允许列表。该方案会继续把用户意图绑定到 UI pending 投影，后续新增 loop 阶段时容易再次遗漏，因此不采用。

### 2. 输入分发保持 surface-first

顶层 Esc 分发 SHALL 保持现有优先级：用户问题 surface、工具授权、文件选择、command surface 等先处理 Esc；这些 surface 关闭后，下一次 Esc 才进入 shell command interrupt 或 assistant turn interrupt。`ask_user_questions` 特别保持“第一次 Esc 返回 cancelled tool result”的语义，避免用户只是关闭问题面板却意外杀掉整轮 agent。

备选方案是让 Esc 同时关闭 surface 并中断 loop。该行为虽然更激进，但会违背用户对 `ask_user_questions` 的明确要求，也会让工具授权 / 命令面板的局部取消变得危险，因此不采用。

### 3. agent loop 在所有 await 边界检查 abort

agent loop runtime SHALL 在以下边界检查 `abortSignal.aborted` 或调用等价 `throwIfAborted`：

- 每次 provider `runTurn` 之前和之后。
- 自动上下文压缩摘要请求之前和之后。
- tool approval / user question callback 返回之后。
- 每个 tool executor 调用之前和之后。
- 每轮 continuation records 追加后、下一次 provider turn 之前。
- 最终 complete callback 之前。

这样即使某个 await 本身不能被立即取消，runtime 也不会在恢复后继续推进下一步。

### 4. 取消信号向 compaction 和 tools 下沉

provider turn 已经可以接收取消信号，本变更继续把同一个 turn-level signal 传给自动压缩摘要请求和 tool executor。tool handler options 增加可选 `abortSignal`，由支持取消的 handler 使用。

- `run_bash_command` 复用共享 bash runner 的 abort 能力。
- `web_fetch`、`web_search` 等带 timeout 的工具 SHALL 组合 timeout signal 和 parent abort signal。
- 纯本地快速工具可以忽略 signal，但 executor / runtime 仍需在调用前后检查 signal。

备选方案是在 app 层 abort 后只忽略所有迟到 callback，不向工具下沉 signal。该方案实现简单，但用户在长耗时 bash / web 请求中仍要等待工具自然完成才能释放资源，因此只作为不可取消工具的兜底，不作为主方案。

### 5. 中断期间避免孤儿 tool_call

由于当前可见层已经倾向于延迟落盘未完成 tool call，runtime SHALL 避免在用户中断后追加“只有 tool_call、没有 tool_result”的孤儿记录。若中断发生在工具调用 pending 但工具尚未产生结果的阶段，UI 可以清理 pending preview 并追加本地中断提示；已成对完成的 tool_call/tool_result 可以按既有 transcript 事实保留。

### 6. continuation UX 与中断能力解耦

系统 MAY 在每次 provider turn 前进入 thinking / working 可见状态，帮助用户理解“工具结束后正在等模型继续回答”。但 Esc 是否生效 SHALL 只依赖 active turn，不依赖当前是否渲染了某个 pending 状态。这样 UI 文案或 spinner 后续调整不会影响中断正确性。

## Risks / Trade-offs

- [Risk] 部分工具或 SDK 不支持即时取消，Esc 后底层 promise 仍可能稍后 resolve。→ Mitigation: 统一 turn identity guard 和 abort boundary check，迟到结果不得污染当前 UI 或触发 continuation。
- [Risk] surface-first 与 global interrupt 容易因输入分发顺序调整而回归。→ Mitigation: 为 `ask_user_questions` 首次 Esc、surface 关闭后二次 Esc、tool approval Esc 等场景补充测试。
- [Risk] 修改工具 handler options 会影响多类工具签名。→ Mitigation: 让 `abortSignal` 可选，先在 executor 层统一透传，快速工具无需行为变化。
- [Risk] 取消时若 transcript 已追加部分工具记录，可能影响 provider 续传一致性。→ Mitigation: 中断后不再发起 provider continuation；可见 transcript 只保留已经完成的事实记录和本地中断提示。
- [Risk] 自动压缩被取消时可能留下半更新压缩状态。→ Mitigation: 摘要请求完成前不提交新压缩状态；abort 后不落盘部分摘要。
