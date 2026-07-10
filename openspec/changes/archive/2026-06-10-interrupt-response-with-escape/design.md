## Context

当前 `createApp()` 在用户提交普通消息后进入 assistant response 生命周期，并通过 `runAgent(session, callbacks)` 等待真实 agent 或 fake agent 完成。模型产生的 token 只更新 footer pending preview，完成后才追加 assistant transcript；失败时会保留 partial draft 并追加 `error` record。

Esc 目前只在 command session、tool approval、ask user questions 等交互 surface 中有业务语义；普通状态下 Esc 是 no-op。若只在 Esc 时清理 UI 状态，底层 OpenAI stream 或 fake agent 仍可能继续产生 token/complete 回调，造成旧 turn 污染新 UI，且真实网络请求不会被取消。因此中断需要贯穿 app turn、agent loop 和 provider streaming 边界。

## Goals / Non-Goals

**Goals:**
- 在 assistant thinking / streaming / tool-loop continuation 等 response 活跃期间，允许用户按 Esc 中断当前回答。
- 通过 `AbortController` / `AbortSignal` 把中断请求从 UI 传播到 agent loop 和 provider agent。
- OpenAI provider 请求应把 signal 传给 SDK stream；fake provider 应支持 thinking delay 和逐字 streaming 被 signal 中断。
- 中断后释放 response lock，停止 spinner/pending preview，保留已产生 partial assistant，并追加本地中断提示。
- 避免中断后的迟到 token、tool callback 或 complete callback 污染后续 turn。

**Non-Goals:**
- 不在本次变更中强制终止已经启动的本地工具进程，例如已经开始执行的 bash 子进程。
- 不引入新的全局事件总线或后台任务系统。
- 不改变现有 command session、tool approval、ask user questions 对 Esc 的优先消费语义。

## Decisions

### 1. 使用 AbortController 作为 turn 级取消机制

每次普通 user turn 创建一个 `AbortController`，并把 `controller.signal` 放入 `AgentSessionInput`。Esc 在没有 modal/command 优先消费且 app 正处于 response lock 时调用 `controller.abort()`。

选择原因：
- `AbortSignal` 是 Node/Web 标准取消机制，可被 OpenAI SDK / fetch 风格 API 直接消费。
- 比自定义 boolean flag 更容易传递到 provider 边界，并且可以取消真实 HTTP streaming。
- signal 可由 fake agent 和 agent loop 主动检查，形成统一的取消语义。

备选方案：
- 只用 boolean flag 忽略后续回调：能避免部分 UI 污染，但不能取消底层 stream。
- `Promise.race()`：能让 app 先返回，但后台任务仍可能继续执行并触发回调，难以管理生命周期。

### 2. 扩展 agent contract，而不是新增专用 cancel API

`AgentSessionInput` 增加可选 `abortSignal`。`ProviderAgent.runTurn` 增加可选 options 参数，携带 `abortSignal`。`RunAgent` 函数形态保持不变，避免 app 注入 seam 大幅变更。

agent loop 在以下边界检查 signal：
- 初始化后、压缩前后、发起 provider turn 前。
- provider turn 返回后，执行 tool call 或 continuation 前。
- 等待用户授权或用户问题交互返回后继续处理前。

### 3. app 层维护 active turn identity，屏蔽迟到回调

除了 abort signal，`main.ts` 还应为每轮响应维护一个 active turn 对象或递增 id。所有 agent callbacks 在修改 app 状态前检查当前 callback 是否仍属于 active turn。

这样即使某个 provider 或测试 stub 没有及时响应 abort，迟到的 `onToken`、`onComplete` 或 tool callback 也不会写回已中断或后续新 turn 的 UI 状态。

### 4. 中断是本地 notice，不是 error

用户按 Esc 属于主动中断，不应显示为“模型响应失败”。中断收尾应：
- 如果已有 partial draft，先追加 assistant record 保存已生成内容。
- 追加一个本地 notice record，例如 `role: 'local_notice'`，文本为“已中断模型回答”。
- 清空 pending/working、停止 spinner、释放 response lock。

该 notice 是本地 UI 与持久化事实，不应进入后续 provider input，也不应参与上下文压缩 token 估算。

备选方案：
- 使用 `error` record：实现简单，但语义错误且视觉上过重。
- 只保留 partial assistant：用户难以区分自然结束和主动中断。
- 复用 `compaction_notice`：显示样式可复用，但 role 名称语义过窄。

### 5. 保持 modal / command 对 Esc 的优先级

输入事件分发顺序保持现有结构：user question、tool approval、command runtime、slash suggestion 等优先处理。只有没有这些活跃交互时，Esc 才用于中断 response。这样不会破坏 Esc 拒绝工具授权、取消 `/model`、关闭 `/help` 等现有行为。

## Risks / Trade-offs

- **Risk: provider 不及时停止，迟到回调污染 UI** → 使用 active turn identity 在所有 callback 入口做当前 turn 校验。
- **Risk: 用户以为 Esc 会杀掉正在执行的本地工具** → 本次范围明确不强杀已启动工具；agent loop 在工具执行边界前后检查 abort，避免继续后续 provider/tool loop。后续可单独扩展 tool executor signal。
- **Risk: abort 被当成普通错误显示红色失败** → 引入 abort 识别函数或专用 abort error，app catch 分支单独处理中断。
- **Risk: 新本地 notice 污染模型上下文** → 更新 transcript converter 与 context compaction 的本地 role 过滤列表，并添加测试。
- **Risk: fake agent 测试变慢或计时不稳定** → fake agent 的 abortable delay 保持现有延迟行为，同时单测可在 signal abort 后验证停止，不依赖真实长等待路径过多。

## Migration Plan

该变更只影响运行时代码和本地 transcript 中新增的本地 notice role。旧 session 不包含该 role，恢复逻辑应保持兼容。若需要回滚，移除 Esc 中断分支和 abort signal 传播即可，已有 transcript 中的未知 `local_notice` role 会被旧 renderer 安全忽略或可按未知 role 跳过。

## Open Questions

- 是否在后续单独支持 Esc 强制终止已经启动的本地工具进程，尤其是 bash 子进程。
- 中断提示文案最终使用“已中断模型回答”还是包含快捷键来源，例如“已按 Esc 中断模型回答”。
