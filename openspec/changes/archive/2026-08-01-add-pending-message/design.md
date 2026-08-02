## Context

当前 `submitComposer()` 在 command surface、MCP bootstrap、引用准备或 `turnContext.responding` 时拒绝提交，但 responding 期间的普通 composer 仍可编辑。assistant 的 thinking、streaming、tool call 和 shell preview 与 composer 一起属于 footer 临时区域；`renderFooterLayout()` 将总高度限制为 `rows - 2`，`createFooterRenderer()` 依赖上一帧完整留在可见屏幕内，才能用相对光标移动清除旧 footer。

待发送消息横跨输入、turn 生命周期、transcript 提交和 footer 投影。如果仅在 response lock 上增加一个字符串字段，自动发送时现有 `beginUserTurn()` 会重置 live composer，可能删除用户在排队后继续输入的下一条草稿；如果卡片在 footer layout 之外追加，又会绕过高度预算并把临时内容推入 scrollback。

## Goals / Non-Goals

**Goals:**

- active assistant turn 期间允许排队一条不可变用户输入，并在当前 turn 结束后自动处理。
- 待发送状态与 assistant pending preview、transcript records 和 live composer 相互隔离。
- 自动处理待发送输入时复用普通提交路由，同时不清空后来输入的 composer 草稿。
- 待发送卡片参与统一 footer 高度预算，保持 footer-only redraw 和 destructive resize recovery 正确。
- 定义单槽限制、Esc 优先级、清理边界和迟到 callback 隔离。

**Non-Goals:**

- 不支持多条 FIFO 队列、重排、持久化或恢复待发送消息。
- 不让待发送消息实时注入正在运行的 provider request，也不实现 steering。
- 不改变 shell command、手动 compact、MCP bootstrap 或 `--once` 的提交语义。
- 不引入 alternate screen、滚动区域控制、第三方 TUI 库或行级终端 diff。

## Decisions

### 1. 使用独立单槽 PendingMessageContext

新增 app-level transient context 持有最多一条用户原始文本；render projection 只暴露有界预览。响应期间不能执行 `/reference` 等 command，因此 pending message 不携带 conversation reference 或其他独立附件。

该状态不复用 `TurnContext.pendingKind`。后者描述当前 assistant/shell 的 thinking、streaming、tool call 或 output preview，而 pending message 描述下一次用户输入，两者生命周期和渲染优先级不同。也不把消息提前追加为 user transcript record，否则当前 provider turn 可能错误看到尚未发送的输入，并破坏 append-only turn 顺序。

状态仍封装在独立 context 中，而不是直接放一个 `main.ts` 局部变量，以集中单槽拒绝覆盖、原子 claim 和清理边界，并便于测试迟到 callback。

### 2. Enter 原子转移草稿，第二条不覆盖

仅当 active assistant turn 占用 response lock、composer 非空且队列为空时，Enter 才把当前 draft snapshot 移入 pending context，并清空当时的 composer。排队动作记录输入历史；之后用户可在空 composer 中继续编辑下一条草稿。

若队列已有消息，Enter 不覆盖 pending item、不清空当前草稿，也不追加 transcript。空 composer 的 Enter 仍是无操作。普通 idle 状态继续执行现有提交逻辑；shell、MCP bootstrap 和引用总结准备不借用该队列。

选择拒绝覆盖而不是“最后一次 Enter 生效”，是为了防止用户在不可见的数据替换中丢失已明确排队的内容。首版也不自动把第二条草稿拼接到第一条，因为这会改变用户消息边界。

### 3. 在 submitComposer 消费输入并复用共享提交管线

普通 composer submit 与 pending dispatch 共享一条文本提交管线：slash command/skill 路由、shell mode 判定、file mention 展开、user metadata 构造和 `runAssistantTurn()` 调用只实现一次。普通 composer 可额外传入提交前已有的 conversation reference；pending 文本中的 `/reference` 只会在前一 turn 结束后按 command 语义打开引用选择器。

`submitComposer()` 在一次 Enter 被接受后统一退出历史浏览、记录输入并清空 live composer；turn 和 command handler 不再拥有 composer reset。pending 自动处理只读取已保存文本，因此不会重置用户后来输入的草稿，也不会重复写入历史。

为避免多个 turn 收尾路径重复处理，pending context 提供同步 claim 语义；第一个收尾路径取走文本后，其他迟到路径只能读到空槽。app 另用一个仅覆盖 pending dispatch 链的同步布尔锁：共享路由在 file mention 展开等异步预处理期间尚未设置 response lock，若此时再次 Enter，不能并发提交 live composer。pending 文本不携带 conversation reference，但仍经过同一条异步共享路由。

备选方案是把 pending 文本临时写回 composer 后调用 `submitComposer()`。该方案会覆盖用户后来输入的草稿，因此不采用。

