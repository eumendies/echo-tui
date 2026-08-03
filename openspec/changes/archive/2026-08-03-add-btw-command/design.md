## Context

echo-tui 当前只有一套持久化主 transcript、composer 和 assistant turn 状态。响应期间允许命令可以打开 command surface，但主 turn 的稳定 records 仍会追加到当前终端，surface 只替换 footer 输入区域；这无法表达“暂时进入另一段多轮会话”的 BTW 语义。

现有 app renderer 已支持任意 records 的 destructive replay、稳定 record append 和 footer-only redraw，因此无需引入 alternate screen 或新的终端屏幕模型。Agent loop 也已接收每次 run 的 transcript、compaction、todo、abort signal 和 interaction mode 快照，但工具限制目前主要绑定 plan/headless 语义，尚无独立的 per-run readonly policy。

本设计需要同时满足以下约束：主 assistant turn 在 BTW 期间继续运行和持久化；BTW 上下文与记录完全临时；模型必须明确识别 BTW 边界而不继续主任务；built-in system prompt 与 provider-visible tool definitions 不得因 BTW 改变，以复用由 model、system prompt 和 tools 共同决定的 prompt cache key；终端不得切换 alternate screen。

## Goals / Non-Goals

**Goals:**

- 提供 `/btw [问题]` 多轮临时旁路会话，可在主 turn 运行时并行使用。
- 打开时冻结主 provider 上下文作为参考，后续主更新不漂移 BTW 上下文。
- 通过 user-message boundary 让模型识别 BTW，同时保持 system prompt 和 tools schema 不变。
- 在执行层强制 readonly、fail-closed，且拒绝路径不打开 approval 或 user-question surface。
- 进入、退出和 destructive resize 时切换完整可见投影；BTW 日常流式更新继续使用现有 append/footer 路径。
- Esc 原子终止并丢弃 BTW，迟到 callback 不得污染恢复后的主视图。
- 保持主 transcript、journal、todo、change history 和 compaction 不受 BTW 临时状态修改。

**Non-Goals:**

- 不持久化、恢复、fork、导出或搜索 BTW 会话。
- 不支持嵌套 BTW、多个并行 BTW，或把 BTW 回答合并进主 transcript。
- 不为 BTW 增加写工具授权、MCP 调用或交互式 `ask_user_questions`。
- 不改变 built-in system prompt、默认主会话工具行为或 provider-visible tool definition 集合。
- 不引入 alternate screen、左右分栏或新的第三方 TUI 库。

## Decisions

### 1. 使用 app 级 BTW controller，而不是第二个 AppContext

新增职责单一的 BTW conversation controller，持有 `baseRecords`、初始 compaction 快照、side records、独立 composer/pending/working/todo、active turn identity 和 abort controller。主 `AppContext` 继续是唯一持久化会话状态；BTW controller 不接收 transcript store、主 todo/change recorder 或持久化写能力。

`BtwCommandHandler` 仍通过受控 `CommandHost.btw` facade 打开、更新和关闭 BTW，command runtime 只负责 active session 与输入事件所有权。真实异步 side turn 和可见投影属于 app controller，因为它们需要协调 agent callback、renderer 和主记录路由，不能仅存放在同步 handler data 中。

没有采用第二个 `AppContext`，因为它会复制 session persistence、model refresh、change history、MCP bootstrap 等与临时旁路无关的状态，并增加误写主 journal 的风险。

### 2. 冻结 provider 上下文，side 状态单独演进

BTW 打开时复制主 transcript records 与 compaction 状态。每次 side run 使用：

```text
frozen parent records + accumulated BTW records
```

主 turn 后续产生的 records 只更新主状态，不加入已打开 BTW 的 provider 上下文。BTW compaction 和 todo 从此在临时 controller 内单独更新；主 todo、change history 和 `sessionJournalPath` 不传入 side run，防止 runtime todo suffix 诱导模型继续主任务，也防止模型通过持续变化的 journal 绕过冻结边界。BTW 继承打开时解析的 model/effort，但 shell/shell-local 提交语义不进入 side 会话。

没有采用动态同步主 transcript，因为同一段多轮 BTW 对话会在轮次间改变背景，难以解释回答依据并可能突然接续后台新工具结果。

### 3. 用首条 user record 建立 BTW 边界，不修改 system prompt

BTW 的第一条 user record 使用 provider-facing 包装文本，明确说明此前主会话是冻结参考、不得继续主任务、unfinished plan、todo 或 intended tool call，并声明只允许 readonly tools；`displayText` 保留用户原始问题，终端只显示原文。后续 side records 会保留该边界，追问仅需短 BTW 标识。

Agent session 可携带 `conversationKind: 'btw'` 等本地元数据供执行、调试和渲染使用，但该字段不得进入 built-in system prompt。相同 model、配置和 MCP 状态下，BTW 继续提供与主会话相同的 provider-visible tool definitions；因此现有由 `model + systemPrompt + tools` 计算的 cache key 不因 BTW 模式本身变化。

没有采用 BTW system prompt suffix，因为 system prompt hash 改变会打散 prompt cache；也没有把父 transcript 序列化成一大段引用文本，因为那会丢失 provider-private reasoning 和 tool pair 的结构并增加重复 token。

### 4. 新增独立 per-run readonly tool policy

在 `AgentSessionInput`/run state 增加默认不影响现有行为的 tool policy。BTW 使用 readonly policy，并在普通风险审批之前执行 fail-closed 分类：

- 允许明确只读的内置文件、搜索、网页和 skill 加载工具。
- 允许 todo 工具，但更新只写 BTW 临时 todo。
- `run_bash_command` 仅允许共享 readonly classifier 明确认可的 inspection 命令。
- 拒绝 `apply_patch`、`edit_file`、非只读 bash、MCP、`ask_user_questions` 和未知工具。
- 拒绝直接生成保留 call id/name 的失败 tool result，不进入 executor、approval callback 或 user-question callback。

Provider 仍看到完整稳定 tools schema。只在 provider 侧裁剪工具虽然能减少错误调用，但会改变 `createPromptCacheKey()` 的 tools 输入，违背缓存稳定目标。执行层拒绝是安全边界，user boundary 负责减少模型发起无效调用。

### 5. 引入显式可见投影路由

app 组合渲染状态时根据 BTW controller 是否活跃选择 `main` 或 `btw` 投影：

```text
main: main banner + persisted records + main footer
btw:  compact BTW banner + side records + BTW composer/status
```

进入、退出、列宽变化或行数缩小时调用现有 `renderDestructive()` 重放当前投影。BTW 正常运行期间，side 稳定 records 继续走 `appendRecord(s)`，token/pending/MAIN activity 走 footer redraw。主 records 在 BTW 活跃时仍追加并持久化，但跳过终端 append，只触发必要的 MAIN activity 摘要更新；退出时 destructive replay 最新主 records，补回所有隐藏内容。

没有采用把全部 BTW transcript 放进 footer command surface，因为长回答、Markdown、表格和 tool pair 会重复实现裁剪与滚动；全视图投影可直接复用现有 transcript block renderer。

### 6. Esc 关闭整段 BTW，并用 identity 隔离迟到 callback

每次 BTW 会话和 side turn 都分配 identity。所有异步 callback 在修改 side 状态或渲染前检查当前 conversation/turn identity。Esc 关闭时先使 identity 失效并 abort active side turn，再清空临时状态、关闭 command session、切回 main 投影并 destructive replay。Side runner 的 `catch/finally` 只能清理仍匹配的旧 turn，不得在退出后追加 partial/error/cancel record。

主 turn 的 approval、user question、file picker 等既有高优先级输入 surface 继续优先于 BTW command session。上层 modal 活跃时 Esc 先按 modal 语义处理；modal 消失后 BTW 仍存在，再次 Esc 才关闭 BTW。关闭 BTW 永不 abort 后台主 turn。

### 7. BTW composer 复用普通编辑语义但使用独立单槽 pending

BTW composer 复用现有 composer state 与按键编辑逻辑，Enter 提交 side user message，Ctrl+J 插入换行。Side turn 运行期间用户可以编辑下一条草稿；提交时最多保存一条 BTW pending message，并在当前 side turn完成后自动 claim。BTW 活跃时输入始终由 BTW command session 消费，包括以 `/` 开头的文本也作为 side user message 提交而不进入全局 command router，从而避免嵌套 command session。

## Risks / Trade-offs

- [进入/退出会清除 scrollback] → 仅在模式切换和 destructive recovery 使用清屏；文档与 banner 明确 BTW 是临时全视图，禁止 alternate screen。主 app transcript 可完整重放，但 echo-tui 启动前的终端历史无法恢复。
- [长主 transcript 返回时重放成本为 O(records)] → 复用现有 destructive renderer，不在 token 更新时重放；增加长 transcript 与 resize 测试。
- [模型仍可能忽略 user boundary 并调用写工具] → readonly policy 在执行层 fail-closed，拒绝不进入审批或 executor，并把失败 result 回传模型纠正行为。
- [完整 tools schema 暴露不可用工具] → 接受少量无效 tool call 以保持 prompt cache key；首条边界消息列出 readonly 限制。
- [父 turn 与 BTW callback 交错造成错投影] → 所有 append API 标注来源，投影层只绘制 active view；side callback 使用 conversation/turn identity，主状态持久化与终端输出解耦。
- [父 AGENTS/config/MCP 在 BTW 打开后发生变化仍可能改变实际 system/tools] → BTW 不主动修改这些输入；缓存稳定承诺限定在 model、配置和 MCP 状态未变化时，与现有主 run 规则一致。
- [BTW 自动压缩可能引用冻结父摘要] → compaction 状态在打开时复制，此后只在 side 内演进且不持久化；关闭后整体丢弃。

## Migration Plan

1. 先增加默认值保持现状的 agent tool policy 和 readonly 分类测试，确保主会话请求、cache key 与工具行为不变。
2. 增加 BTW controller/runner、CommandHost facade 与 handler，但在渲染路由接入前通过 controller 测试验证上下文和生命周期。
3. 接入 main/BTW 投影、banner/footer 和 resize/退出恢复，再注册 suggestion/help。
4. 运行完整自动化验证，并由用户执行交互式 TUI 手动验证。

回滚时可移除 `/btw` 注册、controller 和 readonly policy 分支；BTW 不产生持久化数据，因此不需要 session migration 或数据清理。

## Open Questions

- 无。