### 4. turn 结束后自动处理，旧 turn callback 不得重复触发

当前 active assistant turn 正常完成或失败并释放 response lock 后，app orchestration 检查并原子 claim pending item，再进入共享提交管线。queued user record 只有在前一轮已完成的 assistant/error/中断事实之后才追加，因此第二轮 provider session 能看到正确的完整上下文。

若 active turn 被显式中断，既有 turn identity guard 继续隔离旧 token、tool result 和 complete callback。若 pending item 未被用户移除，释放 response lock 的路径可立即尝试处理，而不等待不可取消的旧工具自然返回；旧 runner 的 finally 不得再次发送相同 item。

### 5. Pending 卡片属于 composer input surface，并优先挤压 assistant preview

待发送消息在 composer 上方显示固定、有界卡片。正常空间下使用两行：第一行表达“待发送消息/当前回答结束后发送”，第二行展示将换行压平并按 display width 截断的单行预览和移除提示。空间紧张时允许退化为一行摘要，但不得按消息正文自然换行。

卡片必须作为 `renderComposerSurface()` 的输入组成参与预算，而不是在 `renderFooterLayout()` 返回后、renderer write 阶段或 transcript 区域额外拼接。布局继续先预算 input surface，再把剩余行数交给 assistant pending preview：

```text
assistant pending preview（使用剩余预算）
transcript/composer spacer（固定 1 行）
conversation reference（可选）
pending message card（可选，紧邻 composer）
composer viewport
slash suggestions
status line
```

input surface 内优先保留 status line、包含光标的 composer 最小窗口和 pending card；slash suggestions、conversation reference 的辅助展示和 assistant preview 在高度不足时缩减。最终 `constrainLayoutTail()` 继续作为不变量兜底，保证总高度不超过 `rows - 2`，cursor row 始终合法。

这个顺序保证卡片出现时只会减少 assistant preview 或其他可裁剪内容；即使 footer 从矮变高，新 footer 仍完整留在可见屏幕内，下一帧可以用 remembered height 清除。卡片出现本身不触发 destructive recovery。

### 6. Esc 与清理边界采用 transient-state-first

输入优先级保持 active modal/surface first。无高优先级 surface 时，如果存在 pending message，第一次 Esc 只移除该消息并重绘 footer，不中断 active assistant turn；随后再次 Esc 才按既有规则中断 turn。若同时存在其他 composer attachment，pending message 的移除优先级高于 conversation reference，视觉顺序与事件顺序保持一致。

pending item 在成功 claim 并开始处理、显式 Esc 移除、`/clear`、成功 `/resume`、应用退出时清理。它不写 journal，因此进程重启后不会恢复；已真正提交的 user record 不受这些清理动作影响。

## Risks / Trade-offs

- [Risk] 自动发送与旧 turn finally、错误收尾或显式中断并发，可能重复发送。→ 使用 turn identity 和单槽同步 claim，测试迟到 complete/token 场景。
- [Risk] pending 已 claim、但异步提交预处理尚未进入 response lock 时，用户再次 Enter 可能启动并发提交。→ 用 pending dispatch 链布尔锁暂时阻止 live composer submit，锁在 finally 中释放。
- [Risk] 自动发送重用现有 `beginUserTurn()` 会清掉用户的新草稿。→ composer 消费和历史记录统一放在 `submitComposer()`，turn 启动不再修改 composer，并覆盖“排队后继续输入”测试。
- [Risk] 卡片增加 footer 高度，把旧临时内容推入 scrollback。→ 固定卡片高度、统一预算、input-first 分配和最终 `rows - 2` 兜底；禁止 layout 外追加。
- [Trade-off] pending 存在时第一次 Esc 不再立即中断回答。→ 卡片明确显示移除提示，移除后第二次 Esc 仍执行既有中断。
- [Trade-off] queued slash command 可能在 turn 结束后打开本地 surface，而不是发起新模型请求。→ 复用正常提交路由以保持 slash 语义，不为排队输入建立第二套解析规则。

## Migration Plan

1. 增加 transient context 和纯状态测试，不改变持久化格式。
2. 抽取共享文本提交管线，并把 composer 消费统一放在 `submitComposer()`。
3. 接入 active turn 排队、自动 claim、Esc 和 app cleanup 生命周期。
4. 将 render projection 接入 composer surface 统一预算，并补齐 resize/footer renderer 测试。
5. 运行完整自动验证；真实终端中的交互与 scrollback 行为由用户按项目验证清单确认。

回滚时可移除 pending context、提交分支和卡片投影。由于未修改 transcript journal schema、provider request 格式或配置文件，不需要数据迁移。

## Open Questions

无。首版固定为单槽 transient pending message、第一次 Esc 移除、正常提交路由解释输入，以及 footer 统一高度预算。
